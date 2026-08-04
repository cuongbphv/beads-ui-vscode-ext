/**
 * Roadmap: the drill-down tab, in two shapes.
 *
 * Timeline is the default — beads stores start, due, estimate and PIC, so the
 * parent→child hierarchy is a Gantt without inventing any data. List keeps the
 * older card view for when the dates are not the question being asked.
 */
import { CheckCircle2, GanttChartSquare, List as ListIcon, Map as MapIcon } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { StatusIndex, filterBeads, groupByEpic, progressOf, type BeadQuery } from '../../shared/model';
import { buildTimeline } from '../../shared/schedule';
import { typeStyle, type Bead, type EpicGroup } from '../../shared/types';
import { BeadCard } from '../components/bead-card';
import { GanttChart, GanttLegend, hasNoScheduleData, sortEpicSpans } from '../components/gantt';
import { EmptyState, ProgressBar, TypeIcon } from '../components/primitives';
import { QuickFilterBar } from '../components/quick-filter-bar';
import { hiddenClosedCount, resolveShape, type RoadmapShape } from '../lib/roadmap-shape';
import { cn } from '../lib/utils';

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
}): ReactNode {
  const epics = useMemo(() => beads.filter((bead) => bead.issue_type === 'epic'), [beads]);

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

  // One clock reading per render, so every bar agrees on where "today" is.
  const timeline = useMemo(() => {
    const built = buildTimeline(groups, (bead) => index.isDone(bead.status), Date.now());
    return { ...built, epics: sortEpicSpans(built.epics) };
  }, [groups, index]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const undated = hasNoScheduleData(beads);
  const shape = resolveShape(chosenShape, timeline);

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <QuickFilterBar
            beads={beads}
            epics={epics}
            query={roadmapQuery}
            onChange={(next) => {
              // The closed toggle belongs to this tab; everything else is shared.
              onShowClosedChange(next.includeClosed ?? false);
              onQueryChange({ ...next, includeClosed: query.includeClosed });
            }}
          />
        </div>
        <div role="group" aria-label="Roadmap shape" className="flex shrink-0 gap-1">
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
      </div>

      {/* Never a silent filter: the count is on screen and is the control. */}
      {hiddenClosed > 0 ? (
        <div className="border-border border-b px-3 py-1.5">
          <button
            type="button"
            onClick={() => onShowClosedChange(true)}
            className="text-fg-muted hover:bg-surface-hover hover:text-fg border-border surface-interactive inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
          >
            <CheckCircle2 aria-hidden="true" className="size-3" />
            {hiddenClosed} closed hidden — show
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {groups.length === 0 ? (
          <EmptyState
            icon={<MapIcon className="size-10" />}
            title="Nothing matches these filters"
            hint="Clear the filter bar, or tick “Closed” to include finished work."
          />
        ) : shape === 'timeline' ? (
          <>
            {undated ? (
              <p className="text-fg-muted border-border mb-2 rounded-md border border-dashed px-2 py-1.5 text-xs">
                No issue carries a due date or an estimate yet, so every bar is a nominal one-day
                block. Add them with <code>bd update &lt;id&gt; --due 2026-09-01 --estimate 120</code>.
              </p>
            ) : null}
            <GanttChart
              timeline={timeline}
              index={index}
              collapsed={collapsed}
              onToggle={toggle}
              onSelect={onSelect}
              selectedId={selectedId}
              blockedIds={blockedIds}
            />
            <div className="mt-2">
              <GanttLegend />
            </div>
          </>
        ) : (
          <ul className="grid gap-2 py-1">
            {groups.map((group) => (
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
        )}
      </div>
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
