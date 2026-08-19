/**
 * `TranscriptTailer` coverage: byte-offset tailing against real fixture files
 * on disk (mirrors `fleet-service.test.ts`'s style), the 256KB backfill
 * window, batching/throttling of streamed appends, the schema-drift guard,
 * truncation/rotation handling, single-subscription-per-tailer semantics, and
 * the containment guard as its own dedicated, provable security test.
 *
 * The streaming tests use *real* timers with a short configured `pollMs`/
 * `flushMs` rather than `vi.useFakeTimers()`: this class does real `fs`
 * I/O inside its poll loop, and fake timers do not reliably let a real disk
 * read's completion settle before `advanceTimersByTimeAsync` returns — real
 * short intervals plus a real wait are simpler and, per the bead's own
 * closing bar, actually measure wall-clock behaviour rather than simulating it.
 *
 * No `vscode` import anywhere in `TranscriptTailer.ts`, so this file needs no
 * `vi.mock('vscode', ...)` — unlike `fleet-service.test.ts`.
 */
import { promises as fsPromises } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isPathContained,
  TranscriptTailer,
  type TranscriptAppendPayload,
  type TranscriptResolution,
  type TranscriptTailerOptions,
} from '../extension/fleet/TranscriptTailer';

let root: string;
let baseDir: string;

/** Short, test-only cadence so streaming assertions do not wait out real production intervals. */
const FAST: TranscriptTailerOptions = { pollMs: 40, flushMs: 250 };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `predicate` instead of sleeping a fixed duration: robust against a
 * loaded machine (running the whole suite in parallel) being slower than a
 * single fixed margin can anticipate, while still resolving immediately once
 * the condition is actually true rather than always paying the full timeout.
 */
async function waitForCalls(fn: { mock: { calls: unknown[] } }, atLeast: number, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (fn.mock.calls.length < atLeast) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForCalls: still only ${fn.mock.calls.length} call(s) after ${timeoutMs}ms`);
    }
    await wait(10);
  }
}

function jsonLine(role: 'user' | 'assistant' | 'other', text: string): string {
  const type = role === 'other' ? 'attachment' : role;
  return `${JSON.stringify({ type, message: { role, content: text } })}\n`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transcript-tailer-test-'));
  baseDir = join(root, 'projects', 'proj-dir');
  await mkdir(baseDir, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function resolver(map: Record<string, TranscriptResolution>) {
  return (targetId: string): TranscriptResolution | null => map[targetId] ?? null;
}

describe('isPathContained', () => {
  it('accepts a path that resolves inside the base directory', () => {
    expect(isPathContained(join(baseDir, 'session-1', 'subagents', 'agent-a.jsonl'), baseDir)).toBe(true);
  });

  it('rejects a path that escapes the base directory via ../ segments', () => {
    expect(isPathContained(join(baseDir, '..', '..', 'etc', 'passwd'), baseDir)).toBe(false);
  });

  it('rejects an absolute path entirely outside the base directory', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\config' : '/etc/passwd';
    expect(isPathContained(outside, baseDir)).toBe(false);
  });

  it('rejects a sibling directory that merely shares a name prefix', () => {
    // "proj-dir-evil" starts with the same characters as "proj-dir" but is not
    // inside it — a naive `startsWith(baseDir)` string check (no separator)
    // would wrongly accept this.
    const sibling = join(root, 'projects', 'proj-dir-evil', 'agent-a.jsonl');
    expect(isPathContained(sibling, baseDir)).toBe(false);
  });

  it('accepts the base directory itself', () => {
    expect(isPathContained(baseDir, baseDir)).toBe(true);
  });
});

describe('TranscriptTailer.subscribe — security', () => {
  it('rejects a resolution whose path escapes its own declared baseDir, before any file I/O', async () => {
    const statSpy = vi.spyOn(fsPromises, 'stat');
    const openSpy = vi.spyOn(fsPromises, 'open');

    const maliciousPath = join(root, 'projects', '..', 'outside.jsonl');
    await writeFile(join(root, 'outside.jsonl'), jsonLine('user', 'hi'), 'utf8');

    const tailer = new TranscriptTailer(
      resolver({ 'agent:evil': { filePath: maliciousPath, baseDir } }),
    );

    await expect(tailer.subscribe('agent:evil', vi.fn())).rejects.toThrow(/outside|escape|contain/i);
    expect(statSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    tailer.dispose();
  });

  it('rejects an unknown target id (resolver returns null) rather than guessing a path', async () => {
    const tailer = new TranscriptTailer(resolver({}));
    await expect(tailer.subscribe('agent:nope', vi.fn())).rejects.toThrow();
    tailer.dispose();
  });
});

describe('TranscriptTailer.subscribe — backfill', () => {
  it('backfills a small file in full, with truncated=false and offset pinned at the file size', async () => {
    const filePath = join(baseDir, 'small.jsonl');
    await writeFile(filePath, jsonLine('user', 'hello') + jsonLine('assistant', 'hi there'), 'utf8');
    const size = (await fsPromises.stat(filePath)).size;

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }));
    const backfill = await tailer.subscribe('session:s1', vi.fn());

    expect(backfill.truncated).toBe(false);
    expect(backfill.offset).toBe(size);
    expect(backfill.totalBytes).toBe(size);
    expect(backfill.events).toHaveLength(2);
    expect(backfill.events[0].role).toBe('user');
    expect(backfill.events[1].role).toBe('assistant');
    tailer.dispose();
  });

  it('filters out non-user/assistant lines from the backfill', async () => {
    const filePath = join(baseDir, 'mixed.jsonl');
    await writeFile(
      filePath,
      jsonLine('user', 'q') + jsonLine('other', 'not shown') + jsonLine('assistant', 'a'),
      'utf8',
    );

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }));
    const backfill = await tailer.subscribe('session:s1', vi.fn());

    expect(backfill.events.map((event) => event.role)).toEqual(['user', 'assistant']);
    tailer.dispose();
  });

  it('discards a partial first line and reports truncated=true for a file bigger than the backfill window', async () => {
    // One line per byte-ish: build enough content to clear a small window,
    // with a distinctive partial line at the very start of the *window*.
    const smallWindow = 200;
    const lines = [
      'X'.repeat(500), // pushes the window start into the middle of this line
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first complete line in window' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'second' } }),
    ];
    const filePath = join(baseDir, 'big.jsonl');
    await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');

    const tailer = new TranscriptTailer(
      resolver({ 'session:s1': { filePath, baseDir } }),
      undefined,
      { backfillBytes: smallWindow },
    );
    const backfill = await tailer.subscribe('session:s1', vi.fn());

    expect(backfill.truncated).toBe(true);
    // The partial head (the tail end of the "X" line) must never surface as an event.
    expect(backfill.events.every((event) => !event.blocks.some((b) => 'text' in b && b.text.includes('X')))).toBe(
      true,
    );
    expect(backfill.events.map((event) => event.role)).toEqual(['user', 'assistant']);
    tailer.dispose();
  });

  it('flags degraded when more than half the backfilled lines fail to parse', async () => {
    const filePath = join(baseDir, 'corrupt.jsonl');
    const corruptLines = Array.from({ length: 6 }, () => 'not json at all').join('\n');
    const goodLines = [jsonLine('user', 'ok').trimEnd(), jsonLine('assistant', 'ok2').trimEnd()].join('\n');
    await writeFile(filePath, `${corruptLines}\n${goodLines}\n`, 'utf8');

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }));
    const backfill = await tailer.subscribe('session:s1', vi.fn());

    expect(backfill.degraded).toBe(true);
    tailer.dispose();
  });

  it('does not flag degraded when parse failures are a minority', async () => {
    const filePath = join(baseDir, 'mostly-ok.jsonl');
    const content = [jsonLine('user', 'a').trimEnd(), jsonLine('assistant', 'b').trimEnd(), 'one bad line'].join(
      '\n',
    );
    await writeFile(filePath, `${content}\n`, 'utf8');

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }));
    const backfill = await tailer.subscribe('session:s1', vi.fn());

    expect(backfill.degraded).toBeFalsy();
    tailer.dispose();
  });

  it('rejects when the resolved file does not exist', async () => {
    const tailer = new TranscriptTailer(
      resolver({ 'session:missing': { filePath: join(baseDir, 'nope.jsonl'), baseDir } }),
    );
    await expect(tailer.subscribe('session:missing', vi.fn())).rejects.toThrow();
    tailer.dispose();
  });
});

describe('TranscriptTailer streaming', () => {
  it('streams a line appended after subscribe within one poll tick', async () => {
    const filePath = join(baseDir, 'stream.jsonl');
    await writeFile(filePath, jsonLine('user', 'first'), 'utf8');

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }), undefined, FAST);
    const onAppend = vi.fn();
    await tailer.subscribe('session:s1', onAppend);

    await appendFile(filePath, jsonLine('assistant', 'streamed reply'), 'utf8');
    await waitForCalls(onAppend, 1);

    expect(onAppend).toHaveBeenCalledTimes(1);
    const payload = onAppend.mock.calls[0][0] as TranscriptAppendPayload;
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0].blocks[0]).toMatchObject({ type: 'text', text: 'streamed reply' });
    tailer.dispose();
  });

  it('carries a partial last line across polls until it is completed with a newline', async () => {
    const filePath = join(baseDir, 'partial.jsonl');
    await writeFile(filePath, '', 'utf8');

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }), undefined, FAST);
    const onAppend = vi.fn();
    await tailer.subscribe('session:s1', onAppend);

    const full = jsonLine('user', 'split across two writes');
    const half = Math.floor(full.length / 2);
    await appendFile(filePath, full.slice(0, half), 'utf8'); // no trailing newline yet
    await wait(FAST.pollMs! * 3 + 100);
    expect(onAppend).not.toHaveBeenCalled(); // nothing complete to report yet

    await appendFile(filePath, full.slice(half), 'utf8'); // completes the line
    await waitForCalls(onAppend, 1);

    expect(onAppend).toHaveBeenCalledTimes(1);
    const payload = onAppend.mock.calls[0][0] as TranscriptAppendPayload;
    expect(payload.events[0].blocks[0]).toMatchObject({ text: 'split across two writes' });
    tailer.dispose();
  });

  it('caps a flush at 200 events and spaces further flushes by at least flushMs', async () => {
    const filePath = join(baseDir, 'burst.jsonl');
    await writeFile(filePath, '', 'utf8');

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }), undefined, FAST);
    const onAppend = vi.fn();
    await tailer.subscribe('session:s1', onAppend);

    const burst = Array.from({ length: 250 }, (_, i) => jsonLine('user', `line ${i}`)).join('');
    await appendFile(filePath, burst, 'utf8');
    await waitForCalls(onAppend, 1);

    // The throttled second flush is scheduled >= flushMs *after* this first
    // one fires (a real `setTimeout`, so it can only ever fire later under
    // load, never earlier) — asserting immediately after `waitForCalls`
    // resolves is safe regardless of how long the wait itself took.
    expect(onAppend).toHaveBeenCalledTimes(1);
    expect((onAppend.mock.calls[0][0] as TranscriptAppendPayload).events).toHaveLength(200);

    await waitForCalls(onAppend, 2);
    expect(onAppend).toHaveBeenCalledTimes(2);
    expect((onAppend.mock.calls[1][0] as TranscriptAppendPayload).events).toHaveLength(50);
    tailer.dispose();
  });

  it('re-backfills from scratch when the file shrinks (truncation/rotation)', async () => {
    const filePath = join(baseDir, 'rotate.jsonl');
    await writeFile(filePath, jsonLine('user', 'old-1') + jsonLine('assistant', 'old-2'), 'utf8');

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }), undefined, FAST);
    const onAppend = vi.fn();
    const firstBackfill = await tailer.subscribe('session:s1', onAppend);
    expect(firstBackfill.events).toHaveLength(2);

    // Simulate rotation: a fresh, shorter file.
    await writeFile(filePath, jsonLine('user', 'fresh-after-rotation'), 'utf8');
    await waitForCalls(onAppend, 1);

    expect(onAppend).toHaveBeenCalled();
    const payload = onAppend.mock.calls[0][0] as TranscriptAppendPayload;
    expect(payload.events.some((e) => e.blocks.some((b) => 'text' in b && b.text === 'fresh-after-rotation'))).toBe(
      true,
    );
    tailer.dispose();
  });

  it('surfaces degraded even when a poll window has zero displayable events, if most lines failed to parse', async () => {
    const filePath = join(baseDir, 'noise.jsonl');
    await writeFile(filePath, '', 'utf8');

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }), undefined, FAST);
    const onAppend = vi.fn();
    await tailer.subscribe('session:s1', onAppend);

    const noise = Array.from({ length: 4 }, () => 'garbage-not-json\n').join('');
    await appendFile(filePath, noise, 'utf8');
    await waitForCalls(onAppend, 1);

    expect(onAppend).toHaveBeenCalledTimes(1);
    const payload = onAppend.mock.calls[0][0] as TranscriptAppendPayload;
    expect(payload.degraded).toBe(true);
    expect(payload.events).toEqual([]);
    tailer.dispose();
  });
});

describe('TranscriptTailer — single subscription semantics', () => {
  it('cancels the previous tail when subscribe is called again for a different target', async () => {
    const fileA = join(baseDir, 'a.jsonl');
    const fileB = join(baseDir, 'b.jsonl');
    await writeFile(fileA, jsonLine('user', 'a1'), 'utf8');
    await writeFile(fileB, jsonLine('user', 'b1'), 'utf8');

    const tailer = new TranscriptTailer(
      resolver({ 'session:a': { filePath: fileA, baseDir }, 'session:b': { filePath: fileB, baseDir } }),
      undefined,
      FAST,
    );
    const onAppendA = vi.fn();
    const onAppendB = vi.fn();

    await tailer.subscribe('session:a', onAppendA);
    await tailer.subscribe('session:b', onAppendB); // replaces the tail on `a`

    await appendFile(fileA, jsonLine('assistant', 'a2 — must not leak'), 'utf8');
    await appendFile(fileB, jsonLine('assistant', 'b2'), 'utf8');
    await waitForCalls(onAppendB, 1);

    expect(onAppendA).not.toHaveBeenCalled();
    expect(onAppendB).toHaveBeenCalled();
    const payload = onAppendB.mock.calls.at(-1)?.[0] as TranscriptAppendPayload;
    expect(payload.events.some((e) => e.blocks.some((b) => 'text' in b && b.text === 'b2'))).toBe(true);
    tailer.dispose();
  });

  it('does not leak a stale event when a poll for the old target is already in flight at switch time', async () => {
    const fileA = join(baseDir, 'race-a.jsonl');
    const fileB = join(baseDir, 'race-b.jsonl');
    await writeFile(fileA, jsonLine('user', 'a1'), 'utf8');
    await writeFile(fileB, jsonLine('user', 'b1'), 'utf8');

    const tailer = new TranscriptTailer(
      resolver({ 'session:a': { filePath: fileA, baseDir }, 'session:b': { filePath: fileB, baseDir } }),
      undefined,
      FAST,
    );
    const onAppendA = vi.fn();
    const onAppendB = vi.fn();
    await tailer.subscribe('session:a', onAppendA);

    // Hold the *next* real stat() call open until we've switched targets,
    // simulating a poll that was already in flight when subscribe(b) ran.
    let releaseStat: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseStat = resolve;
    });
    const realStat = fsPromises.stat.bind(fsPromises);
    const statSpy = vi.spyOn(fsPromises, 'stat').mockImplementationOnce(async (...args) => {
      await gate;
      return realStat(...(args as Parameters<typeof fsPromises.stat>));
    });

    await appendFile(fileA, jsonLine('assistant', 'a2 — in-flight, must not leak'), 'utf8');
    // Give the interval time to fire and reach the gated stat() call for `a`.
    await wait(FAST.pollMs! + 10);

    await tailer.subscribe('session:b', onAppendB); // switches away from `a` while its poll is stuck
    releaseStat?.();
    await wait(60);

    expect(onAppendA).not.toHaveBeenCalled();
    statSpy.mockRestore();
    tailer.dispose();
  });
});

describe('TranscriptTailer.unsubscribe', () => {
  it('stops streaming further appends once unsubscribed', async () => {
    const filePath = join(baseDir, 'unsub.jsonl');
    await writeFile(filePath, jsonLine('user', 'hi'), 'utf8');

    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }), undefined, FAST);
    const onAppend = vi.fn();
    await tailer.subscribe('session:s1', onAppend);
    tailer.unsubscribe('session:s1');

    await appendFile(filePath, jsonLine('assistant', 'too late'), 'utf8');
    await wait(FAST.pollMs! * 3 + 150);

    expect(onAppend).not.toHaveBeenCalled();
    tailer.dispose();
  });

  it('is a harmless no-op when the given target is not the active one', async () => {
    const filePath = join(baseDir, 'noop.jsonl');
    await writeFile(filePath, jsonLine('user', 'hi'), 'utf8');
    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }), undefined, FAST);
    const onAppend = vi.fn();
    await tailer.subscribe('session:s1', onAppend);

    tailer.unsubscribe('session:other'); // must not cancel session:s1's tail

    await appendFile(filePath, jsonLine('assistant', 'still alive'), 'utf8');
    await waitForCalls(onAppend, 1);

    expect(onAppend).toHaveBeenCalledTimes(1);
    tailer.dispose();
  });
});

describe('TranscriptTailer.dispose', () => {
  it('stops the poll timer so it never fires again', async () => {
    const filePath = join(baseDir, 'disposed.jsonl');
    await writeFile(filePath, jsonLine('user', 'hi'), 'utf8');
    const tailer = new TranscriptTailer(resolver({ 'session:s1': { filePath, baseDir } }), undefined, FAST);
    const onAppend = vi.fn();
    await tailer.subscribe('session:s1', onAppend);

    tailer.dispose();
    await appendFile(filePath, jsonLine('assistant', 'after dispose'), 'utf8');
    await wait(FAST.pollMs! * 3 + 150);

    expect(onAppend).not.toHaveBeenCalled();
  });
});
