/**
 * One issue, at the density a board can actually be read at.
 *
 * The design system's card budget is id + title + type icon + priority dot. Two
 * things were added on top, both because classification by *shape alone* proved
 * too slow to scan: a type-coloured spine down the left edge, and label chips
 * with a stable per-label hue. Both are colour on top of an existing text
 * signal, never colour instead of one.
 */
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { CalendarClock, Lock } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { typeStyle, type Bead } from '../../shared/types';
import { labelChipStyle } from '../lib/label-color';
import { cn, shortDate } from '../lib/utils';
import { PriorityDot, TypeIcon } from './primitives';

/** Beyond this many chips a card stops being scannable; the rest get a count. */
const MAX_LABELS = 3;

/**
 * What a card needs to be picked up and moved.
 *
 * Only the board hands this over. A card in Overview or Roadmap goes without
 * it, keeps its plain click-and-Enter behaviour, and — importantly — does not
 * tell a screen reader it is draggable when nothing can move it.
 *
 * All three pieces land on the *same* element, the card itself: dnd-kit only
 * fires its activator when the key event's target is the activator node, and
 * putting the aria attributes anywhere but the focusable element would leave
 * the announcement on one node and the keyboard on another.
 */
export interface CardDrag {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setActivatorRef: (element: HTMLElement | null) => void;
}

/**
 * The attributes that make a card a control rather than a picture.
 *
 * A card is normally a button: it has a role, it is a tab stop, and it carries
 * the issue's accessible name. The one copy that must not be any of those is
 * the ghost inside `DragOverlay` — see `presentational` below.
 */
const CONTROL_ATTRIBUTES = { role: 'button', tabIndex: 0 } as const;
const GHOST_ATTRIBUTES = { 'aria-hidden': true } as const;

export function BeadCard({
  bead,
  selected,
  blocked,
  onSelect,
  drag,
  dragging,
  presentational,
  className,
}: {
  bead: Bead;
  selected?: boolean;
  blocked?: boolean;
  onSelect?: (id: string) => void;
  drag?: CardDrag;
  dragging?: boolean;
  /**
   * Render this card as a picture of a card, not a card.
   *
   * `DragOverlay` renders a second copy of the bead being dragged, and
   * @dnd-kit/core does nothing to it: its wrapper is a bare
   * `<div class style>` (`PositionedOverlay`, core.cjs.development.js:3668 —
   * `createElement(as, { className, style, ref }, children)`), with no
   * `aria-hidden`, no `inert` and no `tabindex`. Left alone the ghost is a
   * second `role="button"` tab stop announcing the same name as the real card
   * that still holds focus. So the ghost drops its role, its name and its
   * place in the tab order, and hides its whole subtree — it is decoration on
   * top of a control that exists elsewhere.
   *
   * `aria-hidden` and focusability must move together: an `aria-hidden`
   * subtree containing a tab stop is worse than either problem alone.
   */
  presentational?: boolean;
  className?: string;
}): ReactNode {
  const style = typeStyle(bead.issue_type);
  const labels = bead.labels ?? [];
  const overflow = labels.length - MAX_LABELS;
  const overdue = bead.due_at !== undefined && Date.parse(bead.due_at) < Date.now() && !bead.closed_at;

  // dnd-kit hands its activator over as an untyped synthetic listener map.
  const pickUp = drag?.listeners?.onKeyDown as
    | ((event: KeyboardEvent<HTMLElement>) => void)
    | undefined;

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    // Mid-move the keyboard belongs to the drag: space drops, escape cancels,
    // and enter means "drop here" — none of them mean "open this issue".
    if (!dragging) {
      // Enter always opens. Space opens too, but only where the card cannot be
      // picked up; on the board that key is the pick-up gesture instead.
      if (event.key === 'Enter' || (event.key === ' ' && !drag)) {
        event.preventDefault();
        onSelect?.(bead.id);
        return;
      }
    }
    pickUp?.(event);
  }

  return (
    <article
      ref={presentational ? undefined : drag?.setActivatorRef}
      {...(presentational ? GHOST_ATTRIBUTES : CONTROL_ATTRIBUTES)}
      {...(presentational ? undefined : drag?.attributes)}
      {...(presentational ? undefined : drag?.listeners)}
      aria-label={presentational ? undefined : `${bead.id}: ${bead.title}`}
      aria-current={!presentational && selected ? 'true' : undefined}
      onClick={presentational ? undefined : () => onSelect?.(bead.id)}
      onKeyDown={presentational ? undefined : onKeyDown}
      style={{ '--type-color': style.color } as CSSProperties}
      className={cn(
        'surface-interactive card-raise type-spine group rounded-md border py-2 pr-2.5 pl-3',
        // The pointer-cursor affordance belongs to the real, clickable card only.
        // The presentational ghost has no click/keyboard handlers and is under
        // the pointer for the whole drag, so a hover-pointer cursor on it is
        // dead weight at best and a stray, misleading cue over a "grabbing"
        // drag cursor at worst.
        !presentational && 'cursor-pointer',
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
