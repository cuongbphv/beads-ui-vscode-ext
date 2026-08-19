/**
 * Git probes behind the Fleet tab's worktree status: `git worktree list
 * --porcelain` to enumerate worktrees, then per worktree `git -C <wt> status
 * --porcelain=v1 -z` and `git -C <wt> diff HEAD --numstat` to measure what
 * changed.
 *
 * Every call here is read-only, and every one is bounded two ways: a 3s
 * timeout so a hung git (a stale lock file, a slow network mount) can never
 * stall discovery, and a 3s-per-worktree rate limit (`WorktreeGitProbe`) so a
 * caller polling faster than that gets the last measurement back instead of
 * spawning git again. A failure on any single worktree becomes that
 * worktree's `git.error` field rather than a throw — one broken worktree must
 * never blank the rest of the Fleet snapshot.
 *
 * The process spawn and its error handling live here; the text parsing of
 * what git prints belongs to `./lib/git-parse.ts` (P1), which this module
 * calls but never duplicates.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { WorktreeGitStatus } from '../../shared/fleet';
import {
  parseNumstat,
  parseStatusPorcelainZ,
  parseWorktreeList,
  type ParsedWorktree,
} from './lib/git-parse';

const execFileAsync = promisify(execFile);

/** git answers instantly or it is broken; never hold up discovery for it. */
export const GIT_TIMEOUT_MS = 3_000;
/** Never re-measure the same worktree more often than this, however often polled. */
export const MIN_MEASURE_INTERVAL_MS = 3_000;

export interface DiscoveredWorktree extends ParsedWorktree {
  /** Directory's own name, e.g. `wt-19r1` — `path`'s last segment. */
  dirName: string;
}

function dirNameOf(worktreePath: string): string {
  const normalized = worktreePath.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || normalized;
}

interface ExecFailure {
  code?: number | string;
  message?: string;
}

/**
 * Run `git -C <targetCwd> <args>`, retried once through the shell on ENOENT —
 * the same Windows fallback `BdService` and `ActorResolver` use for their own
 * spawns (an npm-installed shim, or a git wrapper, that `execFile` cannot
 * always launch directly).
 */
async function runGit(targetCwd: string, args: string[]): Promise<string> {
  const gitArgs = ['-C', targetCwd, ...args];
  const options = {
    cwd: targetCwd,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    encoding: 'utf8' as const,
  };

  try {
    const { stdout } = await execFileAsync('git', gitArgs, options);
    return stdout;
  } catch (error) {
    if ((error as ExecFailure).code !== 'ENOENT') throw error;
    const { stdout } = await execFileAsync('git', gitArgs, { ...options, shell: true });
    return stdout;
  }
}

/**
 * List every worktree `git` knows about for the repository at (or
 * containing) `cwd`. Throws on failure — the caller (`FleetService`) decides
 * how to degrade a whole-fleet failure, which is a different decision from a
 * single worktree's `git.error`.
 */
export async function listWorktrees(cwd: string): Promise<DiscoveredWorktree[]> {
  const output = await runGit(cwd, ['worktree', 'list', '--porcelain']);
  return parseWorktreeList(output).map((worktree) => ({
    ...worktree,
    dirName: dirNameOf(worktree.path),
  }));
}

/**
 * Measures git status + diffstat for one worktree at a time, caching each
 * reading for `minIntervalMs` so a caller that polls more often than that —
 * a manual refresh landing right after a timer tick, say — reuses the answer
 * instead of shelling out again.
 */
export class WorktreeGitProbe {
  private readonly cache = new Map<string, { status: WorktreeGitStatus; at: number }>();

  constructor(
    private readonly minIntervalMs: number = MIN_MEASURE_INTERVAL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async statusFor(worktreePath: string, branch: string | null): Promise<WorktreeGitStatus> {
    const cached = this.cache.get(worktreePath);
    if (cached && this.now() - cached.at < this.minIntervalMs) return cached.status;

    const status = await this.measure(worktreePath, branch);
    this.cache.set(worktreePath, { status, at: this.now() });
    return status;
  }

  private async measure(worktreePath: string, branch: string | null): Promise<WorktreeGitStatus> {
    const measuredAt = new Date().toISOString();
    try {
      const [statusOut, diffOut] = await Promise.all([
        runGit(worktreePath, ['status', '--porcelain=v1', '-z']),
        runGit(worktreePath, ['diff', 'HEAD', '--numstat']),
      ]);
      const changedFiles = parseStatusPorcelainZ(statusOut).length;
      const numstat = parseNumstat(diffOut);
      const insertions = numstat.reduce((sum, entry) => sum + entry.insertions, 0);
      const deletions = numstat.reduce((sum, entry) => sum + entry.deletions, 0);
      return { branch, changedFiles, insertions, deletions, measuredAt };
    } catch (error) {
      return {
        branch,
        changedFiles: 0,
        insertions: 0,
        deletions: 0,
        error: error instanceof Error ? error.message : String(error),
        measuredAt,
      };
    }
  }
}
