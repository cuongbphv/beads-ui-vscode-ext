/**
 * The Fleet tab's main view: orchestrator sessions and the workers they
 * spawned, plus a separate section for worktrees on disk that no worker
 * currently claims (`orphanWorktrees` — the "stale" section that resolves
 * `beads-ui-vscode-ext-l3d`'s question of what a stale worktree even means).
 *
 * A worker row and an orchestrator's header are both selectable — clicking
 * (or Enter/Space) calls `onSelectTarget` with the `TranscriptTarget` string
 * (`agent:<id>` / `session:<id>`) `FleetView` hands to its transcript pane,
 * mirroring `BeadCard`'s selectable-row convention: `role="button"`,
 * `aria-current="true"` on the selected one (a *selection*, not a toggle —
 * `aria-pressed` is reserved for the transcript's own follow-mode button).
 *
 * Purely presentational: every value here already arrived through
 * `use-fleet.ts` via the RPC bridge. This component never touches
 * `child_process`, the filesystem, or the network — the cardinal sin the
 * dashboard's webview half exists to never commit.
 *
 * Ordering and the status filter (beads-ui-vscode-ext-w9a.6) are both pure
 * functions from `shared/` (`sortByRecency`, `filterWorkersByStatus`) applied
 * here rather than inline, so they stay testable without mounting React.
 */
import { Bot, GitBranch, User } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

import type { FleetSnapshot, FleetWorker } from '../../../shared/fleet';
import { filterWorkersByStatus, type FleetStatusFilter } from '../../../shared/fleet-filter';
import { sortByRecency } from '../../../shared/fleet-sort';
import { cn, relativeTime } from '../../lib/utils';
import { EmptyState } from '../primitives';
import { GitChanges } from './git-changes';

/** Enter/Space activate a selectable row, matching `BeadCard`'s own keyboard contract. */
function onSelectableKeyDown(event: KeyboardEvent<HTMLElement>, onSelect: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onSelect();
}

/**
 * Orchestrator header count (beads-ui-vscode-ext-w9a.9): always describes the
 * orchestrator's TRUE total worker count, never the status-filtered subset,
 * so an idle-but-real fleet never reads as "0 workers" / "no data". When the
 * filter hides some of that total, the count spells out the split instead of
 * silently reporting only what's visible below.
 */
function workerCountLabel(filteredCount: number, totalCount: number): string {
  const noun = `worker${totalCount === 1 ? '' : 's'}`;
  return filteredCount === totalCount ? `${totalCount} ${noun}` : `${filteredCount} of ${totalCount} ${noun}`;
}

const STATUS_LABEL: Record<FleetWorker['status'], string> = {
  running: 'Running',
  idle: 'Idle',
  unknown: 'Unknown',
};

const STATUS_CLASS: Record<FleetWorker['status'], string> = {
  running: 'text-success',
  idle: 'text-fg-muted',
  unknown: 'text-fg-muted',
};

const DEGRADED_HINT: Record<string, string> = {
  'no-claude-dir':
    'No ~/.claude/projects directory was found on this machine — the Fleet tab has nothing to watch yet.',
};

export function WorkerList({
  snapshot,
  selectedTarget,
  onSelectTarget,
  statusFilter = 'all',
}: {
  snapshot: FleetSnapshot;
  /** The `TranscriptTarget` string currently shown in the detail pane, or `null` when none is. */
  selectedTarget: string | null;
  onSelectTarget: (targetId: string) => void;
  /** Narrows which workers are listed under each orchestrator. Defaults to 'all'. */
  statusFilter?: FleetStatusFilter;
}): ReactNode {
  if (snapshot.degraded) {
    return (
      <EmptyState
        icon={<Bot className="size-10" />}
        title="No Claude Code session data"
        hint={DEGRADED_HINT[snapshot.degraded.reason] ?? snapshot.degraded.reason}
      />
    );
  }

  const worktreeByPath = new Map(snapshot.worktrees.map((worktree) => [worktree.path, worktree]));
  const orphanPaths = new Set(snapshot.orphanWorktrees);
  const staleWorktrees = snapshot.worktrees.filter((worktree) => orphanPaths.has(worktree.path));

  // Most recently active first; the status filter only ever narrows which
  // workers show up under their (still recency-sorted) orchestrator.
  const orchestrators = sortByRecency(snapshot.orchestrators);
  const allSortedWorkers = sortByRecency(snapshot.workers);
  const sortedWorkers = filterWorkersByStatus(allSortedWorkers, statusFilter);

  if (snapshot.orchestrators.length === 0 && staleWorktrees.length === 0) {
    return (
      <EmptyState
        icon={<Bot className="size-10" />}
        title="No fleet activity"
        hint="No orchestrator session in this workspace has spawned a worker yet."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {orchestrators.map((orchestrator) => {
        const workers = sortedWorkers.filter((worker) => worker.sessionId === orchestrator.sessionId);
        const totalWorkers = allSortedWorkers.filter(
          (worker) => worker.sessionId === orchestrator.sessionId,
        ).length;
        const sessionTarget = `session:${orchestrator.sessionId}`;
        const sessionSelected = selectedTarget === sessionTarget;
        return (
          <section key={orchestrator.sessionId} className="border-border rounded-md border">
            <header
              role="button"
              tabIndex={0}
              aria-current={sessionSelected ? 'true' : undefined}
              aria-label={`Orchestrator session ${orchestrator.sessionId}: view its transcript`}
              onClick={() => onSelectTarget(sessionTarget)}
              onKeyDown={(event) => onSelectableKeyDown(event, () => onSelectTarget(sessionTarget))}
              className={cn(
                'surface-interactive border-border text-fg-muted flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-xs',
                sessionSelected && 'bg-surface-active text-fg',
              )}
            >
              <Bot aria-hidden="true" className="size-3.5" />
              <span className="font-mono">orchestrator {orchestrator.sessionId.slice(0, 8)}</span>
              <span>· {workerCountLabel(workers.length, totalWorkers)}</span>
              {orchestrator.lastActivityAt ? (
                <span className="ml-auto" title={orchestrator.lastActivityAt}>
                  {relativeTime(orchestrator.lastActivityAt)}
                </span>
              ) : null}
            </header>
            <ul className="divide-border divide-y">
              {workers.map((worker) => {
                const worktree = worker.worktreePath ? worktreeByPath.get(worker.worktreePath) : undefined;
                const workerTarget = `agent:${worker.agentId}`;
                const workerSelected = selectedTarget === workerTarget;
                return (
                  <li
                    key={worker.agentId}
                    role="button"
                    tabIndex={0}
                    aria-current={workerSelected ? 'true' : undefined}
                    aria-label={`Worker ${worker.agentId}: view its transcript`}
                    onClick={() => onSelectTarget(workerTarget)}
                    onKeyDown={(event) => onSelectableKeyDown(event, () => onSelectTarget(workerTarget))}
                    className={cn(
                      'surface-interactive flex cursor-pointer flex-col gap-1 px-3 py-2',
                      workerSelected && 'bg-surface-active',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <User aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className={cn('text-xs font-medium', STATUS_CLASS[worker.status])}>
                        {STATUS_LABEL[worker.status]}
                      </span>
                      {worker.beadId ? (
                        <span className="text-fg-muted font-mono text-xs">{worker.beadId}</span>
                      ) : null}
                      {worker.lastActivityAt ? (
                        <span className="text-fg-muted ml-auto text-xs" title={worker.lastActivityAt}>
                          {relativeTime(worker.lastActivityAt)}
                        </span>
                      ) : null}
                    </div>
                    {worker.briefSummary ? (
                      <p className="text-fg truncate text-sm" title={worker.briefSummary}>
                        {worker.briefSummary}
                      </p>
                    ) : null}
                    {worker.worktreePath ? (
                      <div className="text-fg-muted flex items-center gap-2 text-xs">
                        <span className="inline-flex items-center gap-1" title={worker.worktreePath}>
                          <GitBranch aria-hidden="true" className="size-3" />
                          {worktree?.dirName ?? worker.worktreePath}
                        </span>
                        <GitChanges git={worktree?.git} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {staleWorktrees.length > 0 ? (
        <section className="border-warning/50 rounded-md border" aria-label="Stale worktrees">
          <header className="border-warning/50 text-warning border-b px-3 py-2 text-xs font-medium">
            Stale worktrees — no active worker
          </header>
          <ul className="divide-border divide-y">
            {staleWorktrees.map((worktree) => (
              <li key={worktree.path} className="flex items-center gap-2 px-3 py-2 text-sm">
                <GitBranch aria-hidden="true" className="text-fg-muted size-3.5 shrink-0" />
                <span className="font-mono" title={worktree.path}>
                  {worktree.dirName}
                </span>
                {worktree.beadId ? (
                  <span className="text-fg-muted font-mono text-xs">{worktree.beadId}</span>
                ) : null}
                <span className="ml-auto">
                  <GitChanges git={worktree.git} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
