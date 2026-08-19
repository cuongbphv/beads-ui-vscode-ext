/**
 * The Fleet tab's diffstat badge: one worktree's `git status`/`git diff`
 * summary, already computed host-side (`FleetService`/`worktree-git.ts`).
 *
 * Purely presentational — no `child_process`, filesystem, or network access
 * from here; every value is whatever `use-fleet.ts` last received over the
 * RPC bridge.
 */
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

import type { WorktreeGitStatus } from '../../../shared/fleet';
import { cn } from '../../lib/utils';

export function GitChanges({ git }: { git: WorktreeGitStatus | undefined }): ReactNode {
  if (!git) return null;

  if (git.error) {
    return (
      <span
        className="text-danger inline-flex items-center gap-1 text-xs"
        title={`git status failed: ${git.error}`}
      >
        <AlertTriangle aria-hidden="true" className="size-3" />
        git error
      </span>
    );
  }

  const clean = git.changedFiles === 0 && git.insertions === 0 && git.deletions === 0;
  if (clean) {
    return <span className="text-fg-muted text-xs">clean</span>;
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs tabular-nums"
      title={`${git.changedFiles} file(s) changed against HEAD`}
    >
      <span className="text-fg-muted">
        {git.changedFiles} file{git.changedFiles === 1 ? '' : 's'}
      </span>
      <span className={cn('text-success', git.insertions === 0 && 'text-fg-muted')}>+{git.insertions}</span>
      <span className={cn('text-danger', git.deletions === 0 && 'text-fg-muted')}>-{git.deletions}</span>
    </span>
  );
}
