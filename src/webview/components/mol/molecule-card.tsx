/**
 * One molecule's card on the Molecules tab list.
 *
 * Richer than `BeadCard`'s fixed id/title/type/priority budget on purpose —
 * a molecule card's whole point is progress, current step and staleness, the
 * things `BeadCard` deliberately pushes to the detail pane instead.
 */
import { AlertTriangle, FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';

import { estimateEtaMs, type MolListItem } from '../../../shared/mol';
import { formatDurationMs } from '../../../shared/lease';
import type { Bead } from '../../../shared/types';
import { cn } from '../../lib/utils';
import { PriorityDot, ProgressBar } from '../primitives';

export function MoleculeCard({
  item,
  beadsById,
  onSelect,
  selected,
  now = Date.now(),
}: {
  item: MolListItem;
  /** Full-id lookup so the current step can show a title, not just an id. */
  beadsById: ReadonlyMap<string, Bead>;
  onSelect?: (id: string) => void;
  selected?: boolean;
  /** Injectable clock for tests; the live UI reads the wall clock per render. */
  now?: number;
}): ReactNode {
  const { root, progress, stale, degraded } = item;
  const currentStep = progress?.current_step_id ? beadsById.get(progress.current_step_id) : undefined;
  const etaMs = progress ? estimateEtaMs(root, progress, now) : undefined;

  return (
    <article
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`${root.id}: ${root.title}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect ? () => onSelect(root.id) : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(root.id);
              }
            }
          : undefined
      }
      className={cn(
        'surface-interactive card-raise rounded-md border p-3',
        onSelect && 'cursor-pointer',
        'bg-surface hover:bg-surface-hover border-border hover:border-border-strong',
        selected && 'border-border-strong bg-surface-active',
      )}
    >
      <div className="text-fg-muted flex items-center gap-1.5 text-xs">
        <FlaskConical aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate font-mono opacity-70">{root.id}</span>
        {stale ? (
          <span
            title="Flagged by bd mol stale — complete but still open"
            className="text-warning ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11px]"
          >
            <AlertTriangle aria-hidden="true" className="size-3" />
            stale
          </span>
        ) : null}
      </div>

      <p className="text-fg-strong mt-1 line-clamp-2 text-sm leading-snug">{root.title}</p>

      {progress ? (
        <div className="mt-2">
          <ProgressBar
            done={progress.completed}
            total={progress.total}
            label={`${progress.completed} of ${progress.total} steps done`}
          />
          <div className="text-fg-muted mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="tabular-nums">
              {progress.completed}/{progress.total} steps · {progress.percent}%
            </span>
            {etaMs !== undefined ? (
              <span title="Estimated from the completion rate so far — bd reports no ETA itself">
                ~{formatDurationMs(etaMs)} left
              </span>
            ) : null}
          </div>
          {currentStep ? (
            <p className="text-fg-muted mt-1 truncate text-xs">
              Current: <span className="text-fg">{currentStep.title}</span>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-fg-muted mt-2 text-xs">
          {degraded ? 'Progress unavailable — bd mol progress failed for this molecule.' : 'No progress data.'}
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-2">
        <PriorityDot priority={root.priority} />
      </div>
    </article>
  );
}
