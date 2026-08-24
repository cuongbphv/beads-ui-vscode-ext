/**
 * Molecules: "what is executing right now?" — poured/wisp molecule roots,
 * their progress, current step and staleness.
 *
 * Layout/lifecycle cloned from `FleetView`: `useMolecules()` fetches only
 * while this component is mounted, so switching to another tab is exactly
 * what stops the extra `bd mol`/`bd gate` reads `getMolSnapshot` fans out —
 * a project with zero molecules costs exactly the one `bd list --type
 * molecule` call `BdQueries.molSnapshot` short-circuits on (see
 * `queries.ts`), and only while a webview session has this tab open.
 */
import { AlertCircle, FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Bead } from '../../shared/types';
import { MoleculeCard } from '../components/mol/molecule-card';
import { EmptyState, Skeleton } from '../components/primitives';
import { useMolecules } from '../hooks/use-molecules';

export function MoleculesView({
  beadsById,
  onSelect,
  selectedId,
}: {
  /** Full-id lookup for the current-step title on each card. */
  beadsById: ReadonlyMap<string, Bead>;
  onSelect: (id: string) => void;
  selectedId?: string;
}): ReactNode {
  const { snapshot, loading, error } = useMolecules();

  if (!snapshot) {
    if (loading) {
      return (
        <div className="grid gap-2 p-3" aria-busy="true" aria-label="Loading molecules">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      );
    }
    return (
      <EmptyState
        icon={<AlertCircle className="size-10" />}
        title="Couldn't load molecules"
        hint={error?.message ?? 'Waiting for the first read from bd.'}
      />
    );
  }

  if (snapshot.molecules.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConical className="size-10" />}
        title="No molecules in this project"
        hint="Molecules are poured from formulas with `bd mol pour`."
      />
    );
  }

  return (
    <div className="@container h-full overflow-y-auto p-3">
      {snapshot.degraded ? (
        <div
          role="status"
          className="border-warning text-warning mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>Some molecules' progress could not be read — their cards show what is available.</p>
        </div>
      ) : null}

      <ul className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {snapshot.molecules.map((item) => (
          <li key={item.root.id}>
            <MoleculeCard
              item={item}
              beadsById={beadsById}
              onSelect={onSelect}
              selected={item.root.id === selectedId}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
