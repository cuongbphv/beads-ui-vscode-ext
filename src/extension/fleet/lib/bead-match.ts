/**
 * Matching fleet workers to worktrees to bead ids, and flagging worktrees on
 * disk that nothing currently claims — orphans, which is what
 * `beads-ui-vscode-ext-l3d` ("Fleet monitor") renders as stale.
 *
 * Matching is fuzzy because a worktree's directory name is often a
 * *shortened* form of the full bead id (`wt-19r1` for bead
 * `beads-ui-vscode-ext-19r.1`), and the dot a short id carries is sometimes
 * dropped entirely from the directory name (`wt-19r1` on disk for bead
 * `19r.1`). Normalizing and suffix-matching that lives in
 * `src/shared/bead-id-match.ts` (framework-free, shared with the webview's
 * lease-badge lookup) so there is one normalizer, not two — this module
 * only strips the worktree's `wt-` prefix before delegating.
 */

import { isSuffixMatch } from '../../../shared/bead-id-match';

/** True when worktree directory `worktreeDirName` plausibly names `beadId`. */
export function worktreeNameMatchesBeadId(worktreeDirName: string, beadId: string): boolean {
  if (typeof worktreeDirName !== 'string' || typeof beadId !== 'string') return false;

  const stripped = worktreeDirName.replace(/^wt-/i, '');
  return isSuffixMatch(stripped, beadId);
}

function samePath(a: string, b: string): boolean {
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}

export interface MatchableWorktree {
  path: string;
  dirName: string;
}

export interface MatchableWorker {
  agentId: string;
  beadId: string | null;
  worktreePath: string | null;
}

export interface BeadMatchResult {
  /** Worktree path -> the bead id it was matched to. */
  worktreeToBeadId: Map<string, string>;
  /** Worktree paths with no worker whose path or bead id matches them. */
  orphanWorktrees: string[];
}

/**
 * Reconcile discovered worktrees against known workers.
 *
 * A worktree is matched, in order of confidence: (1) a worker whose brief
 * named this exact worktree path, (2) a worker whose bead id matches this
 * worktree's directory name (see `worktreeNameMatchesBeadId`). Anything left
 * over is reported as an orphan.
 */
export function matchWorktreesToBeads(
  worktrees: MatchableWorktree[],
  workers: MatchableWorker[],
): BeadMatchResult {
  const worktreeToBeadId = new Map<string, string>();
  const orphanWorktrees: string[] = [];

  for (const worktree of worktrees) {
    const byPath = workers.find(
      (worker) => worker.beadId && worker.worktreePath && samePath(worker.worktreePath, worktree.path),
    );
    if (byPath?.beadId) {
      worktreeToBeadId.set(worktree.path, byPath.beadId);
      continue;
    }

    const byName = workers.find(
      (worker) => worker.beadId && worktreeNameMatchesBeadId(worktree.dirName, worker.beadId),
    );
    if (byName?.beadId) {
      worktreeToBeadId.set(worktree.path, byName.beadId);
      continue;
    }

    orphanWorktrees.push(worktree.path);
  }

  return { worktreeToBeadId, orphanWorktrees };
}
