/**
 * One molecule's expanded detail section, shown inline below the Molecules
 * tab's card grid when its card is selected. Fetches via `showMolecule`
 * through `useMolDetail`; a step click reuses the App-level `BeadDetail`
 * pane through `onSelect` — this component never renders its own detail
 * pane, so there is no duplicate.
 */
import { AlertCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Bead } from '../../../shared/types';
import { useMolDetail } from '../../hooks/use-mol-detail';
import { Skeleton } from '../primitives';
import { StepList } from './step-list';

export function MoleculeDetail({
  root,
  onSelect,
  selectedId,
  onClose,
}: {
  root: Bead;
  onSelect: (id: string) => void;
  selectedId?: string;
  onClose: () => void;
}): ReactNode {
  const { detail, loading, error } = useMolDetail(root.id);

  return (
    <section aria-label={`${root.title} steps`} className="border-border-strong bg-surface mt-2 rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-fg-strong min-w-0 flex-1 truncate text-sm font-medium">{root.title} — steps</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close step list"
          className="text-fg-muted hover:text-fg shrink-0 rounded-sm p-0.5"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      {loading && !detail ? (
        <div className="grid gap-1.5" aria-busy="true" aria-label="Loading steps">
          <Skeleton className="h-8 rounded-md" />
          <Skeleton className="h-8 rounded-md" />
        </div>
      ) : error && !detail ? (
        <p role="status" className="text-warning flex items-center gap-2 text-sm">
          <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
          {error.message || "Could not load this molecule's steps."}
        </p>
      ) : detail ? (
        <StepList
          steps={detail.steps}
          parallelAvailable={detail.parallelAvailable}
          onSelect={onSelect}
          selectedId={selectedId}
        />
      ) : null}
    </section>
  );
}
