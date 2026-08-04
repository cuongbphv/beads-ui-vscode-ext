/**
 * The roadmap as a timeline.
 *
 * beads carries `started_at`, `due_at`, `estimated_minutes`, `closed_at` and an
 * assignee, which is exactly enough to draw a Gantt: one row per epic, one row
 * per child, bars positioned by `shared/schedule.ts`. The maths lives there so
 * this file is only layout.
 *
 * Bars are absolutely positioned inside a percentage-width track rather than a
 * canvas, so they stay crisp, theme-aware and reachable by keyboard.
 */
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { Fragment, type CSSProperties, type ReactNode } from 'react';

import { StatusIndex, progressOf } from '../../shared/model';
import {
  formatDuration,
  placement,
  type EpicSpan,
  type Span,
  type Timeline,
} from '../../shared/schedule';
import { typeStyle, type Bead } from '../../shared/types';
import { cn, shortDate } from '../lib/utils';
import { PriorityDot, TypeIcon } from './primitives';

/** Width of the fixed label gutter. Kept in one place so header and rows align. */
const GUTTER = 'w-44 shrink-0 @xl:w-64';

export function GanttChart({
  timeline,
  index,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
  blockedIds,
}: {
  timeline: Timeline;
  index: StatusIndex;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
}): ReactNode {
  const nowLeft = placement({ start: timeline.now, end: timeline.now }, timeline).left;

  return (
    <div className="min-w-0">
      {/* The axis scrolls with the rows but stays pinned to the top of the pane. */}
      <div className="bg-bg border-border sticky top-0 z-10 flex items-end border-b pb-1">
        <div className={cn(GUTTER, 'text-fg-muted px-2 text-xs')}>
          {shortDate(timeline.start)} → {shortDate(timeline.end)}
        </div>
        <div className="relative h-6 min-w-0 flex-1">
          {timeline.ticks.map((tick) => {
            const { left } = placement({ start: tick.at, end: tick.at }, timeline);
            return (
              <span
                key={tick.at}
                className={cn(
                  'absolute bottom-0 -translate-x-1/2 text-[10px] whitespace-nowrap',
                  // In a narrow panel the minor labels run into each other, so
                  // only the major ones (midnight, the 1st, January) survive.
                  tick.major ? 'text-fg font-medium' : 'text-fg-muted hidden @2xl:inline',
                )}
                style={{ left: `${left}%` }}
              >
                {tick.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="relative">
        {/* Gridlines and the today marker sit behind every row. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
          <div className={GUTTER} />
          <div className="relative min-w-0 flex-1">
            {timeline.ticks.map((tick) => {
              const { left } = placement({ start: tick.at, end: tick.at }, timeline);
              return (
                <span
                  key={tick.at}
                  // Gridlines are scaffolding: day boundaries a little firmer
                  // than the rest, but never louder than the bars or the today
                  // marker.
                  className={cn(
                    'absolute inset-y-0 w-px',
                    tick.major ? 'bg-border-strong/35' : 'bg-border/40',
                  )}
                  style={{ left: `${left}%` }}
                />
              );
            })}
            <span
              className="bg-danger absolute inset-y-0 w-0.5"
              style={{ left: `${nowLeft}%` }}
            />
          </div>
        </div>

        <ul className="relative grid">
          {timeline.epics.map((epic) => (
            <Fragment key={epic.group.epic.id}>
              <EpicRow
                epic={epic}
                timeline={timeline}
                collapsed={collapsed.has(epic.group.epic.id)}
                onToggle={() => onToggle(epic.group.epic.id)}
                onSelect={onSelect}
                selectedId={selectedId}
              />
              {!collapsed.has(epic.group.epic.id)
                ? epic.children.map((span) => (
                    <TaskRow
                      key={span.bead.id}
                      span={span}
                      timeline={timeline}
                      index={index}
                      onSelect={onSelect}
                      selected={span.bead.id === selectedId}
                      blocked={blockedIds.has(span.bead.id)}
                    />
                  ))
                : null}
            </Fragment>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EpicRow({
  epic,
  timeline,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
}: {
  epic: EpicSpan;
  timeline: Timeline;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}): ReactNode {
  const bead = epic.group.epic;
  const synthetic = bead.id === '__unassigned__';
  const { left, width } = placement(epic, timeline);
  const done = progressOf(epic.group);
  const style = typeStyle(bead.issue_type);

  return (
    <li
      className={cn(
        'border-border/60 hover:bg-surface-hover flex items-center border-b transition-colors',
        bead.id === selectedId && 'bg-surface-active',
      )}
    >
      <div className={cn(GUTTER, 'flex min-w-0 items-center gap-1 py-1.5 pr-2 pl-1')}>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="text-fg-muted hover:text-fg shrink-0 cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="size-4" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-4" />
          )}
          <span className="sr-only">
            {collapsed ? 'Expand' : 'Collapse'} {bead.title}
          </span>
        </button>
        <TypeIcon type={bead.issue_type} className={style.className} />
        <button
          type="button"
          disabled={synthetic}
          onClick={() => onSelect(bead.id)}
          title={bead.title}
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium disabled:cursor-default"
        >
          {bead.title}
        </button>
        <span className="text-fg-muted shrink-0 text-[11px] tabular-nums">
          {epic.group.doneCount}/{epic.group.totalCount}
        </span>
      </div>

      <div className="relative h-8 min-w-0 flex-1">
        {/* The epic bar is a summary bracket: hollow, with progress filled in. */}
        <div
          className={cn(
            'absolute top-1/2 h-3 -translate-y-1/2 rounded-sm border',
            epic.hasOverdue ? 'border-danger' : 'border-border-strong',
          )}
          style={
            {
              left: `${left}%`,
              width: `${width}%`,
              background: `color-mix(in oklab, ${style.color} 14%, transparent)`,
            } as CSSProperties
          }
          title={`${bead.title} · ${shortDate(epic.start)} → ${shortDate(epic.end)} · ${done}%`}
        >
          <div
            className="bg-success/70 h-full rounded-l-[2px] transition-[width] duration-300"
            style={{ width: `${done}%` }}
          />
        </div>
      </div>
    </li>
  );
}

function TaskRow({
  span,
  timeline,
  index,
  onSelect,
  selected,
  blocked,
}: {
  span: Span;
  timeline: Timeline;
  index: StatusIndex;
  onSelect: (id: string) => void;
  selected: boolean;
  blocked: boolean;
}): ReactNode {
  const bead = span.bead;
  const { left, width } = placement(span, timeline);
  const style = typeStyle(bead.issue_type);
  const done = index.isDone(bead.status);

  return (
    <li
      className={cn(
        'border-border/40 hover:bg-surface-hover flex items-center border-b transition-colors',
        selected && 'bg-surface-active',
      )}
    >
      <div className={cn(GUTTER, 'flex min-w-0 items-center gap-1.5 py-1 pr-2 pl-6')}>
        <TypeIcon type={bead.issue_type} className={style.className} />
        <button
          type="button"
          onClick={() => onSelect(bead.id)}
          title={`${bead.id}: ${bead.title}`}
          className={cn(
            'min-w-0 flex-1 cursor-pointer truncate text-left text-[13px]',
            done && 'text-fg-muted line-through decoration-1',
          )}
        >
          {bead.title}
        </button>
        {blocked ? (
          <Lock aria-label="blocked" className="text-fg-muted size-3 shrink-0" />
        ) : null}
        <PriorityDot priority={bead.priority} />
      </div>

      <div className="relative h-7 min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onSelect(bead.id)}
          title={barTitle(span)}
          className={cn(
            'absolute top-1/2 flex h-4 -translate-y-1/2 cursor-pointer items-center gap-1 rounded-sm px-1 text-[10px] whitespace-nowrap transition-[filter,box-shadow] hover:brightness-110',
            // An inferred end is drawn hatched, so a bar that is really a guess
            // never reads as a commitment.
            span.kind === 'nominal' && 'opacity-55',
            span.overdue && 'ring-danger ring-1',
          )}
          style={
            {
              left: `${left}%`,
              width: `${width}%`,
              background: done
                ? `color-mix(in oklab, var(--color-success) 55%, transparent)`
                : span.deferred
                  ? `color-mix(in oklab, ${style.color} 30%, transparent)`
                  : style.color,
              color: 'var(--color-bg)',
            } as CSSProperties
          }
        >
          <span className="sr-only">{barTitle(span)}</span>
        </button>

        {/* The estimate rides outside the bar, where a 3px bar can still show it. */}
        {bead.estimated_minutes ? (
          <span
            aria-hidden="true"
            className="text-fg-muted absolute top-1/2 hidden -translate-y-1/2 pl-1 text-[10px] whitespace-nowrap tabular-nums @2xl:inline"
            style={{ left: `${Math.min(left + width, 96)}%` }}
          >
            {formatDuration(bead.estimated_minutes)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

const KIND_TEXT: Record<Span['kind'], string> = {
  actual: 'closed',
  due: 'due',
  estimated: 'estimated end',
  nominal: 'no dates — nominal bar',
};

function barTitle(span: Span): string {
  const parts = [
    `${span.bead.id}: ${span.bead.title}`,
    `${shortDate(span.start)} → ${shortDate(span.end)} (${KIND_TEXT[span.kind]})`,
  ];
  if (span.bead.assignee) parts.push(`PIC ${span.bead.assignee}`);
  if (span.bead.estimated_minutes) parts.push(`est ${formatDuration(span.bead.estimated_minutes)}`);
  if (span.overdue) parts.push('OVERDUE');
  if (span.deferred) parts.push('deferred');
  return parts.join(' · ');
}

/** Legend so the hatching, the hollow bars and the red line are readable. */
export function GanttLegend(): ReactNode {
  return (
    <ul className="text-fg-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <li className="flex items-center gap-1">
        <span className="bg-success/60 h-2 w-4 rounded-sm" /> done
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-type-task h-2 w-4 rounded-sm" /> open
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-type-task h-2 w-4 rounded-sm opacity-55" /> no dates
      </li>
      <li className="flex items-center gap-1">
        <span className="ring-danger h-2 w-4 rounded-sm ring-1" /> overdue
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-danger h-3 w-px" /> today
      </li>
    </ul>
  );
}

/** Rows sorted so the timeline reads left-to-right by start date. */
export function sortEpicSpans(epics: EpicSpan[]): EpicSpan[] {
  return [...epics].sort((a, b) => a.start - b.start || a.group.epic.id.localeCompare(b.group.epic.id));
}

/** True when nothing in the set carries a real date — worth telling the user. */
export function hasNoScheduleData(beads: Bead[]): boolean {
  return !beads.some((bead) => bead.due_at || bead.estimated_minutes || bead.started_at);
}
