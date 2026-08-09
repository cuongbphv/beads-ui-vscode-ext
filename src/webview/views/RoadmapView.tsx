/**
 * Roadmap: the drill-down tab, in two shapes.
 *
 * Timeline is the default — beads stores start, due, estimate and PIC, so the
 * parent→child hierarchy is a Gantt without inventing any data. List keeps the
 * older card view for when the dates are not the question being asked.
 */
import { GanttChartSquare, List as ListIcon, Map as MapIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { StatusIndex, filterBeads, groupByEpic, progressOf, type BeadQuery } from '../../shared/model';
import {
  ROADMAP_SORTS,
  sortGroups,
  sortTimeline,
  type RoadmapSort,
} from '../../shared/roadmap-sort';
import { buildTimeline, withTickDensity } from '../../shared/schedule';
import { typeStyle, type Bead, type EpicGroup } from '../../shared/types';
import { BeadCard } from '../components/bead-card';
import {
  GanttChart,
  GanttLegend,
  hasNoScheduleData,
  pxPerDayFor,
  ROADMAP_ZOOMS,
  type RoadmapZoom,
} from '../components/gantt';
import { QuickFilterBar } from '../components/filter-bar';
import { EmptyState, ProgressBar, Select, TypeIcon } from '../components/primitives';
import { Splitter } from '../components/splitter';
import { useScheduleEdit } from '../hooks/use-schedule-edit';
import { clamp, roadmapGutterRange } from '../lib/drag-resize';
import { hiddenClosedCount, resolveShape, type RoadmapShape } from '../lib/roadmap-shape';
import { cn } from '../lib/utils';

const GUTTER_DEFAULT_PX = 224;

/**
 * Wording only. The values themselves come from `ROADMAP_SORTS` and
 * `ROADMAP_ZOOMS`, so a picker cannot offer a choice the restore-time
 * validator rejects — or hide one it accepts. `Record` keyed by the union
 * means adding a member without a label fails the typecheck.
 */
const SORT_LABELS: Record<RoadmapSort, string> = {
  timeline: 'By date',
  priority: 'By priority',
  type: 'By type',
};

const ZOOM_LABELS: Record<RoadmapZoom, string> = {
  fit: 'Fit',
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
};

const SORT_OPTIONS = ROADMAP_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }));
const ZOOM_OPTIONS = ROADMAP_ZOOMS.map((value) => ({ value, label: ZOOM_LABELS[value] }));

export function RoadmapView({
  beads,
  index,
  query,
  onQueryChange,
  onSelect,
  selectedId,
  blockedIds,
  showClosed,
  onShowClosedChange,
  shape: chosenShape,
  onShapeChange,
  sort,
  onSortChange,
  zoom,
  onZoomChange,
  gutter,
  onGutterChange,
}: {
  beads: Bead[];
  index: StatusIndex;
  query: BeadQuery;
  onQueryChange: (next: BeadQuery) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
  /**
   * Scoped to this tab. A finished plan is a wall of strikethroughs, so the
   * Roadmap starts without them — while the Board, where "done" is a column
   * you move things into, keeps its own answer.
   */
  showClosed: boolean;
  onShowClosedChange: (next: boolean) => void;
  /** `undefined` until the user picks one; the date range decides until then. */
  shape?: RoadmapShape;
  onShapeChange: (next: RoadmapShape) => void;
  sort: RoadmapSort;
  onSortChange: (next: RoadmapSort) => void;
  zoom: RoadmapZoom;
  onZoomChange: (next: RoadmapZoom) => void;
  gutter: number;
  onGutterChange: (next: number) => void;
}): ReactNode {
  const epics = useMemo(() => beads.filter((bead) => bead.issue_type === 'epic'), [beads]);
  const { pending, commit } = useScheduleEdit();

  // Everything in the filter bar is shared with the other tabs except the
  // closed toggle, which this tab answers for itself.
  const roadmapQuery = useMemo<BeadQuery>(
    () => ({ ...query, includeClosed: showClosed }),
    [query, showClosed],
  );
  const hiddenClosed = useMemo(
    () => hiddenClosedCount(beads, roadmapQuery, index),
    [beads, roadmapQuery, index],
  );

  // Epics themselves are never filtered out by the status filter — an epic
  // whose children all match must still be reachable.
  //
  // The filter decides which child cards are *listed*; it must not decide what
  // the progress rollup divides by, or an epic whose children are all closed
  // reads "0/0 · 0%" the moment the Closed filter is unticked.
  const groups = useMemo(() => {
    const rollups = new Map<string, { done: number; total: number }>();
    for (const group of groupByEpic(beads, index)) {
      rollups.set(group.epic.id, { done: group.doneCount, total: group.totalCount });
    }

    const visible = filterBeads(beads, roadmapQuery, index);
    const keep = new Set(visible.map((bead) => bead.id));
    const withEpics = beads.filter((bead) => keep.has(bead.id) || bead.issue_type === 'epic');

    return groupByEpic(withEpics, index)
      .filter((group) => group.children.length > 0 || keep.has(group.epic.id))
      .map((group) => {
        const rollup = rollups.get(group.epic.id);
        return rollup ? { ...group, doneCount: rollup.done, totalCount: rollup.total } : group;
      });
  }, [beads, roadmapQuery, index]);

  // Measured by the chart, fed back so the tick density matches what is drawn.
  const [trackPx, setTrackPx] = useState(0);

  // The gutter's maximum is a share of the pane, so it has to follow the pane —
  // and the pane only exists in the timeline shape. A mount-time effect finds a
  // null ref on a list-first render and never runs again, freezing the range at
  // its unmeasured fallback for the rest of the session, so the observer is
  // attached and detached by the ref itself instead.
  const observer = useRef<ResizeObserver>(undefined);
  const [viewportPx, setViewportPx] = useState(0);

  const paneRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = undefined;
    if (!node) return;
    // The last measurement is kept rather than zeroed: the shape can flip back
    // to the same pane at the same width, and a real ResizeObserver reports
    // that width immediately on observe, so nothing is left stale for a frame.
    const next = new ResizeObserver(([entry]) => setViewportPx(entry.contentRect.width));
    next.observe(node);
    observer.current = next;
  }, []);

  // One clock reading per render, so every bar agrees on where "today" is.
  // Built once and re-ticked: the density needs the window, but the bars do not
  // need the density, so a second full build would only redo work.
  const timeline = useMemo(() => {
    const built = buildTimeline(groups, (bead) => index.isDone(bead.status), Date.now());
    const pxPerDay = pxPerDayFor(zoom, trackPx, built.end - built.start);
    const withTicks = withTickDensity(built, pxPerDay);
    return { ...withTicks, epics: sortTimeline(withTicks.epics, sort) };
  }, [groups, index, sort, trackPx, zoom]);

  const listGroups = useMemo(() => sortGroups(groups, sort), [groups, sort]);

  const gutterRange = useMemo(() => roadmapGutterRange(viewportPx), [viewportPx]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onTrackWidth = useCallback((px: number) => setTrackPx(px), []);

  const undated = hasNoScheduleData(beads);
  const shape = resolveShape(chosenShape, timeline);

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      {/* Two zones, one band: the search box and the Filters button narrow the
          data, the pickers past the separator draw it. The closed-hidden count
          is not a control of this tab's own any more — it belongs with the
          chips, where everything the query is hiding is listed together. */}
      <div className="border-border border-b px-3 py-2">
        <QuickFilterBar
          beads={beads}
          epics={epics}
          query={roadmapQuery}
          hiddenClosedCount={hiddenClosed}
          onChange={(next) => {
            // The closed toggle belongs to this tab; everything else is shared.
            onShowClosedChange(next.includeClosed ?? false);
            onQueryChange({ ...next, includeClosed: query.includeClosed });
          }}
          trailing={
            <>
              <Select
                label="Sort"
                value={sort}
                onChange={(value) => onSortChange(value as RoadmapSort)}
                options={SORT_OPTIONS}
              />

              {shape === 'timeline' ? (
                <Select
                  label="Zoom"
                  value={zoom}
                  onChange={(value) => onZoomChange(value as RoadmapZoom)}
                  options={ZOOM_OPTIONS}
                />
              ) : null}

              <div role="group" aria-label="Roadmap shape" className="flex gap-1">
                <ShapeButton
                  active={shape === 'timeline'}
                  onClick={() => onShapeChange('timeline')}
                  icon={<GanttChartSquare aria-hidden="true" className="size-3.5" />}
                  label="Timeline"
                />
                <ShapeButton
                  active={shape === 'list'}
                  onClick={() => onShapeChange('list')}
                  icon={<ListIcon aria-hidden="true" className="size-3.5" />}
                  label="List"
                />
              </div>
            </>
          }
        />
      </div>

      {groups.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <EmptyState
            icon={<MapIcon className="size-10" />}
            title="Nothing matches these filters"
            hint="Clear the filter bar, or tick “Closed” to include finished work."
          />
        </div>
      ) : shape === 'timeline' ? (
        <div ref={paneRef} className="flex min-h-0 flex-1 flex-col">
          {undated ? (
            <p className="text-fg-muted border-border mx-3 mt-2 rounded-md border border-dashed px-2 py-1.5 text-xs">
              No issue carries a due date or an estimate yet, so every bar is a nominal one-day
              block. Add them with <code>bd update &lt;id&gt; --due 2026-09-01 --estimate 120</code>.
            </p>
          ) : null}

          <div className="relative flex min-h-0 flex-1">
            <GanttChart
              timeline={timeline}
              index={index}
              collapsed={collapsed}
              onToggle={toggle}
              onSelect={onSelect}
              selectedId={selectedId}
              blockedIds={blockedIds}
              gutter={clamp(gutter, gutterRange)}
              zoom={zoom}
              onTrackWidth={onTrackWidth}
              onCommit={commit}
              pendingIds={pending}
            />
            {/* Absolutely placed over the grid, so it does not become a third
                column the sticky gutter would have to account for. */}
            <Splitter
              className="absolute inset-y-0 z-40"
              style={{ left: `calc(${clamp(gutter, gutterRange)}px - 3px)` }}
              label="Resize the task name column"
              size={clamp(gutter, gutterRange)}
              range={gutterRange}
              onChange={onGutterChange}
              onReset={() => onGutterChange(clamp(GUTTER_DEFAULT_PX, gutterRange))}
            />
          </div>

          <div className="border-border border-t px-3 py-1.5">
            <GanttLegend />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <ul className="grid gap-2 py-1">
            {listGroups.map((group) => (
              <EpicRow
                key={group.epic.id}
                group={group}
                collapsed={collapsed.has(group.epic.id)}
                onToggle={() => toggle(group.epic.id)}
                onSelect={onSelect}
                selectedId={selectedId}
                blockedIds={blockedIds}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ShapeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'surface-interactive inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs',
        active
          ? 'bg-surface-active text-fg-strong'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EpicRow({
  group,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
  blockedIds,
}: {
  group: EpicGroup;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
}): ReactNode {
  const synthetic = group.epic.id === '__unassigned__';
  const panelId = `epic-panel-${group.epic.id}`;
  const style = typeStyle(group.epic.issue_type);

  return (
    <li
      className="bg-surface border-border type-spine overflow-hidden rounded-lg border"
      style={{ '--type-color': style.color } as CSSProperties}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          onClick={onToggle}
          className="text-fg-muted hover:text-fg shrink-0 cursor-pointer"
        >
          <span aria-hidden="true" className={cn('block transition-transform', collapsed && '-rotate-90')}>
            ▾
          </span>
          <span className="sr-only">
            {collapsed ? 'Expand' : 'Collapse'} {group.epic.title}
          </span>
        </button>

        <TypeIcon type={group.epic.issue_type} className={style.className} />

        <button
          type="button"
          disabled={synthetic}
          onClick={() => onSelect(group.epic.id)}
          className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
        >
          <span className="text-fg-strong block truncate text-sm font-medium">
            {group.epic.title}
          </span>
          {!synthetic ? (
            <span className="text-fg-muted font-mono text-xs">{group.epic.id}</span>
          ) : null}
        </button>

        <div className="flex w-40 shrink-0 flex-col gap-1 @md:w-56">
          <span className="text-fg-muted text-right text-xs tabular-nums">
            {group.doneCount}/{group.totalCount} · {progressOf(group)}%
          </span>
          <ProgressBar
            done={group.doneCount}
            total={group.totalCount}
            label={`${group.epic.title} progress`}
          />
        </div>
      </div>

      {!collapsed ? (
        <ul
          id={panelId}
          className="border-border grid gap-1.5 border-t px-2 py-2 @xl:grid-cols-2 @5xl:grid-cols-3"
        >
          {group.children.length === 0 ? (
            <li className="text-fg-muted px-1 py-2 text-sm">No child issues.</li>
          ) : (
            group.children.map((child) => (
              <li key={child.id}>
                <BeadCard
                  bead={child}
                  blocked={blockedIds.has(child.id)}
                  selected={child.id === selectedId}
                  onSelect={onSelect}
                />
              </li>
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}
