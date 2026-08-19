/**
 * Moving a board card with the keyboard.
 *
 * dnd-kit ships a `KeyboardSensor`, but neither of its coordinate getters fits
 * this board:
 *
 * - the built-in default translates the card by 25px per arrow press. A column
 *   is 288px wide, so crossing one takes a dozen presses and the card spends
 *   most of them over no column at all.
 * - `sortableKeyboardCoordinates` from `@dnd-kit/sortable` bails out unless
 *   `droppableContainers.get(active.id)` resolves — it expects the dragged item
 *   to be a droppable too, which is true inside a `SortableContext` and false
 *   here, where cards are plain `useDraggable` and only the columns are
 *   droppables. It would return `undefined` on every press.
 *
 * So a move here is one *column*, not one step of pixels: the geometry below
 * picks the neighbouring droppable in the arrow's direction and hands back its
 * origin. Same shape as `board-columns.ts` and `board-swimlanes.ts` — the
 * decisions are pure functions, testable without mounting the board.
 */
import { CATEGORY_LABELS, type StatusCategory } from '../../shared/types';
import { parseDropId } from './board-swimlanes';

/**
 * The four keys that mean "move". An allowlist, so every other key — typing,
 * tabbing, shortcuts — keeps its own behaviour and its default action.
 */
const ARROW_CODES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

export type ArrowCode = (typeof ARROW_CODES)[number];

export function isArrowCode(code: string): code is ArrowCode {
  return (ARROW_CODES as readonly string[]).includes(code);
}

/**
 * Which way each arrow searches. Exhaustive over `ArrowCode` — a new arrow
 * cannot be added without giving it a direction here.
 *
 * `along` is the axis the key moves on; the other axis is the cross axis, and
 * staying close on it is what keeps a sideways move inside its own swimlane.
 */
const DIRECTION: Record<ArrowCode, { along: 'left' | 'top'; sign: 1 | -1 }> = {
  ArrowLeft: { along: 'left', sign: -1 },
  ArrowRight: { along: 'left', sign: 1 },
  ArrowUp: { along: 'top', sign: -1 },
  ArrowDown: { along: 'top', sign: 1 },
};

/** Sub-pixel noise from `getBoundingClientRect` is not a move. */
const NOISE = 1;

/** A measured drop target: a column's droppable id and the box it occupies. */
export interface DropTargetRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The drop target one step from `from` in the arrow's direction, or
 * `undefined` at the edge of the board.
 *
 * Deliberately does not wrap around. A card that silently reappears on the
 * far side of the board is a card the user has lost; stopping is the honest
 * answer, and the screen reader announcement stays on the last real column.
 *
 * Candidates are ranked by cross-axis distance first, then by how far along
 * they are: from a swimlane grid, "right" is the next column *in this lane*
 * even though every column of every lower lane is also to the right.
 *
 * `from` is the card's own top-left, which sits *inside* a column and so is a
 * few pixels right of and well below that column's origin — the column the
 * card is already in would otherwise look like a move. Any column whose box
 * spans `from` on the axis being moved along is that column, and is skipped.
 */
export function nextDropTarget(
  code: ArrowCode,
  from: { left: number; top: number },
  targets: readonly DropTargetRect[],
): DropTargetRect | undefined {
  const { along, sign } = DIRECTION[code];
  const across = along === 'left' ? 'top' : 'left';
  const span = along === 'left' ? 'width' : 'height';

  let best: DropTargetRect | undefined;
  let bestAcross = Number.POSITIVE_INFINITY;
  let bestAlong = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    // The board renders its narrow and wide layouts at once and lets a
    // container query hide one; the hidden half measures 0x0 at the viewport
    // origin. Zero area is not somewhere a card can go — and since each half
    // now registers under its own droppable id, both halves really are in this
    // list, so this is the line that keeps the hidden one out of the ranking.
    if (target.width <= 0 || target.height <= 0) continue;

    const start = target[along];
    if (from[along] >= start && from[along] < start + target[span]) continue;

    const distance = (start - from[along]) * sign;
    if (distance <= NOISE) continue;

    const offset = Math.abs(target[across] - from[across]);
    if (offset > bestAcross || (offset === bestAcross && distance >= bestAlong)) continue;

    best = target;
    bestAcross = offset;
    bestAlong = distance;
  }

  return best;
}

/**
 * The shape `boardKeyboardCoordinates` needs out of dnd-kit's sensor context —
 * spelled out structurally so the geometry can be tested with plain objects.
 */
interface DroppableRegistry {
  droppableContainers: { getEnabled(): readonly { id: string | number }[] };
  droppableRects: {
    get(
      id: string | number,
    ): { left: number; top: number; width: number; height: number } | undefined;
  };
}

/**
 * dnd-kit's `KeyboardCoordinateGetter` for the board: one press, one column.
 *
 * Returning `undefined` leaves the card exactly where it is, which is what the
 * edge of the board and every non-arrow key both mean. The default action is
 * only swallowed for keys that actually moved something, so Tab and Escape
 * still reach the sensor and the browser.
 */
export function boardKeyboardCoordinates(
  event: { code: string; preventDefault(): void },
  { currentCoordinates, context }: {
    currentCoordinates: { x: number; y: number };
    context: DroppableRegistry;
  },
): { x: number; y: number } | undefined {
  if (!isArrowCode(event.code)) return undefined;
  event.preventDefault();

  const targets: DropTargetRect[] = [];
  for (const container of context.droppableContainers.getEnabled()) {
    // A registered column with no rect yet has not been measured — which is not
    // the same as sitting at the origin. Skipping it keeps an unmeasured column
    // out of the ranking instead of letting it win every leftward move.
    const rect = context.droppableRects.get(container.id);
    if (!rect) continue;
    targets.push({
      id: String(container.id),
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  const target = nextDropTarget(
    event.code,
    { left: currentCoordinates.x, top: currentCoordinates.y },
    targets,
  );
  if (!target) return undefined;

  return { x: target.left, y: target.top };
}

function isStatusCategory(value: string): value is StatusCategory {
  return Object.hasOwn(CATEGORY_LABELS, value);
}

/**
 * What to call a droppable out loud.
 *
 * Returns `undefined` — never a guess — for an id whose category is not one
 * the board knows, so callers can fall back to the raw id rather than announce
 * a label that does not exist.
 *
 * The narrow/wide half of the id is deliberately dropped: it exists only so
 * dnd-kit can tell two mounted copies of one column apart, and a user standing
 * on a column wants to hear the column, not the breakpoint.
 */
export function dropTargetName(dropId: string): string | undefined {
  const { lane, category } = parseDropId(dropId);
  if (!isStatusCategory(category)) return undefined;

  const label = CATEGORY_LABELS[category];
  return lane ? `${label}, ${lane} lane` : label;
}

/** `undefined` from `dropTargetName` keeps the raw id; it never invents one. */
function spoken(id: string | number): string {
  const name = String(id);
  return dropTargetName(name) ?? name;
}

interface AnnouncementArgs {
  active: { id: string | number };
  over?: { id: string | number } | null;
}

/**
 * What a screen reader hears during a keyboard move.
 *
 * dnd-kit's defaults read the droppable id verbatim — "moved over droppable
 * area needs-human::wip", which is an implementation detail, not a place.
 * These say the column the user can see instead.
 */
export const BOARD_ANNOUNCEMENTS = {
  onDragStart({ active }: Pick<AnnouncementArgs, 'active'>): string {
    return `Picked up issue ${active.id}.`;
  },
  onDragOver({ active, over }: AnnouncementArgs): string {
    return over
      ? `Issue ${active.id} is over ${spoken(over.id)}.`
      : `Issue ${active.id} is over no column.`;
  },
  onDragEnd({ active, over }: AnnouncementArgs): string {
    return over
      ? `Issue ${active.id} dropped on ${spoken(over.id)}.`
      : `Issue ${active.id} was dropped without moving.`;
  },
  onDragCancel({ active }: AnnouncementArgs): string {
    return `Move cancelled. Issue ${active.id} stayed where it was.`;
  },
};

/**
 * Space picks a card up; Enter is left alone so it keeps opening the issue,
 * which is what it does on every card outside the board too.
 *
 * Tab ends a move rather than tabbing away mid-drag, matching dnd-kit's own
 * default.
 */
export const BOARD_KEYBOARD_CODES = {
  start: ['Space'],
  cancel: ['Escape'],
  end: ['Space', 'Enter', 'Tab'],
};

/** Read out once, when a card takes focus. Names the keys this board honours. */
export const BOARD_SCREEN_READER_INSTRUCTIONS = {
  draggable:
    'To move this issue to another column, press the space bar. ' +
    'While holding it, the left and right arrow keys move between columns and the up and down ' +
    'arrow keys move between swimlanes. Press space again to drop it, or escape to cancel. ' +
    'Press enter to open the issue instead.',
};
