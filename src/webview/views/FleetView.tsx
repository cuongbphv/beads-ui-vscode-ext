/**
 * Fleet: which orchestrator sessions and workers are running against this
 * workspace, which worktrees on disk are stale, and — once a worker or
 * session is selected — that target's live transcript (Fleet P4's
 * `Transcript`, wired in here for beads-ui-vscode-ext-37b).
 *
 * `useFleet()` subscribes on mount and unsubscribes on unmount, so this
 * component being on screen is exactly what gates the extension host's
 * discovery loop (`FleetService.observe`) — switching to another tab
 * unmounts it and the polling stops with it, mirroring how the bd store's
 * poll gate is charged to whoever is looking.
 *
 * The list + transcript split mirrors `App.tsx`'s own bead-detail split: a
 * fixed, resizable side panel at `@3xl` and wider, an absolute overlay
 * covering the whole tab below that — same `Splitter`, same clamp/range
 * maths (`lib/drag-resize.ts`), just measured against this view's own
 * container instead of the whole dashboard's.
 *
 * The status filter above the list (beads-ui-vscode-ext-w9a.6) is owned here
 * and persisted by `App.tsx` alongside `fleetDetailWidth`; `WorkerList` itself
 * stays a pure function of `snapshot` + `statusFilter`.
 */
import { Bot, ScrollText, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { FLEET_STATUS_FILTERS, type FleetStatusFilter } from '../../shared/fleet-filter';
import { Transcript } from '../components/fleet/transcript';
import { WorkerList } from '../components/fleet/worker-list';
import { EmptyState, Select, Skeleton } from '../components/primitives';
import { Splitter } from '../components/splitter';
import { useFleet } from '../hooks/use-fleet';
import { clamp, DETAIL_MIN_PX, detailMaxWidth, type Range } from '../lib/drag-resize';

/** A human label for the detail pane's header — `agent:<id>` / `session:<id>` without the prefix noise. */
function targetLabel(targetId: string): string {
  if (targetId.startsWith('agent:')) return `Worker ${targetId.slice('agent:'.length)}`;
  if (targetId.startsWith('session:')) return `Orchestrator ${targetId.slice('session:'.length)}`;
  return targetId;
}

const STATUS_FILTER_LABELS: Record<FleetStatusFilter, string> = {
  all: 'All statuses',
  running: 'Running',
  idle: 'Idle',
};

const STATUS_FILTER_OPTIONS = FLEET_STATUS_FILTERS.map((value) => ({
  value,
  label: STATUS_FILTER_LABELS[value],
}));

export function FleetView({
  detailWidth,
  onDetailWidthChange,
  statusFilter,
  onStatusFilterChange,
}: {
  /** Persisted width (px) for the transcript side panel; see `App.tsx`'s `fleetDetailWidth`. */
  detailWidth: number;
  onDetailWidthChange: (px: number) => void;
  /** Persisted worker status filter; see `App.tsx`'s `fleetStatusFilter`. */
  statusFilter: FleetStatusFilter;
  onStatusFilterChange: (filter: FleetStatusFilter) => void;
}): ReactNode {
  const { snapshot, loading } = useFleet();
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const detailRange = useMemo<Range>(
    () => ({ min: DETAIL_MIN_PX, max: detailMaxWidth(containerWidth) }),
    [containerWidth],
  );
  const detailPx = clamp(detailWidth, detailRange);

  // Matches `BeadDetail`'s own Escape-to-close contract.
  useEffect(() => {
    if (!selectedTarget) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelectedTarget(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedTarget]);

  if (!snapshot) {
    return loading ? (
      <div className="grid gap-2 p-3" aria-busy="true" aria-label="Loading fleet">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
    ) : (
      <EmptyState
        icon={<Bot className="size-10" />}
        title="No fleet data yet"
        hint="Waiting for the first discovery scan from the extension host."
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="@container relative flex h-full min-h-0 flex-col"
      style={{ '--fleet-detail-w': `${detailPx}px` } as CSSProperties}
    >
      {/* Same band wrapper Board/Roadmap use for their own `QuickFilterBar`
          (`border-border border-b px-3 py-2`), and the same compact `Select`
          Roadmap's own Sort/Zoom trailing controls use — the Fleet tab has no
          text query to filter, so a single picker fills the whole band. */}
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <Select
          label="Status"
          value={statusFilter}
          onChange={(value) => onStatusFilterChange(value as FleetStatusFilter)}
          options={STATUS_FILTER_OPTIONS}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkerList
          snapshot={snapshot}
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          statusFilter={statusFilter}
        />
      </div>

      {selectedTarget ? (
        <>
          {/* Narrow: the pane covers the list, so there is nothing to split. */}
          <Splitter
            className="hidden @3xl:block"
            label="Resize transcript panel"
            size={detailPx}
            range={detailRange}
            sign={-1}
            onChange={onDetailWidthChange}
          />
          <div className="absolute inset-0 z-10 @3xl:static @3xl:z-auto @3xl:w-[var(--fleet-detail-w)] @3xl:shrink-0">
            <aside
              aria-label={`Transcript for ${targetLabel(selectedTarget)}`}
              className="bg-surface border-border flex h-full min-h-0 w-full flex-col border-l"
            >
              <header className="border-border flex items-center gap-2 border-b px-3 py-2">
                <ScrollText aria-hidden="true" className="text-fg-muted size-3.5 shrink-0" />
                <span className="text-fg-strong truncate text-sm font-medium">
                  {targetLabel(selectedTarget)}
                </span>
                <button
                  type="button"
                  aria-label="Close transcript"
                  onClick={() => setSelectedTarget(null)}
                  className="text-fg-muted hover:text-fg surface-interactive ml-auto shrink-0 rounded-sm"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1">
                <Transcript targetId={selectedTarget} />
              </div>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}
