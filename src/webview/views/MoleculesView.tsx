/**
 * Molecules: "what is executing right now?" — poured/wisp molecule roots,
 * their progress, current step and staleness.
 *
 * Layout/lifecycle cloned from `FleetView`: `useMolecules()` fetches only
 * while this component is mounted, so switching to another tab is exactly
 * what stops the extra `bd mol`/`bd gate` reads `getMolSnapshot` fans out —
 * a project with zero molecules still reads project-wide gates so standalone
 * human approvals remain visible, and only while this tab is open.
 */
import { AlertCircle, FlaskConical } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import type { Bead } from '../../shared/types';
import { GatesSection } from '../components/mol/gate-card';
import { MoleculeCard } from '../components/mol/molecule-card';
import { MoleculeDetail } from '../components/mol/molecule-detail';
import { WispStrip } from '../components/mol/wisp-strip';
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
  // Which molecule's step list is expanded inline below the grid. A card
  // click still calls `onSelect(root.id)` exactly as bead 8eo.3 wired it
  // (opens the App-level BeadDetail pane for the root) — this is additive,
  // not a replacement.
  const [expandedId, setExpandedId] = useState<string>();
  const handleCardSelect = useCallback(
    (id: string) => {
      onSelect(id);
      setExpandedId(id);
    },
    [onSelect],
  );

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

  if (snapshot.molecules.length === 0 && snapshot.gates.length === 0 && snapshot.wisps.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConical className="size-10" />}
        title="No molecules in this project"
        hint="Molecules are poured from formulas with `bd mol pour`."
      />
    );
  }

  const expandedMolecule = snapshot.molecules.find((item) => item.root.id === expandedId);

  return (
    <div className="@container h-full overflow-y-auto p-3">
      <GatesSection gates={snapshot.gates} />
      <WispStrip wisps={snapshot.wisps} />

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
              onSelect={handleCardSelect}
              selected={item.root.id === selectedId}
            />
          </li>
        ))}
      </ul>

      {expandedMolecule ? (
        <MoleculeDetail
          root={expandedMolecule.root}
          onSelect={onSelect}
          selectedId={selectedId}
          onClose={() => setExpandedId(undefined)}
        />
      ) : null}
    </div>
  );
}
