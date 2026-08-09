/**
 * The Gantt's two row shapes.
 *
 * The label cell is `sticky left-0` so task names survive a horizontal scroll at
 * a zoomed-in resolution; it needs an opaque background or the bars slide under
 * the text.
 */
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { StatusIndex, progressOf } from '../../../shared/model';
import { placement, type EpicSpan, type Span, type Timeline } from '../../../shared/schedule';
import { typeStyle } from '../../../shared/types';
import type { BarEdit } from '../../lib/bar-drag';
import { cn, shortDate } from '../../lib/utils';
import { PriorityDot, TypeIcon } from '../primitives';
import { GUTTER_CLASS } from './gantt-axis';
import { GanttBar } from './gantt-bar';

export function EpicRow({
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
      <div
        className={cn(
          GUTTER_CLASS,
          'bg-bg sticky left-0 z-10 flex min-w-0 items-center gap-1 py-1.5 pr-2 pl-1',
        )}
      >
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

export function TaskRow({
  span,
  timeline,
  index,
  onSelect,
  selected,
  blocked,
  onCommit,
  pending,
}: {
  span: Span;
  timeline: Timeline;
  index: StatusIndex;
  onSelect: (id: string) => void;
  selected: boolean;
  blocked: boolean;
  /** Omitted (not a no-op) means "not editable yet" — see `GanttBar`. */
  onCommit?: (span: Span, edit: BarEdit) => void;
  pending: boolean;
}): ReactNode {
  const bead = span.bead;
  const style = typeStyle(bead.issue_type);
  const done = index.isDone(bead.status);

  return (
    // `group/row` is what reveals the bar's drag handle on hover.
    <li
      className={cn(
        'group/row border-border/40 hover:bg-surface-hover flex items-center border-b transition-colors',
        selected && 'bg-surface-active',
      )}
    >
      <div
        className={cn(
          GUTTER_CLASS,
          'bg-bg sticky left-0 z-10 flex min-w-0 items-center gap-1.5 py-1 pr-2 pl-6',
        )}
      >
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
        {blocked ? <Lock aria-label="blocked" className="text-fg-muted size-3 shrink-0" /> : null}
        <PriorityDot priority={bead.priority} />
      </div>

      <GanttBar
        span={span}
        timeline={timeline}
        done={done}
        onSelect={onSelect}
        onCommit={onCommit ? (edit) => onCommit(span, edit) : undefined}
        pending={pending}
      />
    </li>
  );
}
