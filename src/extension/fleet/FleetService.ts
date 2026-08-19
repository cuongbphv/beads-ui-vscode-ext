/**
 * Discovering the fleet: which Claude Code sessions are running as fleet
 * orchestrators/workers against this workspace, which git worktrees exist
 * alongside it, and how each worktree's git status looks right now.
 *
 * This is the third deliberate process-spawn point outside `BdService` (after
 * `actor.ts`'s `git config user.name`): it shells out to `git worktree list`,
 * `git status`, and `git diff` — via `./worktree-git.ts` — to answer "what has
 * changed in this worktree", never a beads operation. Fleet data is not `bd`
 * data, so it does not go through `BdService`, but it owes the same
 * discipline that class is a contract for: every spawn is read-only, every
 * spawn is bounded, and a spawn failure degrades one row rather than the
 * whole snapshot.
 *
 * Discovery itself reads `~/.claude/projects/<mangled-cwd>` — Claude Code's
 * own transcript store, encoded per `./lib/session-locator.ts` — never a
 * `bd`/beads path, so cardinal sin #1 (never read `.beads/issues.jsonl`
 * directly) does not apply here: this is a different product's data, read
 * because the Fleet tab exists to watch it. A missing `~/.claude/projects`
 * degrades to a `'no-claude-dir'` snapshot rather than throwing.
 *
 * Watcher experiment (beads-ui-vscode-ext-37b): `~/.claude/projects` sits
 * outside every workspace folder, so whether
 * `vscode.workspace.createFileSystemWatcher` even fires for a `RelativePattern`
 * rooted there was `[Unverified]` going in — VS Code does not document this,
 * and some watcher backends silently no-op outside a workspace. Measured
 * against a real Extension Development Host (not assumed): it works. Three
 * runs each wrote a file, appended to it, then wrote a second file, all
 * inside a fresh out-of-workspace temp directory; `onDidChange` fired every
 * time (3/3, immediately), and `onDidCreate` fired for the *second* file
 * every time but never for the very first file created ~500ms after the
 * watcher was registered (latency measured at ~6.1s each run — i.e. it
 * caught the second file, not the first). That reads as a real, working
 * native watcher with a short startup race right after registration, not an
 * unsupported or silently-broken API. Given that race is bounded to the
 * first moments after `observe()` starts — exactly when the immediate
 * `tick()` below already covers it — the watcher is wired in as a fast path
 * (`scheduleWatchTick`), and polling (`DISCOVERY_INTERVAL_MS`) stays the
 * always-on baseline regardless: a missed or delayed watcher event costs at
 * most one poll interval, never a stuck snapshot.
 */
import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import * as vscode from 'vscode';

import type { FleetOrchestrator, FleetSnapshot, FleetWorker, FleetWorktree } from '../../shared/fleet';
import { matchWorktreesToBeads, type MatchableWorker, type MatchableWorktree } from './lib/bead-match';
import { findProjectDirFor } from './lib/session-locator';
import { parseSpawnBrief } from './lib/spawn-brief';
import { Debouncer } from '../poll-gate';
import { listWorktrees, WorktreeGitProbe, type DiscoveredWorktree } from './worktree-git';

/** How often discovery re-scans while at least one subscriber is watching. */
export const DISCOVERY_INTERVAL_MS = 5_000;
/** Coalescing window for `fleetChanged` — a burst of filesystem events collapses into one push. */
export const EMIT_DEBOUNCE_MS = 500;
/**
 * Coalescing window for the `~/.claude/projects` file watcher's fast path —
 * a burst of writes (a transcript appending several lines) collapses into one
 * extra `tick()` instead of one per event. This is purely a latency
 * optimization on top of `DISCOVERY_INTERVAL_MS`'s poll, never a replacement
 * for it: see the class doc's "watcher experiment" note.
 */
export const WATCH_DEBOUNCE_MS = 300;
/** A worker with no transcript activity inside this window reads as idle, not running. */
const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
/** How much of an agent transcript's first line is read to find its spawn brief. */
const BRIEF_READ_CAP_BYTES = 64 * 1024;
/** `briefSummary` is for a one-line list row, not a second copy of the brief. */
const BRIEF_SUMMARY_CAP_CHARS = 240;

export interface FleetServiceOptions {
  /** Override for `~/.claude/projects` — the test suite points this at a fixture directory. */
  projectsRoot?: string;
  /** Override for the discovery tick cadence. Production always uses the default. */
  intervalMs?: number;
  /** Injectable clock, for the test suite. */
  now?: () => number;
}

export class FleetService implements vscode.Disposable {
  private readonly projectsRoot: string;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly gitProbe: WorktreeGitProbe;
  private readonly emitDebouncer: Debouncer;

  private timer: NodeJS.Timeout | undefined;
  /** The fast-path watcher on `projectsRoot` — live only while `observers > 0`, same as `timer`. */
  private watcher: vscode.FileSystemWatcher | undefined;
  private watchDebounceTimer: NodeJS.Timeout | undefined;
  private observers = 0;
  private scanning: Promise<void> | undefined;
  private lastEmittedComparable: string | undefined;
  private current: FleetSnapshot | undefined;
  /** The on-disk directory name matching `cwd`, cached from the last successful scan (P4's transcript resolution). */
  private projectDirName: string | null = null;

  private readonly emitter = new vscode.EventEmitter<FleetSnapshot>();
  /** Fires with a fresh snapshot — debounced and skipped on no real change; see `maybeEmit`. */
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly cwd: string,
    private readonly log: (message: string) => void = () => {},
    options: FleetServiceOptions = {},
  ) {
    this.projectsRoot = options.projectsRoot ?? join(homedir(), '.claude', 'projects');
    this.intervalMs = options.intervalMs ?? DISCOVERY_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.gitProbe = new WorktreeGitProbe(undefined, this.now);
    this.emitDebouncer = new Debouncer(EMIT_DEBOUNCE_MS, this.now);
  }

  /** The last snapshot computed, if any — for a fresh subscriber to catch up on without waiting for a tick. */
  get snapshot(): FleetSnapshot | undefined {
    return this.current;
  }

  /**
   * The directory every transcript path this service resolves must live
   * under — `TranscriptTailer`'s containment-check base. `null` until at
   * least one scan has found the project directory matching `cwd`.
   */
  get transcriptsBaseDir(): string | null {
    return this.projectDirName ? join(this.projectsRoot, this.projectDirName) : null;
  }

  /**
   * Resolve a transcript `targetId` (`agent:<agentId>` or `session:<sessionId>`,
   * per `TranscriptTarget`) to the absolute path of its transcript file, using
   * the session/worker associations the last scan already discovered — never
   * a fresh directory walk (Fleet P4 reuses P3's discovery here rather than
   * re-deriving it). Returns `null` when the project directory, or the
   * specific agent/session, is not (yet) known.
   */
  filePathFor(targetId: string): string | null {
    if (!this.projectDirName) return null;
    const projectPath = join(this.projectsRoot, this.projectDirName);

    if (targetId.startsWith('agent:')) {
      const agentId = targetId.slice('agent:'.length);
      const worker = this.current?.workers.find((candidate) => candidate.agentId === agentId);
      if (!worker) return null;
      return join(projectPath, worker.sessionId, 'subagents', `agent-${agentId}.jsonl`);
    }

    if (targetId.startsWith('session:')) {
      const sessionId = targetId.slice('session:'.length);
      const orchestrator = this.current?.orchestrators.find((candidate) => candidate.sessionId === sessionId);
      if (!orchestrator) return null;
      return join(projectPath, `${sessionId}.jsonl`);
    }

    return null;
  }

  /**
   * Register a subscriber as watching. Dispose the result to stop: the last
   * release also stops the timer, so nothing scans the filesystem or spawns
   * git while nobody is looking (verified in `FleetService.test.ts` and in
   * the bead's own closing simulation via a call counter).
   */
  observe(): vscode.Disposable {
    this.observers += 1;
    if (this.observers === 1) {
      this.restartTimer();
      this.startWatcher();
      void this.tick();
    }

    let released = false;
    return {
      dispose: () => {
        if (released) return;
        released = true;
        this.observers = Math.max(0, this.observers - 1);
        if (this.observers === 0) {
          this.restartTimer();
          this.stopWatcher();
        }
      },
    };
  }

  /** One discovery cycle: scan, then emit if the result is new. Public for the unit suite. */
  async tick(): Promise<void> {
    if (this.scanning) return this.scanning;

    this.scanning = (async () => {
      try {
        const snapshot = await this.scan();
        this.current = snapshot;
        this.maybeEmit(snapshot);
      } catch (error) {
        this.log(`fleet discovery failed: ${errorMessage(error)}`);
      } finally {
        this.scanning = undefined;
      }
    })();

    return this.scanning;
  }

  private maybeEmit(snapshot: FleetSnapshot): void {
    const comparable = comparableJson(snapshot);
    // Unchanged since the last push: never worth an event, and never worth
    // spending the debounce window on either.
    if (comparable === this.lastEmittedComparable) return;
    if (!this.emitDebouncer.signal()) return;

    this.lastEmittedComparable = comparable;
    this.emitter.fire(snapshot);
  }

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.observers === 0) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  /**
   * Best-effort fast path on top of the poll: watch `projectsRoot` for any
   * create/change/delete and schedule an extra `tick()` shortly after,
   * rather than waiting out the rest of the current poll interval. Never a
   * substitute for the timer above — see the class doc's watcher experiment
   * — so a watcher that fails to construct (or never fires) just leaves
   * discovery exactly as fast as the poll, no worse.
   */
  private startWatcher(): void {
    if (this.watcher) return;
    try {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(this.projectsRoot), '**/*');
      this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onEvent = (): void => this.scheduleWatchTick();
      this.watcher.onDidCreate(onEvent);
      this.watcher.onDidChange(onEvent);
      this.watcher.onDidDelete(onEvent);
    } catch (error) {
      this.log(`fleet discovery: could not start a file watcher for ${this.projectsRoot}: ${errorMessage(error)}`);
      this.watcher = undefined;
    }
  }

  private stopWatcher(): void {
    if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
    this.watchDebounceTimer = undefined;
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private scheduleWatchTick(): void {
    if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
    this.watchDebounceTimer = setTimeout(() => void this.tick(), WATCH_DEBOUNCE_MS);
  }

  private async scan(): Promise<FleetSnapshot> {
    const generatedAt = new Date().toISOString();
    const sessions = await this.discoverSessions();
    const { worktrees, orphanWorktrees } = await this.discoverWorktrees(sessions.workers);

    return {
      orchestrators: sessions.orchestrators,
      workers: sessions.workers,
      worktrees,
      orphanWorktrees,
      degraded: sessions.degraded,
      generatedAt,
    };
  }

  /**
   * Walk `~/.claude/projects/<mangled-cwd>` for session transcripts. A
   * session is a fleet orchestrator only once it has spawned at least one
   * worker (a `subagents/agent-*.jsonl` file); an ordinary chat session with
   * no `subagents` directory is silently not part of the fleet.
   */
  private async discoverSessions(): Promise<{
    orchestrators: FleetOrchestrator[];
    workers: FleetWorker[];
    degraded?: { reason: string };
  }> {
    let projectDirNames: string[];
    try {
      const entries = await fs.readdir(this.projectsRoot, { withFileTypes: true });
      projectDirNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      this.projectDirName = null;
      if (isEnoent(error)) return { orchestrators: [], workers: [], degraded: { reason: 'no-claude-dir' } };
      this.log(`fleet discovery: could not read ${this.projectsRoot}: ${errorMessage(error)}`);
      return { orchestrators: [], workers: [], degraded: { reason: 'no-claude-dir' } };
    }

    const projectDirName = findProjectDirFor(projectDirNames, this.cwd);
    this.projectDirName = projectDirName;
    if (!projectDirName) return { orchestrators: [], workers: [] };

    const projectPath = join(this.projectsRoot, projectDirName);
    let topEntries: Dirent[];
    try {
      topEntries = await fs.readdir(projectPath, { withFileTypes: true });
    } catch (error) {
      this.log(`fleet discovery: could not read ${projectPath}: ${errorMessage(error)}`);
      return { orchestrators: [], workers: [] };
    }

    const sessionIds = topEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name.slice(0, -'.jsonl'.length));

    const orchestrators: FleetOrchestrator[] = [];
    const workers: FleetWorker[] = [];

    for (const sessionId of sessionIds) {
      const subagentsDir = join(projectPath, sessionId, 'subagents');
      let agentEntries: Dirent[];
      try {
        agentEntries = await fs.readdir(subagentsDir, { withFileTypes: true });
      } catch {
        continue; // No `subagents` dir: an ordinary session, not a fleet orchestrator.
      }

      const agentFiles = agentEntries.filter(
        (entry) => entry.isFile() && /^agent-.+\.jsonl$/.test(entry.name),
      );
      if (agentFiles.length === 0) continue;

      const workerIds: string[] = [];
      for (const file of agentFiles) {
        const agentId = file.name.slice('agent-'.length, -'.jsonl'.length);
        const worker = await this.readWorker(agentId, sessionId, join(subagentsDir, file.name));
        workers.push(worker);
        workerIds.push(agentId);
      }

      const lastActivityAt = await mtimeIso(join(projectPath, `${sessionId}.jsonl`));
      orchestrators.push({ sessionId, workerIds, lastActivityAt });
    }

    return { orchestrators, workers };
  }

  private async readWorker(agentId: string, sessionId: string, filePath: string): Promise<FleetWorker> {
    const lastActivityAt = await mtimeIso(filePath);
    const brief = await readFirstUserMessage(filePath);
    const parsed = brief ? parseSpawnBrief(brief) : null;

    return {
      agentId,
      sessionId,
      beadId: parsed?.beadId ?? null,
      worktreePath: parsed?.worktreePath ?? null,
      briefSummary: brief ? firstLineOf(brief) : '',
      lastActivityAt,
      status: workerStatus(lastActivityAt, this.now()),
    };
  }

  /**
   * Enumerate worktrees and measure each one's git status. Only `wt-*`
   * directories are the Fleet tab's business — the primary checkout (this
   * workspace itself) is never something a worker spawns, and would
   * otherwise show up as a permanently "orphaned" worktree.
   */
  private async discoverWorktrees(
    workers: FleetWorker[],
  ): Promise<{ worktrees: FleetWorktree[]; orphanWorktrees: string[] }> {
    let discovered: DiscoveredWorktree[];
    try {
      discovered = await listWorktrees(this.cwd);
    } catch (error) {
      this.log(`fleet discovery: git worktree list failed: ${errorMessage(error)}`);
      return { worktrees: [], orphanWorktrees: [] };
    }

    const fleetWorktrees = discovered.filter((worktree) => !worktree.bare && /^wt-/i.test(worktree.dirName));

    const matchableWorktrees: MatchableWorktree[] = fleetWorktrees.map((worktree) => ({
      path: worktree.path,
      dirName: worktree.dirName,
    }));
    const matchableWorkers: MatchableWorker[] = workers.map((worker) => ({
      agentId: worker.agentId,
      beadId: worker.beadId,
      worktreePath: worker.worktreePath,
    }));
    const { worktreeToBeadId, orphanWorktrees } = matchWorktreesToBeads(matchableWorktrees, matchableWorkers);

    const worktrees = await Promise.all(
      fleetWorktrees.map(async (worktree): Promise<FleetWorktree> => ({
        path: worktree.path,
        dirName: worktree.dirName,
        git: await this.gitProbe.statusFor(worktree.path, worktree.branch),
        beadId: worktreeToBeadId.get(worktree.path) ?? null,
      })),
    );

    return { worktrees, orphanWorktrees };
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.stopWatcher();
    this.emitter.dispose();
  }
}

function workerStatus(lastActivityAt: string | null, now: number): FleetWorker['status'] {
  if (!lastActivityAt) return 'unknown';
  const timestamp = Date.parse(lastActivityAt);
  if (Number.isNaN(timestamp)) return 'unknown';
  return now - timestamp <= ACTIVE_WINDOW_MS ? 'running' : 'idle';
}

async function mtimeIso(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Read just enough of an agent transcript to find its first line — the JSON
 * envelope around the spawn brief — without loading a file that can run into
 * the megabytes. Returns `null` on anything unreadable or unparseable; the
 * caller then leaves the worker unmatched rather than guessing.
 */
async function readFirstUserMessage(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(BRIEF_READ_CAP_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, BRIEF_READ_CAP_BYTES, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const newlineIndex = text.indexOf('\n');
    const firstLine = newlineIndex === -1 ? text : text.slice(0, newlineIndex);
    if (!firstLine.trim()) return null;

    const parsed = JSON.parse(firstLine) as { message?: { content?: unknown } };
    const content = parsed.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((block) =>
          block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
            ? (block as { text: string }).text
            : '',
        )
        .join('\n');
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function firstLineOf(text: string): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > BRIEF_SUMMARY_CAP_CHARS ? `${line.slice(0, BRIEF_SUMMARY_CAP_CHARS)}…` : line;
}

/**
 * The same snapshot in JSON, minus the timestamps that change on every scan
 * regardless of whether anything real did (`generatedAt`, each worktree's
 * `git.measuredAt`) — what `maybeEmit` diffs to decide whether a tick was a
 * no-op.
 */
function comparableJson(snapshot: FleetSnapshot): string {
  return JSON.stringify(snapshot, (key, value) =>
    key === 'generatedAt' || key === 'measuredAt' ? undefined : value,
  );
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
