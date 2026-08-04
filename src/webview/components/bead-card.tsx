/**
 * One issue, at the density a board can actually be read at.
 *
 * The design system's card budget is id + title + type icon + priority dot. Two
 * things were added on top, both because classification by *shape alone* proved
 * too slow to scan: a type-coloured spine down the left edge, and label chips
 * with a stable per-label hue. Both are colour on top of an existing text
 * signal, never colour instead of one.
 */
import { CalendarClock, Lock } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { typeStyle, type Bead } from '../../shared/types';
import { labelChipStyle } from '../lib/label-color';
import { cn, shortDate } from '../lib/utils';
import { PriorityDot, TypeIcon } from './primitives';

/** Beyond this many chips a card stops being scannable; the rest get a count. */
const MAX_LABELS = 3;

export function BeadCard({
  bead,
  selected,
  blocked,
  onSelect,
  dragging,
  className,
}: {
  bead: Bead;
  selected?: boolean;
  blocked?: boolean;
  onSelect?: (id: string) => void;
  dragging?: boolean;
  className?: string;
}): ReactNode {
  const style = typeStyle(bead.issue_type);
  const labels = bead.labels ?? [];
  const overflow = labels.length - MAX_LABELS;
  const overdue = bead.due_at !== undefined && Date.parse(bead.due_at) < Date.now() && !bead.closed_at;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`${bead.id}: ${bead.title}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect?.(bead.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(bead.id);
        }
      }}
      style={{ '--type-color': style.color } as CSSProperties}
      className={cn(
        'surface-interactive card-raise type-spine group cursor-pointer rounded-md border py-2 pr-2.5 pl-3',
        // Hover changes background, border and shadow only — never transform. A
        // card that jumps under the cursor is unusable in a dense column.
        'bg-surface hover:bg-surface-hover border-border hover:border-border-strong',
        selected && 'border-border-strong bg-surface-active',
        dragging && 'rotate-[0.6deg] opacity-60 shadow-lg',
        className,
      )}
    >
      <div className="text-fg-muted flex items-center gap-1.5 text-xs">
        <TypeIcon type={bead.issue_type} className={style.className} />
        <span className={cn('shrink-0 text-[10px] tracking-wide uppercase', style.className)}>
          {bead.issue_type}
        </span>
        <span className="truncate font-mono opacity-70">{bead.id}</span>
        {blocked ? (
          <span title="Blocked by another issue" className="ml-auto shrink-0">
            <Lock aria-hidden="true" className="size-3" />
            <span className="sr-only">blocked</span>
          </span>
        ) : null}
      </div>

      <p className="text-fg-strong mt-1 line-clamp-2 text-sm leading-snug">{bead.title}</p>

      {labels.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {labels.slice(0, MAX_LABELS).map((label) => (
            <li
              key={label}
              className="label-chip rounded-sm px-1.5 py-px text-[10px] leading-4"
              style={labelChipStyle(label)}
            >
              {label}
            </li>
          ))}
          {overflow > 0 ? (
            <li className="text-fg-muted text-[10px] leading-4" title={labels.join(', ')}>
              +{overflow}
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="mt-1.5 flex items-center gap-2">
        <PriorityDot priority={bead.priority} />
        {bead.due_at ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[11px] tabular-nums',
              overdue ? 'text-danger' : 'text-fg-muted',
            )}
            title={overdue ? `Overdue — due ${bead.due_at}` : `Due ${bead.due_at}`}
          >
            <CalendarClock aria-hidden="true" className="size-3" />
            {shortDate(bead.due_at)}
          </span>
        ) : null}
        {bead.assignee ? (
          <span
            className="text-fg-muted ml-auto max-w-[50%] truncate text-xs"
            title={`PIC: ${bead.assignee}`}
          >
            {bead.assignee}
          </span>
        ) : null}
      </div>
    </article>
  );
}
