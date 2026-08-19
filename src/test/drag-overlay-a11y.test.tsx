// @vitest-environment jsdom

/**
 * The drag ghost, measured against the REAL @dnd-kit/core.
 *
 * `board-view.test.tsx` mocks `@dnd-kit/core`, so nothing there can say what
 * the library actually renders — and the whole question this suite settles is
 * exactly that: does `DragOverlay` remove its copy from the accessibility tree
 * and the tab order on its own, or does `BeadCard` have to?
 *
 * The answer, read off the shipped bundle, is that it does not.
 * `PositionedOverlay` renders `createElement(as, { className, style, ref },
 * children)` (node_modules/@dnd-kit/core/dist/core.cjs.development.js:3668):
 * a bare `<div>` carrying nothing but a class and a fixed-position style. The
 * string `aria-hidden` does not appear anywhere in that bundle, and the only
 * `tabIndex` in it belongs to `useDraggable`'s attributes for the *real* card.
 *
 * So these tests drive a real drag through the real `KeyboardSensor` and
 * assert on the resulting DOM. If a future dnd-kit starts hiding its overlay
 * itself, `the overlay wrapper dnd-kit renders is inert only because we make
 * it so` fails and `BeadCard`'s `presentational` prop can be reconsidered; if
 * someone drops `presentational` from `BoardView`, the duplicate-name and
 * tab-stop tests fail.
 */

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { BeadCard } from '../webview/components/bead-card';
import type { Bead } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const bead: Bead = {
  id: 'ghost-1',
  title: 'A card being dragged',
  status: 'open',
  priority: 2,
  issue_type: 'task',
};

/** The accessible name `BeadCard` gives a real, focusable card. */
const NAME = `${bead.id}: ${bead.title}`;

/**
 * The board's own arrangement, reduced to the two cards that matter: the real
 * one that stays mounted in its column and keeps focus, and the ghost inside
 * `DragOverlay`. Everything between them here is the real library.
 */
function Board({ presentational }: { presentational: boolean }): ReactNode {
  const sensors = useSensors(useSensor(KeyboardSensor));
  return createElement(
    DndContext,
    { sensors },
    createElement(RealCard, null),
    createElement(
      DragOverlay,
      { dropAnimation: null },
      createElement(BeadCard, { bead, presentational, className: 'w-64' }),
    ),
  );
}

function RealCard(): ReactNode {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({ id: bead.id });
  return createElement(
    'div',
    { ref: setNodeRef },
    createElement(BeadCard, {
      bead,
      drag: { attributes, listeners, setActivatorRef: setActivatorNodeRef },
    }),
  );
}

let mountedRoot: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.replaceChildren();
});

/**
 * Mount the board and pick the card up for real: focus it, then press space,
 * which is `KeyboardSensor`'s default start key. Nothing here is stubbed —
 * the sensor, the context and the overlay are all dnd-kit's.
 */
async function pickUp(presentational: boolean): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(createElement(Board, { presentational })));

  const card = container.querySelector<HTMLElement>(`[aria-label="${NAME}"]`);
  expect(card, 'the real card should be mounted before the drag starts').not.toBeNull();
  card?.focus();
  await act(async () => {
    card?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Space', key: ' ' }));
  });

  // A drag that never started would make every assertion below vacuous.
  expect(overlayWrapper(container), 'DragOverlay should have rendered its ghost').not.toBeNull();
  return container;
}

/**
 * dnd-kit's overlay wrapper: the one fixed-position element it positions by
 * hand. It has no role, no id and no test hook, so `position: fixed` written
 * into the inline style is what identifies it.
 */
function overlayWrapper(container: HTMLElement): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>('div')].find(
    (element) => element.style.position === 'fixed',
  ) ?? null;
}

describe('the BeadCard copy inside DragOverlay', () => {
  it('leaves exactly one element carrying the bead’s accessible name', async () => {
    const container = await pickUp(true);

    expect(container.querySelectorAll(`[aria-label="${NAME}"]`)).toHaveLength(1);
    // And it is the real one, not the ghost: it sits outside the overlay.
    const named = container.querySelector(`[aria-label="${NAME}"]`);
    expect(overlayWrapper(container)?.contains(named ?? null)).toBe(false);
  });

  it('is not a tab stop and claims no button role', async () => {
    const container = await pickUp(true);
    const ghost = overlayWrapper(container)?.querySelector('article');

    expect(ghost).not.toBeNull();
    expect(ghost?.hasAttribute('tabindex')).toBe(false);
    expect(ghost?.hasAttribute('role')).toBe(false);
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
  });

  it('hides nothing that is focusable, so aria-hidden stays legal', async () => {
    const container = await pickUp(true);
    const overlay = overlayWrapper(container);

    // An aria-hidden subtree containing a tab stop is the axe `aria-hidden-focus`
    // violation — worse than either half of the bug on its own.
    expect(overlay?.querySelectorAll('[tabindex]:not([tabindex="-1"]), a[href], button')).toHaveLength(
      0,
    );
  });

  it('is inert only because BeadCard makes it so — dnd-kit hides nothing', async () => {
    // This is the pin on the library. Rendering the same overlay WITHOUT
    // `presentational` reproduces the original bug in full, which is only
    // possible because dnd-kit's wrapper contributes no aria-hidden, no inert
    // and no tabindex. If a future version starts doing that, this fails and
    // `presentational` can be revisited.
    const container = await pickUp(false);
    const overlay = overlayWrapper(container);

    expect(overlay?.hasAttribute('aria-hidden')).toBe(false);
    expect(overlay?.hasAttribute('inert')).toBe(false);
    expect(overlay?.hasAttribute('tabindex')).toBe(false);
    expect(container.querySelectorAll(`[aria-label="${NAME}"]`)).toHaveLength(2);
    expect(overlay?.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });
});
