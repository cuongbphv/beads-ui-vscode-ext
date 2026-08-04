/**
 * Dashboard shell: header, tabs, the selected view, and the detail pane.
 *
 * The detail pane docks beside the content when the container is wide and takes
 * the whole panel when it is not — same component, no duplicate markup.
 */
import { AlertCircle, LayoutDashboard, Map as MapIcon, RefreshCw, Columns3 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { BeadQuery } from '../shared/model';
import { DASHBOARD_TABS, type DashboardTab } from '../shared/protocol';
import type { StatusCategory } from '../shared/types';
import { BeadDetail } from './components/bead-detail';
import { Button, EmptyState, Skeleton } from './components/primitives';
import { ToastProvider } from './components/toast';
import { onHostEvent, persist, restore } from './bridge/rpc';
import { useBeads } from './hooks/use-beads';
import type { RoadmapShape } from './lib/roadmap-shape';
import { cn, relativeTime } from './lib/utils';
import { BoardView } from './views/BoardView';
import { OverviewView } from './views/OverviewView';
import { RoadmapView } from './views/RoadmapView';

interface PersistedState {
  tab: DashboardTab;
  query: BeadQuery;
  /** Absent until the user first folds or unfolds a board column. */
  collapsedColumns?: StatusCategory[];
  /** The Roadmap answers "show closed" for itself; the Board keeps `query`. */
  roadmapShowClosed?: boolean;
  /** Absent until the user picks a shape; the date range decides until then. */
  roadmapShape?: RoadmapShape;
}

const TAB_META: Record<DashboardTab, { label: string; icon: ReactNode }> = {
  overview: { label: 'Overview', icon: <LayoutDashboard aria-hidden="true" className="size-4" /> },
  roadmap: { label: 'Roadmap', icon: <MapIcon aria-hidden="true" className="size-4" /> },
  board: { label: 'Board', icon: <Columns3 aria-hidden="true" className="size-4" /> },
};

export function App(): ReactNode {
  const saved = restore<PersistedState>();
  const { snapshot, index, error, loading, focusedId, setFocusedId, refresh } = useBeads();

  const [tab, setTab] = useState<DashboardTab>(saved?.tab ?? 'overview');
  // Matches `beadsDashboard.showClosed`, which the host pushes right after
  // connect; this is only what the first frame renders with.
  const [query, setQuery] = useState<BeadQuery>(saved?.query ?? { includeClosed: true });
  const [collapsedColumns, setCollapsedColumns] = useState(saved?.collapsedColumns);
  const [roadmapShowClosed, setRoadmapShowClosed] = useState(saved?.roadmapShowClosed ?? false);
  const [roadmapShape, setRoadmapShape] = useState(saved?.roadmapShape);

  // Survives the panel being closed and reopened in the same session.
  useEffect(
    () =>
      persist<PersistedState>({
        tab,
        query,
        collapsedColumns,
        roadmapShowClosed,
        roadmapShape,
      }),
    [tab, query, collapsedColumns, roadmapShowClosed, roadmapShape],
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

        <main className="flex min-h-0 flex-1">
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
              />
            ) : (
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
              />
            )}
          </div>

          {selected ? (
            <div
              className={cn(
                // Narrow: the detail pane covers the content. Wide: it docks.
                'absolute inset-0 z-10 @3xl:static @3xl:z-auto @3xl:w-96 @3xl:shrink-0',
              )}
            >
              <BeadDetail
                bead={selected}
                beads={beads}
                index={index}
                onClose={() => setFocusedId(undefined)}
                onSelect={onSelect}
                refreshKey={snapshot?.fetchedAt}
              />
            </div>
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
