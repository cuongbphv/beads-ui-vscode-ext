/**
 * Dashboard shell: header, tabs, the selected view, and the detail pane.
 *
 * The detail pane docks beside the content when the container is wide and takes
 * the whole panel when it is not — same component, no duplicate markup.
 */
import { AlertCircle, Bot, LayoutDashboard, Map as MapIcon, RefreshCw, Columns3 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import type { FleetStatusFilter } from '../shared/fleet-filter';
import type { BeadQuery } from '../shared/model';
import { DASHBOARD_TABS, type DashboardTab } from '../shared/protocol';
import type { RoadmapSort } from '../shared/roadmap-sort';
import type { StatusCategory } from '../shared/types';
import { BeadDetail } from './components/bead-detail';
import type { RoadmapZoom } from './components/gantt';
import { Button, EmptyState, Skeleton } from './components/primitives';
import { Splitter } from './components/splitter';
import { ToastProvider } from './components/toast';
import { onHostEvent, persist, restore } from './bridge/rpc';
import { useBeads } from './hooks/use-beads';
import {
  persistedFleetPreferences,
  restoreFleetPreferences,
  type PersistedFleetPreferences,
} from './lib/fleet-preferences';
import { clamp, DETAIL_DEFAULT_PX, DETAIL_MIN_PX, detailMaxWidth, type Range } from './lib/drag-resize';
import {
  persistedRoadmapPreferences,
  restoreRoadmapPreferences,
  type PersistedRoadmapPreferences,
} from './lib/roadmap-preferences';
import type { RoadmapShape } from './lib/roadmap-shape';
import { cn, relativeTime } from './lib/utils';
import { BoardView } from './views/BoardView';
import { FleetView } from './views/FleetView';
import { OverviewView } from './views/OverviewView';
import { RoadmapView } from './views/RoadmapView';

interface PersistedState extends PersistedRoadmapPreferences, PersistedFleetPreferences {
  tab: DashboardTab;
  query: BeadQuery;
  /** Absent until the user first folds or unfolds a board column. */
  collapsedColumns?: StatusCategory[];
  /** Group board columns into taxonomy-label lanes. Absent means off. */
  boardSwimlanes?: boolean;
  /** The Roadmap answers "show closed" for itself; the Board keeps `query`. */
  roadmapShowClosed?: boolean;
  /** Absent until the user picks a shape; the date range decides until then. */
  roadmapShape?: RoadmapShape;
  /** Detail-pane width in px. Absent until the user first drags it. */
  detailWidth?: number;
  /** Fleet tab's own detail-pane width in px. Absent until the user first drags it. */
  fleetDetailWidth?: number;
}

const TAB_META: Record<DashboardTab, { label: string; icon: ReactNode }> = {
  overview: { label: 'Overview', icon: <LayoutDashboard aria-hidden="true" className="size-4" /> },
  roadmap: { label: 'Roadmap', icon: <MapIcon aria-hidden="true" className="size-4" /> },
  board: { label: 'Board', icon: <Columns3 aria-hidden="true" className="size-4" /> },
  fleet: { label: 'Fleet', icon: <Bot aria-hidden="true" className="size-4" /> },
};

export function App(): ReactNode {
  const saved = restore<PersistedState>();
  const restoredRoadmap = restoreRoadmapPreferences(saved);
  const restoredFleet = restoreFleetPreferences(saved);
  const { snapshot, index, error, loading, focusedId, setFocusedId, refresh } = useBeads();

  const [tab, setTab] = useState<DashboardTab>(saved?.tab ?? 'overview');
  // Matches `beadsDashboard.showClosed`, which the host pushes right after
  // connect; this is only what the first frame renders with.
  const [query, setQuery] = useState<BeadQuery>(saved?.query ?? { includeClosed: true });
  const [collapsedColumns, setCollapsedColumns] = useState(saved?.collapsedColumns);
  const [boardSwimlanes, setBoardSwimlanes] = useState(saved?.boardSwimlanes ?? false);
  const [roadmapShowClosed, setRoadmapShowClosed] = useState(saved?.roadmapShowClosed ?? false);
  const [roadmapShape, setRoadmapShape] = useState(saved?.roadmapShape);
  const [roadmapSort, setRoadmapSort] = useState<RoadmapSort>(restoredRoadmap.sort);
  const [roadmapZoom, setRoadmapZoom] = useState<RoadmapZoom>(restoredRoadmap.zoom);
  const [roadmapGutter, setRoadmapGutter] = useState(restoredRoadmap.gutter);
  const [detailWidth, setDetailWidth] = useState(saved?.detailWidth ?? DETAIL_DEFAULT_PX);
  // Fleet's own detail pane (the transcript view, beads-ui-vscode-ext-37b) —
  // measured against `FleetView`'s own container, not `mainWidth` below,
  // since it is the only tab with its own list+detail split.
  const [fleetDetailWidth, setFleetDetailWidth] = useState(saved?.fleetDetailWidth ?? DETAIL_DEFAULT_PX);
  const [fleetStatusFilter, setFleetStatusFilter] = useState<FleetStatusFilter>(restoredFleet.statusFilter);
  const mainRef = useRef<HTMLElement>(null);
  const [mainWidth, setMainWidth] = useState(0);

  // The maximum is a share of the container, so it moves when the panel does.
  const detailRange = useMemo<Range>(
    () => ({ min: DETAIL_MIN_PX, max: detailMaxWidth(mainWidth) }),
    [mainWidth],
  );

  // `detailWidth` is the width the user asked for and is never overwritten by
  // the container; the clamp lives here, where it is drawn, so a pane squeezed
  // by a narrow panel comes back to its full size when the panel widens again.
  // Writing the clamped value into state instead would throw the preference
  // away the first time the editor was ever made narrow.
  const detailPx = clamp(detailWidth, detailRange);

  useEffect(() => {
    const node = mainRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setMainWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Survives the panel being closed and reopened in the same session.
  useEffect(
    () =>
      persist<PersistedState>({
        tab,
        query,
        collapsedColumns,
        boardSwimlanes,
        roadmapShowClosed,
        roadmapShape,
        ...persistedRoadmapPreferences({
          sort: roadmapSort,
          zoom: roadmapZoom,
          gutter: roadmapGutter,
        }),
        detailWidth,
        fleetDetailWidth,
        ...persistedFleetPreferences({ statusFilter: fleetStatusFilter }),
      }),
    [
      tab,
      query,
      collapsedColumns,
      boardSwimlanes,
      roadmapShowClosed,
      roadmapShape,
      roadmapSort,
      roadmapZoom,
      roadmapGutter,
      detailWidth,
      fleetDetailWidth,
      fleetStatusFilter,
    ],
  );

  // `beadsDashboard.showClosed` is a *default*, not an override: the first push
  // is ignored when this panel already has the user's own filter restored, but
  // every later push is the user deliberately changing the setting.
  const settingsSeen = useRef(false);
  const hadSavedQuery = saved?.query !== undefined;

  useEffect(
    () =>
      onHostEvent((event) => {
        if (event.name === 'setTab') setTab(event.tab);
        if (event.name === 'settings') {
          const isFirst = !settingsSeen.current;
          settingsSeen.current = true;
          if (isFirst && hadSavedQuery) return;
          setQuery((current) => ({ ...current, includeClosed: event.settings.showClosed }));
        }
      }),
    [hadSavedQuery],
  );

  const onSelect = useCallback((id: string) => setFocusedId(id), [setFocusedId]);

  const beads = snapshot?.beads ?? [];
  const selected = focusedId ? beads.find((bead) => bead.id === focusedId) : undefined;
  const blockedIds = useMemo(() => new Set(snapshot?.blockedIds ?? []), [snapshot?.blockedIds]);

  return (
    <ToastProvider>
      <div className="@container flex h-full min-h-0 flex-col">
        <header className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <nav aria-label="Dashboard sections" className="flex gap-1" role="tablist">
            {DASHBOARD_TABS.map((candidate) => (
              <button
                key={candidate}
                role="tab"
                type="button"
                aria-selected={tab === candidate}
                onClick={() => setTab(candidate)}
                className={cn(
                  'surface-interactive inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm',
                  tab === candidate
                    ? 'bg-surface-active text-fg-strong'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {TAB_META[candidate].icon}
                {TAB_META[candidate].label}
              </button>
            ))}
          </nav>

          <div className="text-fg-muted ml-auto flex items-center gap-2 text-xs">
            {snapshot ? (
              <span title={snapshot.fetchedAt}>
                {snapshot.beads.length} issues · updated {relativeTime(snapshot.fetchedAt)}
              </span>
            ) : null}
            {snapshot?.truncated ? (
              <span className="text-warning" title="Raise beadsDashboard.issueLimit to load more">
                truncated
              </span>
            ) : null}
            <Button variant="ghost" onClick={refresh} title="Refresh from bd">
              <RefreshCw aria-hidden="true" className={cn('size-3.5', loading && 'animate-spin')} />
              <span className="sr-only @md:not-sr-only">Refresh</span>
            </Button>
          </div>
        </header>

        {error ? (
          <div
            role="alert"
            className="border-danger text-danger m-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{error.message}</p>
              {error.kind === 'bd-not-found' ? (
                <p className="text-fg-muted mt-1">
                  Set <code>beadsDashboard.bdPath</code> in settings if bd is installed somewhere unusual.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <main
          ref={mainRef}
          className="flex min-h-0 flex-1"
          style={{ '--detail-w': `${detailPx}px` } as CSSProperties}
        >
          <div className="min-w-0 flex-1">
            {!snapshot ? (
              loading ? (
                <LoadingSkeleton />
              ) : (
                <EmptyState
                  icon={<AlertCircle className="size-10" />}
                  title="No data from bd yet"
                  hint="Press Refresh, or check the Beads Dashboard output log for what bd reported."
                  action={
                    <Button variant="primary" onClick={refresh}>
                      Refresh
                    </Button>
                  }
                />
              )
            ) : tab === 'overview' ? (
              <OverviewView
                snapshot={snapshot}
                index={index}
                onSelect={onSelect}
                selectedId={focusedId}
              />
            ) : tab === 'roadmap' ? (
              <RoadmapView
                beads={beads}
                index={index}
                query={query}
                onQueryChange={setQuery}
                onSelect={onSelect}
                selectedId={focusedId}
                blockedIds={blockedIds}
                showClosed={roadmapShowClosed}
                onShowClosedChange={setRoadmapShowClosed}
                shape={roadmapShape}
                onShapeChange={setRoadmapShape}
                sort={roadmapSort}
                onSortChange={setRoadmapSort}
                zoom={roadmapZoom}
                onZoomChange={setRoadmapZoom}
                gutter={roadmapGutter}
                onGutterChange={setRoadmapGutter}
              />
            ) : tab === 'board' ? (
              <BoardView
                beads={beads}
                index={index}
                query={query}
                onQueryChange={setQuery}
                onSelect={onSelect}
                selectedId={focusedId}
                blockedIds={blockedIds}
                collapsedColumns={collapsedColumns}
                onCollapsedColumnsChange={setCollapsedColumns}
                swimlanes={boardSwimlanes}
                onSwimlanesChange={setBoardSwimlanes}
              />
            ) : (
              <FleetView
                detailWidth={fleetDetailWidth}
                onDetailWidthChange={setFleetDetailWidth}
                statusFilter={fleetStatusFilter}
                onStatusFilterChange={setFleetStatusFilter}
              />
            )}
          </div>

          {selected ? (
            <>
              {/* Narrow: the pane covers the content, so there is nothing to split. */}
              <Splitter
                className="hidden @3xl:block"
                label="Resize detail panel"
                size={detailPx}
                range={detailRange}
                // The pane is right of the handle, so dragging right narrows it.
                sign={-1}
                // Both of these are the user speaking, so both become the new
                // preference: the drag is already clamped to the live range.
                onChange={setDetailWidth}
                onReset={() => setDetailWidth(DETAIL_DEFAULT_PX)}
              />
              <div className="absolute inset-0 z-10 @3xl:static @3xl:z-auto @3xl:w-[var(--detail-w)] @3xl:shrink-0">
                <BeadDetail
                  bead={selected}
                  beads={beads}
                  index={index}
                  onClose={() => setFocusedId(undefined)}
                  onSelect={onSelect}
                  refreshKey={snapshot?.fetchedAt}
                />
              </div>
            </>
          ) : null}
        </main>
      </div>
    </ToastProvider>
  );
}

function LoadingSkeleton(): ReactNode {
  return (
    <div className="grid gap-2 px-3 py-3" aria-busy="true" aria-label="Loading issues">
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-44 rounded-lg" />
      <Skeleton className="h-44 rounded-lg" />
    </div>
  );
}
