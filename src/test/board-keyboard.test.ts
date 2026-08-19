import { describe, expect, it, vi } from 'vitest';

import {
  BOARD_ANNOUNCEMENTS,
  BOARD_KEYBOARD_CODES,
  BOARD_SCREEN_READER_INSTRUCTIONS,
  boardKeyboardCoordinates,
  dropTargetName,
  nextDropTarget,
} from '../webview/lib/board-keyboard';
import { narrowDropId } from '../webview/lib/board-swimlanes';

/** A card sits *inside* a column, so every `from` below is inset from one. */
function column(id: string, left: number, top: number, height = 600) {
  return { id, left, top, width: 288, height };
}

/**
 * A flat board: four columns in one row, at the lefts a 288px-wide column grid
 * actually produces. `top` is the same for every column because they are one
 * row.
 */
const FLAT = [
  column('active', 0, 100),
  column('wip', 300, 100),
  column('frozen', 600, 100),
  column('done', 900, 100),
];

/** Two swimlanes, each repeating the same three columns one row lower. */
const LANES = [
  column('auto-ok::active', 0, 100, 320),
  column('auto-ok::wip', 300, 100, 320),
  column('auto-ok::done', 600, 100, 320),
  column('needs-human::active', 0, 500, 320),
  column('needs-human::wip', 300, 500, 320),
  column('needs-human::done', 600, 500, 320),
];

describe('nextDropTarget', () => {
  it('steps right to the nearest column, not the furthest one', () => {
    expect(nextDropTarget('ArrowRight', { left: 8, top: 140 }, FLAT)?.id).toBe('wip');
  });

  it('steps left to the nearest column', () => {
    expect(nextDropTarget('ArrowLeft', { left: 608, top: 140 }, FLAT)?.id).toBe('wip');
  });

  it('stops at the last column instead of wrapping around to the first', () => {
    expect(nextDropTarget('ArrowRight', { left: 908, top: 140 }, FLAT)).toBeUndefined();
  });

  it('stops at the first column instead of wrapping around to the last', () => {
    expect(nextDropTarget('ArrowLeft', { left: 8, top: 140 }, FLAT)).toBeUndefined();
  });

  it('moves down into the same category one lane lower, not sideways', () => {
    expect(nextDropTarget('ArrowDown', { left: 308, top: 140 }, LANES)?.id).toBe(
      'needs-human::wip',
    );
  });

  it('moves up into the same category one lane higher', () => {
    expect(nextDropTarget('ArrowUp', { left: 308, top: 540 }, LANES)?.id).toBe('auto-ok::wip');
  });

  it('stops at the top lane rather than wrapping to the bottom one', () => {
    expect(nextDropTarget('ArrowUp', { left: 308, top: 140 }, LANES)).toBeUndefined();
  });

  it('keeps a sideways move inside its own lane', () => {
    // From the top lane's `wip`, "right" must be the top lane's `done` — never
    // the bottom lane's, which is also to the right.
    expect(nextDropTarget('ArrowRight', { left: 308, top: 140 }, LANES)?.id).toBe('auto-ok::done');
  });

  it('finds nothing at all when no column has been measured', () => {
    expect(nextDropTarget('ArrowRight', { left: 8, top: 140 }, [])).toBeUndefined();
  });

  it('ignores a column laid out to zero size, such as the hidden half of the responsive board', () => {
    // Narrow and wide are both in the DOM; whichever the container query hides
    // measures 0x0 at the viewport origin. A card must not be movable into it,
    // and it must not swallow the leftward move off the first real column.
    const hidden = { id: 'active', left: 0, top: 0, width: 0, height: 0 };

    expect(nextDropTarget('ArrowLeft', { left: 8, top: 140 }, [...FLAT, hidden])).toBeUndefined();
    expect(nextDropTarget('ArrowRight', { left: 8, top: 140 }, [...FLAT, hidden])?.id).toBe('wip');
  });

  it('never offers the column the card is already in as a destination', () => {
    // From inside `frozen`, stepping left must reach `wip` — not `frozen`,
    // whose own origin is also to the left of the inset card.
    expect(nextDropTarget('ArrowLeft', { left: 608, top: 140 }, FLAT)?.id).toBe('wip');
    expect(nextDropTarget('ArrowRight', { left: 608, top: 140 }, FLAT)?.id).toBe('done');
  });
});

describe('boardKeyboardCoordinates', () => {
  function context(rects: typeof FLAT, unmeasured: string[] = []) {
    const map = new Map(rects.map((rect) => [rect.id, rect]));
    return {
      droppableContainers: {
        getEnabled: () => [...rects.map(({ id }) => ({ id })), ...unmeasured.map((id) => ({ id }))],
      },
      droppableRects: { get: (id: string) => map.get(id) },
    };
  }

  function event(code: string) {
    return { code, preventDefault: vi.fn() };
  }

  it('returns the top-left of the column one step to the right', () => {
    const keyEvent = event('ArrowRight');
    const next = boardKeyboardCoordinates(keyEvent, {
      currentCoordinates: { x: 8, y: 140 },
      context: context(FLAT),
    });

    expect(next).toEqual({ x: 300, y: 100 });
    expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it('leaves every non-arrow key alone, including its default action', () => {
    const keyEvent = event('KeyR');
    expect(
      boardKeyboardCoordinates(keyEvent, {
        currentCoordinates: { x: 8, y: 140 },
        context: context(FLAT),
      }),
    ).toBeUndefined();
    expect(keyEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('skips a column that has not been measured instead of reading it as 0,0', () => {
    // `ghost` is registered but has no rect yet. Treating a missing rect as the
    // origin would put it left of everything and win every ArrowLeft.
    const next = boardKeyboardCoordinates(event('ArrowLeft'), {
      currentCoordinates: { x: 608, y: 140 },
      context: context(FLAT, ['ghost']),
    });

    expect(next).toEqual({ x: 300, y: 100 });
  });

  it('holds still at the edge of the board rather than reporting a move', () => {
    expect(
      boardKeyboardCoordinates(event('ArrowRight'), {
        currentCoordinates: { x: 908, y: 140 },
        context: context(FLAT),
      }),
    ).toBeUndefined();
  });
});

describe('dropTargetName', () => {
  it('names a flat-board column by its label, not its category id', () => {
    expect(dropTargetName('wip')).toBe('In Progress');
  });

  it('names a swimlane column by both its label and its lane', () => {
    expect(dropTargetName('needs-human::wip')).toBe('In Progress, needs-human lane');
  });

  it('returns nothing for an id whose category is not a real one', () => {
    expect(dropTargetName('not-a-category')).toBeUndefined();
    expect(dropTargetName('needs-human::not-a-category')).toBeUndefined();
  });

  it('says nothing about which layout half a column belongs to', () => {
    // The narrow and the wide copy of a column carry different droppable ids so
    // dnd-kit can tell them apart. That is plumbing: a screen reader user is
    // standing on one column, and should hear the column, not the breakpoint.
    expect(dropTargetName(narrowDropId('wip'))).toBe('In Progress');
    expect(dropTargetName(narrowDropId('needs-human::wip'))).toBe('In Progress, needs-human lane');
  });
});

describe('BOARD_ANNOUNCEMENTS', () => {
  it('names the column a card moved over, rather than reading out the droppable id', () => {
    const spoken = BOARD_ANNOUNCEMENTS.onDragOver({
      active: { id: 'bd-1' },
      over: { id: 'needs-human::wip' },
    });

    expect(spoken).toContain('bd-1');
    expect(spoken).toContain('In Progress, needs-human lane');
    expect(spoken).not.toContain('::');
  });

  it('keeps the raw id when there is no label for it, instead of inventing one', () => {
    const spoken = BOARD_ANNOUNCEMENTS.onDragOver({
      active: { id: 'bd-1' },
      over: { id: 'mystery' },
    });

    expect(spoken).toContain('mystery');
  });

  it('says the card is over nothing when it is over nothing', () => {
    expect(BOARD_ANNOUNCEMENTS.onDragOver({ active: { id: 'bd-1' }, over: null })).toContain(
      'no column',
    );
  });

  it('distinguishes a drop that landed on a column from one that landed nowhere', () => {
    const landed = BOARD_ANNOUNCEMENTS.onDragEnd({ active: { id: 'bd-1' }, over: { id: 'done' } });
    const nowhere = BOARD_ANNOUNCEMENTS.onDragEnd({ active: { id: 'bd-1' }, over: null });

    expect(landed).toContain('Done');
    expect(nowhere).not.toContain('Done');
    expect(nowhere).toContain('bd-1');
  });

  it('says a cancelled move left the card where it was', () => {
    expect(BOARD_ANNOUNCEMENTS.onDragCancel({ active: { id: 'bd-1' }, over: null })).toContain(
      'bd-1',
    );
  });

  it('announces the pick-up by issue id', () => {
    expect(BOARD_ANNOUNCEMENTS.onDragStart({ active: { id: 'bd-1' } })).toContain('bd-1');
  });
});

describe('BOARD_KEYBOARD_CODES', () => {
  it('starts a move on space only, so enter is still "open this issue"', () => {
    expect(BOARD_KEYBOARD_CODES.start).toEqual(['Space']);
    expect(BOARD_KEYBOARD_CODES.start).not.toContain('Enter');
  });

  it('offers escape as the way out of a move in progress', () => {
    expect(BOARD_KEYBOARD_CODES.cancel).toContain('Escape');
  });

  it('drops on space or enter', () => {
    expect(BOARD_KEYBOARD_CODES.end).toContain('Space');
    expect(BOARD_KEYBOARD_CODES.end).toContain('Enter');
  });
});

describe('BOARD_SCREEN_READER_INSTRUCTIONS', () => {
  it('spells out every key the board actually honours', () => {
    const text = BOARD_SCREEN_READER_INSTRUCTIONS.draggable.toLowerCase();
    for (const key of ['space', 'arrow', 'escape']) expect(text).toContain(key);
  });
});
