/**
 * `FleetService` coverage: session/worker discovery against real fixture
 * files on disk (the pure parsers are already covered under
 * `src/extension/fleet/lib/*`; this file exercises the impure glue around
 * them — directory walking, mtime-derived activity, and the discovery-loop
 * gating), plus the `fleetChanged` debounce/dedupe contract and the
 * `~/.claude/projects` watcher fast path (beads-ui-vscode-ext-37b).
 * `./worktree-git` is mocked so worktree/git behaviour stays the dedicated
 * subject of `fleet-worktree-git.test.ts`.
 *
 * `FleetService.ts` imports the real `vscode` module for `EventEmitter`,
 * `RelativePattern`, `Uri.file`, and `workspace.createFileSystemWatcher` —
 * all faked here, the same minimal style `store-watcher.test.ts` uses for
 * `BeadsStore`. The fake watcher never fires on its own; tests trigger it
 * explicitly via `vscodeMock.watchers`.
 */
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetSnapshot } from '../shared/fleet';
import { encodeProjectDirName } from '../extension/fleet/lib/session-locator';

class FakeEventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  event = (listener: (value: T) => void): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

/** A fake `vscode.FileSystemWatcher` — never fires on its own; tests call `fireChange()`/`fireCreate()`. */
class FakeFileSystemWatcher {
  private readonly createListeners = new Set<() => void>();
  private readonly changeListeners = new Set<() => void>();
  private readonly deleteListeners = new Set<() => void>();
  disposed = false;

  onDidCreate = (listener: () => void): { dispose: () => void } => {
    this.createListeners.add(listener);
    return { dispose: () => this.createListeners.delete(listener) };
  };
  onDidChange = (listener: () => void): { dispose: () => void } => {
    this.changeListeners.add(listener);
    return { dispose: () => this.changeListeners.delete(listener) };
  };
  onDidDelete = (listener: () => void): { dispose: () => void } => {
    this.deleteListeners.add(listener);
    return { dispose: () => this.deleteListeners.delete(listener) };
  };

  fireCreate(): void {
    for (const listener of [...this.createListeners]) listener();
  }
  fireChange(): void {
    for (const listener of [...this.changeListeners]) listener();
  }

  dispose(): void {
    this.disposed = true;
  }
}

const vscodeMock = vi.hoisted(() => {
  return {
    watchers: [] as FakeFileSystemWatcher[],
    createFileSystemWatcher: vi.fn(),
  };
});

class FakeRelativePattern {
  constructor(
    public base: unknown,
    public pattern: string,
  ) {}
}

vi.mock('vscode', () => ({
  EventEmitter: FakeEventEmitter,
  RelativePattern: FakeRelativePattern,
  Uri: { file: (path: string) => ({ fsPath: path }) },
  workspace: { createFileSystemWatcher: vscodeMock.createFileSystemWatcher },
}));

const worktreeGit = vi.hoisted(() => ({
  listWorktrees: vi.fn(async () => [] as Array<{ path: string; dirName: string; branch: string | null; bare: boolean }>),
}));

vi.mock('../extension/fleet/worktree-git', () => ({
  listWorktrees: worktreeGit.listWorktrees,
  WorktreeGitProbe: class {
    async statusFor(_path: string, branch: string | null) {
      return { branch, changedFiles: 0, insertions: 0, deletions: 0, measuredAt: new Date().toISOString() };
    }
  },
}));

const { FleetService } = await import('../extension/fleet/FleetService');

let root: string;
let cwd: string;
let projectDir: string;

/** Write an agent transcript whose first line carries the given spawn-brief text. */
async function writeAgentFile(
  sessionId: string,
  agentId: string,
  briefText: string,
  mtime: Date,
): Promise<void> {
  const subagentsDir = join(projectDir, sessionId, 'subagents');
  await mkdir(subagentsDir, { recursive: true });
  const filePath = join(subagentsDir, `agent-${agentId}.jsonl`);
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: briefText } });
  await writeFile(filePath, `${line}\n`, 'utf8');
  await utimes(filePath, mtime, mtime);
}

async function writeSessionFile(sessionId: string, mtime: Date): Promise<void> {
  const filePath = join(projectDir, `${sessionId}.jsonl`);
  await writeFile(filePath, '{"type":"queue-operation"}\n', 'utf8');
  await utimes(filePath, mtime, mtime);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fleet-service-test-'));
  cwd = join(root, 'workspace');
  await mkdir(cwd, { recursive: true });
  projectDir = join(root, 'projects', encodeProjectDirName(cwd));
  await mkdir(projectDir, { recursive: true });
  worktreeGit.listWorktrees.mockResolvedValue([]);

  vscodeMock.watchers.length = 0;
  vscodeMock.createFileSystemWatcher.mockReset();
  vscodeMock.createFileSystemWatcher.mockImplementation(() => {
    const watcher = new FakeFileSystemWatcher();
    vscodeMock.watchers.push(watcher);
    return watcher;
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  vi.restoreAllMocks();
});

function projectsRoot(): string {
  return join(root, 'projects');
}

describe('FleetService session discovery', () => {
  it('degrades to no-claude-dir when ~/.claude/projects does not exist', async () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: join(root, 'does-not-exist') });
    await service.tick();

    expect(service.snapshot?.degraded).toEqual({ reason: 'no-claude-dir' });
    expect(service.snapshot?.orchestrators).toEqual([]);
    service.dispose();
  });

  it('ignores an ordinary session with no subagents directory', async () => {
    await writeSessionFile('session-1', new Date());

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    expect(service.snapshot?.orchestrators).toEqual([]);
    expect(service.snapshot?.degraded).toBeUndefined();
    service.dispose();
  });

  it('treats a session with >=1 worker as an orchestrator and parses its worker brief', async () => {
    const briefText =
      'You are implementing bead `beads-ui-vscode-ext-qo9` in a dedicated worktree: `/repo/wt-qo9`.';
    await writeSessionFile('session-1', new Date());
    await writeAgentFile('session-1', 'agent-a', briefText, new Date());

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    const snapshot = service.snapshot as FleetSnapshot;
    expect(snapshot.orchestrators).toHaveLength(1);
    expect(snapshot.orchestrators[0]).toMatchObject({ sessionId: 'session-1', workerIds: ['agent-a'] });
    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.workers[0]).toMatchObject({
      agentId: 'agent-a',
      sessionId: 'session-1',
      beadId: 'beads-ui-vscode-ext-qo9',
      worktreePath: '/repo/wt-qo9',
    });
    expect(snapshot.workers[0].briefSummary).toContain('beads-ui-vscode-ext-qo9');
    service.dispose();
  });

  it('leaves beadId/worktreePath null when the brief names neither', async () => {
    await writeSessionFile('session-1', new Date());
    await writeAgentFile('session-1', 'agent-a', 'Please refactor the utils module.', new Date());

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    const worker = service.snapshot?.workers[0];
    expect(worker?.beadId).toBeNull();
    expect(worker?.worktreePath).toBeNull();
    service.dispose();
  });

  it('marks a worker running when its transcript mtime is recent, idle when it is stale', async () => {
    const now = new Date('2026-08-19T12:00:00.000Z');
    await writeSessionFile('session-1', now);
    await writeAgentFile('session-1', 'agent-fresh', 'no bead here', now);
    await writeAgentFile(
      'session-1',
      'agent-stale',
      'no bead here either',
      new Date(now.getTime() - 60 * 60 * 1000), // an hour old
    );

    const service = new FleetService(cwd, undefined, {
      projectsRoot: projectsRoot(),
      now: () => now.getTime(),
    });
    await service.tick();

    const byId = new Map(service.snapshot?.workers.map((worker) => [worker.agentId, worker]));
    expect(byId.get('agent-fresh')?.status).toBe('running');
    expect(byId.get('agent-stale')?.status).toBe('idle');
    service.dispose();
  });
});

describe('FleetService worktree reconciliation', () => {
  it('matches a wt-* worktree to a worker by its brief-named path and reports no orphan', async () => {
    await writeSessionFile('session-1', new Date());
    await writeAgentFile(
      'session-1',
      'agent-a',
      'Implementing bead `proj-7pi` in `/repo/wt-7pi`.',
      new Date(),
    );
    worktreeGit.listWorktrees.mockResolvedValue([
      { path: '/repo/wt-7pi', dirName: 'wt-7pi', branch: 'work/bead-7pi', bare: false },
    ]);

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    const snapshot = service.snapshot as FleetSnapshot;
    expect(snapshot.worktrees).toHaveLength(1);
    expect(snapshot.worktrees[0]).toMatchObject({ path: '/repo/wt-7pi', beadId: 'proj-7pi' });
    expect(snapshot.orphanWorktrees).toEqual([]);
    service.dispose();
  });

  it('reports a wt-* worktree with no matching worker as an orphan', async () => {
    worktreeGit.listWorktrees.mockResolvedValue([
      { path: '/repo/wt-stale', dirName: 'wt-stale', branch: 'work/bead-stale', bare: false },
    ]);

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    expect(service.snapshot?.orphanWorktrees).toEqual(['/repo/wt-stale']);
    service.dispose();
  });

  it('excludes the primary (non wt-*) checkout from the worktree list entirely', async () => {
    worktreeGit.listWorktrees.mockResolvedValue([
      { path: '/repo', dirName: 'repo', branch: 'main', bare: false },
      { path: '/repo/wt-7pi', dirName: 'wt-7pi', branch: 'work/bead-7pi', bare: false },
    ]);

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    const paths = service.snapshot?.worktrees.map((worktree) => worktree.path);
    expect(paths).toEqual(['/repo/wt-7pi']);
    expect(service.snapshot?.orphanWorktrees).toEqual(['/repo/wt-7pi']);
    service.dispose();
  });

  it('degrades to an empty worktree list, without throwing, when git worktree list fails', async () => {
    worktreeGit.listWorktrees.mockRejectedValue(new Error('git not found'));

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await expect(service.tick()).resolves.toBeUndefined();

    expect(service.snapshot?.worktrees).toEqual([]);
    expect(service.snapshot?.orphanWorktrees).toEqual([]);
    service.dispose();
  });
});

describe('FleetService discovery-loop gating', () => {
  it('does not scan at all until observe() is called', async () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    const tick = vi.spyOn(service, 'tick');

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(tick).not.toHaveBeenCalled();
    service.dispose();
  });

  it('scans immediately on the first observe(), and stops once the last observer releases', async () => {
    vi.useFakeTimers();
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot(), intervalMs: 5_000 });
    const tick = vi.spyOn(service, 'tick').mockResolvedValue();

    const hold = service.observe();
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(2);

    hold.dispose();
    tick.mockClear();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(tick).not.toHaveBeenCalled();

    service.dispose();
    vi.useRealTimers();
  });

  it('keeps a single timer running for multiple concurrent observers', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    vi.spyOn(service, 'tick').mockResolvedValue();

    const holdA = service.observe();
    const callsAfterFirst = setIntervalSpy.mock.calls.length;
    const holdB = service.observe();

    expect(setIntervalSpy.mock.calls.length).toBe(callsAfterFirst); // no extra timer for the second observer

    holdA.dispose();
    holdB.dispose();
    service.dispose();
    vi.useRealTimers();
  });
});

describe('FleetService watcher fast path (beads-ui-vscode-ext-37b)', () => {
  it('starts one file watcher on projectsRoot when the first observer arrives', () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    vi.spyOn(service, 'tick').mockResolvedValue();

    expect(vscodeMock.createFileSystemWatcher).not.toHaveBeenCalled();
    const hold = service.observe();

    expect(vscodeMock.createFileSystemWatcher).toHaveBeenCalledTimes(1);
    const [pattern] = vscodeMock.createFileSystemWatcher.mock.calls[0] as [FakeRelativePattern];
    expect(pattern.base).toEqual({ fsPath: projectsRoot() });
    expect(pattern.pattern).toBe('**/*');

    hold.dispose();
    service.dispose();
  });

  it('does not start a second watcher for a second concurrent observer', () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    vi.spyOn(service, 'tick').mockResolvedValue();

    const holdA = service.observe();
    const holdB = service.observe();
    expect(vscodeMock.createFileSystemWatcher).toHaveBeenCalledTimes(1);

    holdA.dispose();
    holdB.dispose();
    service.dispose();
  });

  it('disposes the watcher once the last observer releases', () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    vi.spyOn(service, 'tick').mockResolvedValue();

    const hold = service.observe();
    const watcher = vscodeMock.watchers[0];
    expect(watcher.disposed).toBe(false);

    hold.dispose();
    expect(watcher.disposed).toBe(true);

    service.dispose();
  });

  it('schedules a debounced extra tick when the watcher fires, on top of the poll', async () => {
    vi.useFakeTimers();
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot(), intervalMs: 5_000 });
    const tick = vi.spyOn(service, 'tick').mockResolvedValue();

    const hold = service.observe();
    expect(tick).toHaveBeenCalledTimes(1); // the immediate scan on observe()

    const watcher = vscodeMock.watchers[0];
    tick.mockClear();
    watcher.fireChange();
    watcher.fireChange(); // a burst collapses into one extra tick, not two
    expect(tick).not.toHaveBeenCalled(); // debounced, not immediate

    await vi.advanceTimersByTimeAsync(300);
    expect(tick).toHaveBeenCalledTimes(1);

    hold.dispose();
    service.dispose();
    vi.useRealTimers();
  });

  it('cancels a pending watcher-triggered tick if the last observer releases first', async () => {
    vi.useFakeTimers();
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    const tick = vi.spyOn(service, 'tick').mockResolvedValue();

    const hold = service.observe();
    const watcher = vscodeMock.watchers[0];
    tick.mockClear();
    watcher.fireCreate();
    hold.dispose();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).not.toHaveBeenCalled();

    service.dispose();
    vi.useRealTimers();
  });

  it('never throws if the watcher fails to construct, and polling still works', async () => {
    vi.useFakeTimers();
    vscodeMock.createFileSystemWatcher.mockImplementation(() => {
      throw new Error('watcher unsupported here');
    });
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot(), intervalMs: 5_000 });
    const tick = vi.spyOn(service, 'tick').mockResolvedValue();

    let hold: ReturnType<typeof service.observe> | undefined;
    expect(() => {
      hold = service.observe();
    }).not.toThrow();
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(2); // the poll baseline is unaffected

    hold?.dispose();
    service.dispose();
    vi.useRealTimers();
  });
});

describe('FleetService fleetChanged debounce and dedupe', () => {
  it('emits on the first scan', async () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    const listener = vi.fn();
    service.onDidChange(listener);

    await service.tick();

    expect(listener).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it('skips emitting when the new scan is unchanged from the last one', async () => {
    let clock = 0;
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot(), now: () => clock });
    const listener = vi.fn();
    service.onDidChange(listener);

    await service.tick();
    expect(listener).toHaveBeenCalledTimes(1);

    clock += 10_000; // well past the 500ms debounce window
    await service.tick();

    expect(listener).toHaveBeenCalledTimes(1); // nothing changed, so no second event
    service.dispose();
  });

  it('coalesces two real changes that land inside the same 500ms window into one emission', async () => {
    let clock = 0;
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot(), now: () => clock });
    const listener = vi.fn();
    service.onDidChange(listener);

    await writeSessionFile('session-1', new Date());
    await writeAgentFile('session-1', 'agent-a', 'first brief', new Date());
    await service.tick();
    expect(listener).toHaveBeenCalledTimes(1);

    clock += 100; // inside the 500ms window
    await writeAgentFile('session-1', 'agent-b', 'second brief', new Date());
    await service.tick();

    expect(listener).toHaveBeenCalledTimes(1); // coalesced away
    service.dispose();
  });

  it('emits again for a real change once the debounce window has passed', async () => {
    let clock = 0;
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot(), now: () => clock });
    const listener = vi.fn();
    service.onDidChange(listener);

    await writeSessionFile('session-1', new Date());
    await writeAgentFile('session-1', 'agent-a', 'first brief', new Date());
    await service.tick();
    expect(listener).toHaveBeenCalledTimes(1);

    clock += 10_000; // outside the 500ms window
    await writeAgentFile('session-1', 'agent-b', 'second brief', new Date());
    await service.tick();

    expect(listener).toHaveBeenCalledTimes(2);
    service.dispose();
  });
});

describe('FleetService transcript path resolution (P4 reuse)', () => {
  it('resolves an agent target to its subagents file using the session it was discovered under', async () => {
    await writeSessionFile('session-1', new Date());
    await writeAgentFile('session-1', 'agent-a', 'no bead here', new Date());

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    expect(service.filePathFor('agent:agent-a')).toBe(
      join(projectDir, 'session-1', 'subagents', 'agent-agent-a.jsonl'),
    );
    service.dispose();
  });

  it('resolves a session target to the top-level session transcript', async () => {
    await writeSessionFile('session-1', new Date());
    await writeAgentFile('session-1', 'agent-a', 'no bead here', new Date());

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    expect(service.filePathFor('session:session-1')).toBe(join(projectDir, 'session-1.jsonl'));
    service.dispose();
  });

  it('returns null for an agent id that was never discovered', async () => {
    await writeSessionFile('session-1', new Date());
    await writeAgentFile('session-1', 'agent-a', 'no bead here', new Date());

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    expect(service.filePathFor('agent:never-seen')).toBeNull();
    service.dispose();
  });

  it('returns null for a session id that is not a known fleet orchestrator', async () => {
    // A plain session file exists on disk but never got a `subagents` dir, so
    // discovery never made it an orchestrator — it must not resolve either.
    await writeSessionFile('ordinary-session', new Date());

    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    expect(service.filePathFor('session:ordinary-session')).toBeNull();
    service.dispose();
  });

  it('returns null for a targetId with an unrecognized prefix', async () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    expect(service.filePathFor('bogus:whatever')).toBeNull();
    service.dispose();
  });

  it('returns null before any scan has run (no cached project directory yet)', () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    expect(service.filePathFor('agent:agent-a')).toBeNull();
    expect(service.transcriptsBaseDir).toBeNull();
    service.dispose();
  });

  it('returns null when the workspace has no matching ~/.claude/projects directory', async () => {
    const service = new FleetService(cwd, undefined, { projectsRoot: join(root, 'does-not-exist') });
    await service.tick();

    expect(service.filePathFor('agent:agent-a')).toBeNull();
    expect(service.transcriptsBaseDir).toBeNull();
    service.dispose();
  });

  it('exposes the resolved project directory as transcriptsBaseDir once known', async () => {
    await writeSessionFile('session-1', new Date());
    const service = new FleetService(cwd, undefined, { projectsRoot: projectsRoot() });
    await service.tick();

    expect(service.transcriptsBaseDir).toBe(projectDir);
    service.dispose();
  });
});
