/**
 * Tails one Claude Code or Codex transcript file by byte offset.
 *
 * A single `TranscriptTailer` follows at most one target at a time: calling
 * `subscribe` again — for the same target or a different one — cancels
 * whatever was previously being tailed first, so there is never a leaked
 * duplicate poll loop. This mirrors how the Fleet tab only ever shows one
 * transcript at a time.
 *
 * On subscribe, the last `backfillBytes` (default 256KB) of the file are read
 * and parsed as the initial backlog; the read offset is then pinned at the
 * file's size *at that moment*, and a `setInterval` stat-poll (matching the
 * repo's "poll first" discipline — see `FleetService`/`poll-gate.ts`) checks
 * every `pollMs` (default 700ms) for new bytes. New events are batched and
 * flushed to the subscriber at most every `flushMs` (default 300ms), capped
 * at `maxEventsPerFlush` (default 200) events per flush.
 *
 * Parsing reuses `parseTranscriptLine` (the same parser used everywhere a
 * transcript line is read) and the byte-safe UTF-8/line helpers from
 * `./lib/tail-decode` — this file does not reimplement either. Only
 * `user`/`assistant` events are surfaced; everything else is parsed (so it
 * still counts toward the schema-drift ratio) but filtered from what is
 * shown. If more than half the lines in a poll window (or the initial
 * backfill) fail to parse at all, the batch is flagged `degraded` — a hint
 * that the transcript format has drifted, not proof that nothing readable
 * came through.
 *
 * Security: a resolver hands this class a `{ filePath, baseDir }` pair for a
 * `targetId`; before any file is opened, lexical and realpath containment
 * verify the file still sits inside `baseDir`. This is defense in
 * depth *underneath* the RPC boundary's `targetId` allowlist
 * (`param-validation.ts`'s `requireTargetId`) — that allowlist blocks the
 * characters a traversal would need, but does not itself prove where a
 * resolved path landed, so this check exists to catch it regardless of how
 * the path was built.
 */
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { resolve as resolvePath, sep } from 'node:path';
import { createInterface } from 'node:readline';

import type { TranscriptBackfill, TranscriptBlock, TranscriptEvent, TranscriptPage, TranscriptTarget } from '../../shared/fleet';
import { decodeUtf8Chunk, trimPartialFirstLine } from './lib/tail-decode';
import { parseCodexTranscriptLine, parseTranscriptLine } from './lib/transcript';

/** Default backfill window on first subscribe: the last N bytes of the file. */
export const BACKFILL_WINDOW_BYTES = 256 * 1024;
/** Default stat-poll cadence. */
export const POLL_MS = 700;
/** Default minimum spacing between two flushes of streamed events. */
export const FLUSH_MS = 300;
/** Default cap on events delivered in a single flush. */
export const MAX_EVENTS_PER_FLUSH = 200;
/** Share of a poll window's lines that must fail to parse to flag `degraded`. */
const SCHEMA_DRIFT_THRESHOLD = 0.5;
const MAX_POLL_READ_BYTES = 1024 * 1024;

export interface TranscriptResolution {
  /** Absolute path to the transcript file to tail. */
  filePath: string;
  /** The directory `filePath` must resolve inside — the containment guard's base. */
  baseDir: string;
  /** Defaults to Claude for existing callers. */
  provider?: 'claude' | 'codex';
}

/** Maps a `targetId` to the file it names, or `null` when the target is unknown. */
export type TranscriptResolver = (targetId: string) => TranscriptResolution | null;

export interface TranscriptAppendPayload {
  events: TranscriptEvent[];
  totalBytes: number;
  /** See `TranscriptBackfill.degraded` — the same signal, for a later batch. */
  degraded?: boolean;
}

export type TranscriptAppendListener = (payload: TranscriptAppendPayload) => void;

export interface TranscriptTailerOptions {
  pollMs?: number;
  flushMs?: number;
  maxEventsPerFlush?: number;
  backfillBytes?: number;
  /** Injectable clock for the flush-throttle window; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * True when `filePath`, once resolved, still sits inside `baseDir` (or is
 * `baseDir` itself). Deliberately a separator-aware check rather than a bare
 * `startsWith(baseDir)` — `/base-evil/x` must not pass a containment check
 * against `/base`.
 */
export function isPathContained(filePath: string, baseDir: string): boolean {
  const resolvedBase = resolvePath(baseDir);
  const resolvedTarget = resolvePath(filePath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep);
}

interface ActiveTail {
  targetId: string;
  filePath: string;
  provider: 'claude' | 'codex';
  /** Byte offset up to which the file has been read and parsed so far. */
  offset: number;
  /** File size as of the last successful stat/read — used to detect truncation. */
  lastSize: number;
  /** Trailing bytes of the last read that were an incomplete UTF-8 sequence. */
  byteCarry: Uint8Array;
  /** A decoded line with no trailing `\n` yet — carried until it is completed. */
  pendingLine: string;
  queue: TranscriptEvent[];
  pendingDegraded: boolean;
  onAppend: TranscriptAppendListener;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  lastFlushAt: number | undefined;
  pollTimer: ReturnType<typeof setInterval>;
  polling: boolean;
  /** Flipped the instant this tail is replaced/cancelled, so an in-flight poll can bail out. */
  disposed: boolean;
}

export class TranscriptTailer {
  private active: ActiveTail | undefined;
  /** Invalidates subscriptions still inside asynchronous path/backfill reads. */
  private generation = 0;
  private pendingTargetId: string | undefined;
  private readonly pollMs: number;
  private readonly flushMs: number;
  private readonly maxEventsPerFlush: number;
  private readonly backfillBytes: number;
  private readonly now: () => number;

  constructor(
    private readonly resolveTarget: TranscriptResolver,
    private readonly log: (message: string) => void = () => {},
    options: TranscriptTailerOptions = {},
  ) {
    this.pollMs = options.pollMs ?? POLL_MS;
    this.flushMs = options.flushMs ?? FLUSH_MS;
    this.maxEventsPerFlush = options.maxEventsPerFlush ?? MAX_EVENTS_PER_FLUSH;
    this.backfillBytes = options.backfillBytes ?? BACKFILL_WINDOW_BYTES;
    this.now = options.now ?? Date.now;
  }

  /**
   * Start following `targetId`. Cancels whatever was previously being tailed
   * (for this target or any other) first — see the class doc. Resolves with
   * the initial backfill; `onAppend` receives every later batch.
   */
  async subscribe(targetId: string, onAppend: TranscriptAppendListener): Promise<TranscriptBackfill> {
    const generation = ++this.generation;
    this.pendingTargetId = targetId;
    this.cancelActive();

    const resolution = this.resolveTarget(targetId);
    if (!resolution) throw new Error(`Unknown transcript target: ${targetId}`);
    if (!isPathContained(resolution.filePath, resolution.baseDir)) {
      throw new Error(`Refused to tail a transcript path outside its expected directory: ${targetId}`);
    }
    const [realFilePath, realBaseDir] = await Promise.all([
      fs.realpath(resolution.filePath), fs.realpath(resolution.baseDir),
    ]);
    if (!isPathContained(realFilePath, realBaseDir)) {
      throw new Error(`Refused to tail a transcript symlink outside its expected directory: ${targetId}`);
    }

    const filePath = realFilePath;
    const provider = resolution.provider ?? 'claude';
    const window = await readBackfillWindow(filePath, this.backfillBytes);
    const { events, total, failed } = parseLines(window.complete, provider);
    const degraded = total > 0 && failed / total > SCHEMA_DRIFT_THRESHOLD;

    const backfill: TranscriptBackfill = {
      target: targetId as TranscriptTarget,
      events,
      offset: window.size,
      truncated: window.truncated,
      totalBytes: window.size,
      beforeOffset: window.startOffset,
      ...(degraded ? { degraded: true } : {}),
    };

    // Two RPC subscriptions can overlap while realpath/backfill await disk I/O.
    // Only the latest may install a poller; the older response can still
    // settle, but must not leak another tail or duplicate streamed events.
    if (generation !== this.generation) return backfill;
    this.pendingTargetId = undefined;

    const tail: ActiveTail = {
      targetId,
      filePath,
      provider,
      offset: window.size,
      lastSize: window.size,
      byteCarry: window.carry,
      pendingLine: window.pending,
      queue: [],
      pendingDegraded: false,
      onAppend,
      flushTimer: undefined,
      lastFlushAt: undefined,
      // Assigned via a placeholder first so `tail` can close over itself.
      pollTimer: undefined as unknown as ReturnType<typeof setInterval>,
      polling: false,
      disposed: false,
    };
    tail.pollTimer = setInterval(() => void this.poll(tail), this.pollMs);
    this.active = tail;

    return backfill;
  }

  /** Read a bounded earlier window without changing the active live tail. */
  async page(targetId: string, beforeOffset: number): Promise<TranscriptPage> {
    const resolution = this.resolveTarget(targetId);
    if (!resolution) throw new Error(`Unknown transcript target: ${targetId}`);
    if (!isPathContained(resolution.filePath, resolution.baseDir)) {
      throw new Error(`Refused to read a transcript path outside its expected directory: ${targetId}`);
    }
    const [filePath, baseDir] = await Promise.all([
      fs.realpath(resolution.filePath), fs.realpath(resolution.baseDir),
    ]);
    if (!isPathContained(filePath, baseDir)) {
      throw new Error(`Refused to read a transcript symlink outside its expected directory: ${targetId}`);
    }
    const stat = await fs.stat(filePath);
    if (beforeOffset > stat.size) throw new Error('Transcript changed; reopen it to load earlier history.');
    const start = Math.max(0, beforeOffset - this.backfillBytes);
    const raw = await readRange(filePath, start, beforeOffset);
    const boundary = start === 0 || (await readRange(filePath, start - 1, start))[0] === 10;
    const firstNewline = boundary ? -1 : raw.indexOf(10);
    const completeStart = boundary ? 0 : (firstNewline < 0 ? raw.length : firstNewline + 1);
    const text = new TextDecoder().decode(raw.subarray(completeStart));
    const { complete } = splitLines(text);
    const { events, total, failed } = parseLines(complete, resolution.provider ?? 'claude');
    const cursor = start + completeStart;
    return {
      events,
      beforeOffset: cursor === beforeOffset && start < beforeOffset ? start : cursor,
      hasOlder: start > 0,
      ...(total > 0 && failed / total > SCHEMA_DRIFT_THRESHOLD ? { degraded: true } : {}),
    };
  }

  /** Re-read one requested block only; normal backfills remain bounded previews. */
  async fullBlock(targetId: string, sourceKey: string, blockIndex: number): Promise<TranscriptBlock> {
    const resolution = this.resolveTarget(targetId);
    if (!resolution) throw new Error(`Unknown transcript target: ${targetId}`);
    if (!isPathContained(resolution.filePath, resolution.baseDir)) {
      throw new Error(`Refused to read a transcript path outside its expected directory: ${targetId}`);
    }
    const [filePath, baseDir] = await Promise.all([
      fs.realpath(resolution.filePath), fs.realpath(resolution.baseDir),
    ]);
    if (!isPathContained(filePath, baseDir)) {
      throw new Error(`Refused to read a transcript symlink outside its expected directory: ${targetId}`);
    }
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (transcriptLineKey(line) !== sourceKey) continue;
        const event = (resolution.provider === 'codex' ? parseCodexTranscriptLine : parseTranscriptLine)(line, true);
        const block = event?.blocks[blockIndex];
        if (!block) throw new Error('Transcript block changed; reopen the transcript.');
        return block;
      }
    } finally {
      lines.close();
      stream.destroy();
    }
    throw new Error('Transcript content changed or disappeared; reopen the transcript.');
  }

  /**
   * Stop tailing. When `targetId` is given, this is a no-op unless it is the
   * currently active target — mirroring `FleetService`'s "unsubscribe after
   * the state moved on is harmless" discipline.
   */
  unsubscribe(targetId?: string): void {
    const currentTargetId = this.active?.targetId ?? this.pendingTargetId;
    if (currentTargetId === undefined) return;
    if (targetId !== undefined && currentTargetId !== targetId) return;
    ++this.generation;
    this.pendingTargetId = undefined;
    this.cancelActive();
  }

  dispose(): void {
    ++this.generation;
    this.pendingTargetId = undefined;
    this.cancelActive();
  }

  private cancelActive(): void {
    const tail = this.active;
    if (!tail) return;
    tail.disposed = true;
    clearInterval(tail.pollTimer);
    if (tail.flushTimer) clearTimeout(tail.flushTimer);
    this.active = undefined;
  }

  private async poll(tail: ActiveTail): Promise<void> {
    // `tail` is captured per-subscription; if this instance has moved on to a
    // different (or no) target, this specific poll's own tail was already
    // cancelled and must not touch `onAppend` — that callback may belong to a
    // target the caller is no longer even watching.
    if (tail.disposed || tail.polling) return;
    tail.polling = true;
    try {
      await this.pollOnce(tail);
    } catch (error) {
      // A transient read failure (file mid-rewrite, a sharing violation on
      // Windows, ...) must never become an unhandled rejection from this
      // fire-and-forget `setInterval` callback — log it and try again next tick.
      this.log(`transcript tailer: poll failed for ${tail.targetId}: ${errorMessage(error)}`);
    } finally {
      tail.polling = false;
    }
  }

  private async pollOnce(tail: ActiveTail): Promise<void> {
    const stat = await fs.stat(tail.filePath);
    if (tail.disposed) return;

    if (stat.size < tail.lastSize) {
      await this.rebackfill(tail);
      return;
    }
    if (stat.size === tail.lastSize) return;

    const skipped = stat.size - tail.offset > MAX_POLL_READ_BYTES;
    const start = skipped ? stat.size - MAX_POLL_READ_BYTES : tail.offset;
    const raw = await readRange(tail.filePath, start, stat.size);
    if (tail.disposed) return;

    const { text, carry } = decodeUtf8Chunk(skipped ? new Uint8Array(0) : tail.byteCarry, raw);
    tail.byteCarry = carry;
    tail.offset = stat.size;
    tail.lastSize = stat.size;

    const { complete, pending } = splitLines((skipped ? '' : tail.pendingLine) + (skipped ? trimPartialFirstLine(text) : text));
    tail.pendingLine = pending;

    const { events, total, failed } = parseLines(complete, tail.provider);
    if (events.length > 0) tail.queue.push(...events);
    if (skipped || (total > 0 && failed / total > SCHEMA_DRIFT_THRESHOLD)) tail.pendingDegraded = true;

    if (tail.queue.length > 0 || tail.pendingDegraded) this.scheduleFlush(tail);
  }

  /** File shrank since the last poll (truncated/rotated): re-read it as if it were new. */
  private async rebackfill(tail: ActiveTail): Promise<void> {
    let window: Awaited<ReturnType<typeof readBackfillWindow>>;
    try {
      window = await readBackfillWindow(tail.filePath, this.backfillBytes);
    } catch (error) {
      this.log(`transcript tailer: re-backfill failed for ${tail.targetId}: ${errorMessage(error)}`);
      return;
    }
    if (tail.disposed) return;

    tail.offset = window.size;
    tail.lastSize = window.size;
    tail.byteCarry = window.carry;
    tail.pendingLine = window.pending;

    const { events, total, failed } = parseLines(window.complete, tail.provider);
    if (events.length > 0) tail.queue.push(...events);
    if (total > 0 && failed / total > SCHEMA_DRIFT_THRESHOLD) tail.pendingDegraded = true;

    if (tail.queue.length > 0 || tail.pendingDegraded) this.scheduleFlush(tail);
  }

  private scheduleFlush(tail: ActiveTail): void {
    if (tail.flushTimer) return; // a flush is already pending; it will pick up what's queued now
    const elapsed = tail.lastFlushAt === undefined ? Infinity : this.now() - tail.lastFlushAt;
    if (elapsed >= this.flushMs) {
      this.flushNow(tail);
    } else {
      tail.flushTimer = setTimeout(() => this.flushNow(tail), this.flushMs - elapsed);
    }
  }

  private flushNow(tail: ActiveTail): void {
    tail.flushTimer = undefined;
    if (tail.disposed) return;
    if (tail.queue.length === 0 && !tail.pendingDegraded) return;

    const batch = tail.queue.splice(0, this.maxEventsPerFlush);
    tail.lastFlushAt = this.now();
    const degraded = tail.pendingDegraded;
    tail.pendingDegraded = false;

    tail.onAppend({ events: batch, totalBytes: tail.lastSize, ...(degraded ? { degraded: true } : {}) });

    if (tail.queue.length > 0) {
      tail.flushTimer = setTimeout(() => this.flushNow(tail), this.flushMs);
    }
  }
}

interface BackfillWindow {
  /** Complete lines within the window, oldest first. */
  complete: string[];
  /** A trailing line with no `\n` yet, to be completed by a later poll. */
  pending: string;
  /** Leftover bytes of an incomplete UTF-8 sequence at the read's end. */
  carry: Uint8Array;
  /** The file's size at the moment it was read. */
  size: number;
  /** True when the window was smaller than the whole file. */
  truncated: boolean;
  startOffset: number;
}

/** Read the last `backfillBytes` of `filePath` and split it into whole lines. */
async function readBackfillWindow(filePath: string, backfillBytes: number): Promise<BackfillWindow> {
  const stat = await fs.stat(filePath);
  const size = stat.size;
  const windowStart = Math.max(0, size - backfillBytes);
  const raw = await readRange(filePath, windowStart, size);
  const { text, carry } = decodeUtf8Chunk(new Uint8Array(0), raw);
  // Only a window that starts mid-file risks an unreadable partial first
  // line; a window covering the whole (small) file starts at a real line
  // boundary and must not have its first line thrown away.
  const boundary = windowStart === 0 || (await readRange(filePath, windowStart - 1, windowStart))[0] === 10;
  const trimmed = boundary ? text : trimPartialFirstLine(text);
  const { complete, pending } = splitLines(trimmed);
  const firstNewline = boundary ? -1 : raw.indexOf(10);
  const startOffset = boundary ? windowStart : windowStart + (firstNewline < 0 ? raw.length : firstNewline + 1);
  return { complete, pending, carry, size, truncated: windowStart > 0, startOffset };
}

/** Read the byte range `[start, end)` of `filePath`. */
async function readRange(filePath: string, start: number, end: number): Promise<Uint8Array> {
  if (end <= start) return new Uint8Array(0);
  const handle = await fs.open(filePath, 'r');
  try {
    const length = end - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Split `text` into whole lines plus a trailing partial one (empty when
 * `text` ends with `\n`, so there is nothing left over). Deliberately
 * agnostic about `\r` — a transcript line is one JSON object, never
 * containing a literal newline itself, so a bare `\n` split is exact here.
 */
function splitLines(text: string): { complete: string[]; pending: string } {
  const endsWithNewline = text.endsWith('\n');
  const parts = text.split('\n');
  return { complete: parts.slice(0, -1), pending: endsWithNewline ? '' : (parts[parts.length - 1] ?? '') };
}

/**
 * Parse each line via the shared `parseTranscriptLine`, keeping only
 * `user`/`assistant` events (everything else this tab does not render) while
 * still counting every non-blank line towards the schema-drift ratio.
 */
function parseLines(lines: string[], provider: 'claude' | 'codex'): { events: TranscriptEvent[]; total: number; failed: number } {
  let total = 0;
  let failed = 0;
  const events: TranscriptEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    total += 1;
    const parsed = provider === 'codex' ? parseCodexTranscriptLine(line) : parseTranscriptLine(line);
    if (!parsed) {
      failed += 1;
      continue;
    }
    if ((parsed.role === 'user' || parsed.role === 'assistant') && (provider === 'claude' || parsed.blocks.length > 0)) {
      if (parsed.blocks.some((block) => block.truncated)) parsed.sourceKey = transcriptLineKey(line);
      events.push(parsed);
    }
  }
  return { events, total, failed };
}

function transcriptLineKey(line: string): string {
  return createHash('sha256').update(line.trimEnd()).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
