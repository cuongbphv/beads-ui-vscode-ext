// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rpc = vi.hoisted(() => ({ calls: new Array<{ id: string; status: string }>() }));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: { id: string; status: string }) => {
    if (method === 'setStatus') rpc.calls.push(params);
    return Promise.resolve({});
  },
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

// A full drag simulated through PointerSensor is a lot of jsdom pointer-event
// plumbing for what this test actually needs to prove: that BoardView feeds
// the *category* half of a composite drop id into `setStatus` and never the
// lane half. Capturing the real onDragEnd/onDragStart callbacks BoardView
// hands to DndContext, and invoking one directly with a synthetic
// `DragEndEvent`, exercises exactly that wiring without faking a pointer.
//
// The sensors, the accessibility wiring and the per-card activator listener are
// recorded too, because a keyboard move is those three pieces meeting: a
// KeyboardSensor that is actually registered, an activator sitting on the
// element keyboard focus lands on, and announcements naming a column rather
// than a droppable id.
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: { active: { id: string }; over?: { id: string } }) => void) | undefined,
  onDragStart: undefined as ((event: { active: { id: string } }) => void) | undefined,
  onDragCancel: undefined as (() => void) | undefined,
  accessibility: undefined as
    | { announcements?: unknown; screenReaderInstructions?: unknown }
    | undefined,
  sensors: new Array<{ sensor: unknown; options: unknown }>(),
  activated: new Array<string>(),
}));

vi.mock('@dnd-kit/core', () => {
  class PointerSensor {}
  class KeyboardSensor {}

  return {
    DndContext: ({
      children,
      onDragStart,
      onDragEnd,
      onDragCancel,
      accessibility,
    }: {
      children: unknown;
      onDragStart: (event: { active: { id: string } }) => void;
      onDragEnd: (event: { active: { id: string }; over?: { id: string } }) => void;
      onDragCancel?: () => void;
      accessibility?: { announcements?: unknown; screenReaderInstructions?: unknown };
    }) => {
      dnd.onDragStart = onDragStart;
      dnd.onDragEnd = onDragEnd;
      dnd.onDragCancel = onDragCancel;
      dnd.accessibility = accessibility;
      return children;
    },
    DragOverlay: ({ children }: { children: unknown }) => children,
    // The real hook hands back the aria wiring that makes a card announce
    // itself draggable, plus the activator listener the sensors install.
    useDraggable: ({ id }: { id: string }) => ({
      attributes: {
        role: 'button',
        tabIndex: 0,
        'aria-roledescription': 'draggable',
        'aria-describedby': 'DndDescribedBy-0',
      },
      listeners: { onKeyDown: () => dnd.activated.push(id) },
      setNodeRef: () => {},
      setActivatorNodeRef: () => {},
      isDragging: false,
    }),
    // Stamping the id onto the node is how the real hook's registration is made
    // observable: dnd-kit keys its droppable registry by id (`containers.set(id,
    // element)`), so two mounted nodes asking for the same id collapse into one
    // entry and only the last one registered stays reachable. Reading the ids
    // back off the DOM counts what is *mounted right now*, rather than every id
    // the hook was ever called with.
    useDroppable: ({ id }: { id: string }) => ({
      setNodeRef: (node: HTMLElement | null) => {
        if (node) node.dataset.dropId = String(id);
      },
      isOver: false,
    }),
    useSensor: (sensor: unknown, options: unknown) => {
      dnd.sensors.push({ sensor, options });
      return { sensor, options };
    },
    useSensors: (...descriptors: unknown[]) => descriptors,
    PointerSensor,
    KeyboardSensor,
  };
});

import { KeyboardSensor, PointerSensor } from '@dnd-kit/core';

import {
  BOARD_ANNOUNCEMENTS,
  BOARD_KEYBOARD_CODES,
  BOARD_SCREEN_READER_INSTRUCTIONS,
  boardKeyboardCoordinates,
} from '../webview/lib/board-keyboard';
import { BoardView } from '../webview/views/BoardView';

let mountedRoot: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.replaceChildren();
  container = undefined;
  rpc.calls.length = 0;
  dnd.onDragEnd = undefined;
  dnd.onDragStart = undefined;
  dnd.onDragCancel = undefined;
  dnd.accessibility = undefined;
  dnd.sensors.length = 0;
  dnd.activated.length = 0;
});

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'done', category: 'done' },
]);

const beads: Bead[] = [
  { id: 'safe-1', title: 'Auto-applied fix', status: 'open', priority: 2, issue_type: 'task', labels: ['auto-ok'] },
  { id: 'partial-1', title: 'Partial fix', status: 'open', priority: 2, issue_type: 'task', labels: ['auto-partial'] },
  { id: 'human-1', title: 'Needs a human', status: 'open', priority: 1, issue_type: 'task', labels: ['needs-human'] },
  { id: 'plain-1', title: 'Never triaged', status: 'open', priority: 2, issue_type: 'task' },
];

function props(overrides: Partial<Parameters<typeof BoardView>[0]> = {}): Parameters<typeof BoardView>[0] {
  return {
    beads,
    index,
    query: { includeClosed: true },
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    blockedIds: new Set<string>(),
    onCollapsedColumnsChange: vi.fn(),
    onSwimlanesChange: vi.fn(),
    ...overrides,
  };
}

async function mount(overrides: Partial<Parameters<typeof BoardView>[0]> = {}): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(createElement(BoardView, props(overrides))));
  return container;
}

describe('BoardView swimlane toggle', () => {
  it('renders one flat board with no lane headers when the toggle is off (default)', async () => {
    const root = await mount({ swimlanes: false });

    expect(root.querySelector('[aria-label^="auto-ok lane"]')).toBeNull();
    expect(root.querySelector('[aria-label^="needs-human lane"]')).toBeNull();
    // The flat board's own droppable ids are bare categories, e.g. `active`.
    expect(root.textContent).toContain('Auto-applied fix');
    expect(root.textContent).toContain('Never triaged');
  });

  it('renders the three taxonomy lanes plus unlabeled, in fixed order, when the toggle is on', async () => {
    const root = await mount({ swimlanes: true });

    const lanes = [...root.querySelectorAll('section[aria-label*=" lane, "]')].map((section) =>
      section.getAttribute('aria-label'),
    );
    expect(lanes).toEqual([
      expect.stringMatching(/^auto-ok lane, /),
      expect.stringMatching(/^auto-partial lane, /),
      expect.stringMatching(/^needs-human lane, /),
      expect.stringMatching(/^unlabeled lane, /),
    ]);

    // The unlabeled lane is the one carrying the warning affordance.
    const unlabeledHeader = root.querySelector('[aria-label^="unlabeled lane"] header');
    expect(unlabeledHeader?.textContent).toContain('unlabeled');
    expect(root.innerHTML).toContain('text-warning');
  });

  it('omits the unlabeled lane entirely when every bead carries a taxonomy label', async () => {
    const labeled = beads.filter((bead) => bead.id !== 'plain-1');
    const root = await mount({ swimlanes: true, beads: labeled });

    expect(root.querySelector('[aria-label^="unlabeled lane"]')).toBeNull();
  });

  it('calls the swimlane toggle callback when the affordance is clicked', async () => {
    const onSwimlanesChange = vi.fn();
    const root = await mount({ swimlanes: false, onSwimlanesChange });

    const toggle = root.querySelector<HTMLButtonElement>('button[aria-pressed="false"]');
    expect(toggle).not.toBeNull();
    await act(async () => toggle?.click());

    expect(onSwimlanesChange).toHaveBeenCalledWith(true);
  });
});

describe('BoardView drag-and-drop with swimlanes on', () => {
  it('parses a composite lane::category drop id and sets only the category as status', async () => {
    await mount({ swimlanes: true });
    expect(dnd.onDragEnd).toBeDefined();

    // "auto-ok::wip" — dropped in a different lane's column than the one the
    // card actually lives in; the lane half must never reach `setStatus`.
    await act(async () => dnd.onDragEnd?.({ active: { id: 'safe-1' }, over: { id: 'auto-ok::wip' } }));

    expect(rpc.calls).toEqual([{ id: 'safe-1', status: 'in_progress' }]);
  });

  it('still resolves a bare category drop id (the flat-board path) to the right status', async () => {
    await mount({ swimlanes: false });
    expect(dnd.onDragEnd).toBeDefined();

    await act(async () => dnd.onDragEnd?.({ active: { id: 'plain-1' }, over: { id: 'done' } }));

    expect(rpc.calls).toEqual([{ id: 'plain-1', status: 'done' }]);
  });

  it('dropping into a different lane never changes anything but status — no label mutation call is made', async () => {
    await mount({ swimlanes: true });

    await act(async () =>
      dnd.onDragEnd?.({ active: { id: 'human-1' }, over: { id: 'auto-ok::done' } }),
    );

    // Only one rpc call total, and it is setStatus — nothing resembling a
    // label/update call was ever issued by BoardView for a cross-lane drop.
    expect(rpc.calls).toEqual([{ id: 'human-1', status: 'done' }]);
  });
});

/**
 * The droppable id each mounted column node registered, in DOM order.
 *
 * The board mounts its narrow layout *and* its wide layout at the same time and
 * lets a container query hide one of them, so this is deliberately every copy —
 * hidden ones included. dnd-kit's registry is a Map keyed by id, so any repeat
 * here is a column node that has been silently overwritten in that registry.
 */
function dropIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-drop-id]')].map(
    (node) => node.dataset.dropId ?? '',
  );
}

/** The column node inside the half a container query hides below `@2xl`. */
function narrowDropNode(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('div[class*="@2xl:hidden"] [data-drop-id]');
}

/** The column node inside the half a container query hides at and above `@2xl`. */
function wideDropNode(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('div[class*="@2xl:flex"] [data-drop-id]');
}

describe('BoardView droppable ids', () => {
  it('never registers the same droppable id for two mounted columns (flat board)', async () => {
    const root = await mount({ swimlanes: false });

    // Three categories in the index: one narrow copy plus three wide copies.
    const ids = dropIds(root);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never registers the same droppable id for two mounted columns (swimlanes)', async () => {
    const root = await mount({ swimlanes: true });

    // Four lanes, each with one narrow copy plus three wide copies.
    const ids = dropIds(root);
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives the container-query-hidden copy its own id instead of shadowing the visible one', async () => {
    const root = await mount({ swimlanes: false });

    expect(narrowDropNode(root)?.dataset.dropId).toBeDefined();
    expect(wideDropNode(root)?.dataset.dropId).toBeDefined();
    expect(narrowDropNode(root)?.dataset.dropId).not.toBe(wideDropNode(root)?.dataset.dropId);
  });

  it('gives the container-query-hidden copy its own id in every lane too', async () => {
    const root = await mount({ swimlanes: true });

    const lane = root.querySelector<HTMLElement>('section[aria-label^="auto-ok lane"]');
    expect(lane).not.toBeNull();
    expect(narrowDropNode(lane!)?.dataset.dropId).not.toBe(wideDropNode(lane!)?.dataset.dropId);
  });

  it('resolves a drop on the narrow copy to the same status as the wide one', async () => {
    const root = await mount({ swimlanes: false });

    // The narrow board shows whichever column the switcher selected; pick one
    // the card is not already in, so a real status change is expected.
    const done = [...root.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Done'),
    );
    expect(done).toBeDefined();
    await act(async () => done?.click());

    const narrowId = narrowDropNode(root)?.dataset.dropId;
    expect(narrowId).toBeDefined();
    await act(async () => dnd.onDragEnd?.({ active: { id: 'plain-1' }, over: { id: narrowId! } }));

    expect(rpc.calls).toEqual([{ id: 'plain-1', status: 'done' }]);
  });

  it('resolves a drop on a lane’s narrow copy to that column’s status, lane discarded', async () => {
    const root = await mount({ swimlanes: true });

    const done = [...root.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Done'),
    );
    await act(async () => done?.click());

    const lane = root.querySelector<HTMLElement>('section[aria-label^="needs-human lane"]');
    const narrowId = narrowDropNode(lane!)?.dataset.dropId;
    expect(narrowId).toBeDefined();
    await act(async () => dnd.onDragEnd?.({ active: { id: 'safe-1' }, over: { id: narrowId! } }));

    expect(rpc.calls).toEqual([{ id: 'safe-1', status: 'done' }]);
  });
});

describe('BoardView keyboard moves', () => {
  it('registers a keyboard sensor alongside the pointer one, so a card is movable without a mouse', async () => {
    await mount();

    const registered = dnd.sensors.map((entry) => entry.sensor);
    expect(registered).toContain(PointerSensor);
    expect(registered).toContain(KeyboardSensor);
  });

  it('gives the keyboard sensor the board’s own column-to-column geometry and key map', async () => {
    await mount();

    const keyboard = dnd.sensors.find((entry) => entry.sensor === KeyboardSensor);
    expect(keyboard?.options).toEqual({
      coordinateGetter: boardKeyboardCoordinates,
      keyboardCodes: BOARD_KEYBOARD_CODES,
    });
  });

  it('announces moves by column name and explains the keys, instead of using dnd-kit’s id-reading defaults', async () => {
    await mount();

    expect(dnd.accessibility?.announcements).toBe(BOARD_ANNOUNCEMENTS);
    expect(dnd.accessibility?.screenReaderInstructions).toBe(BOARD_SCREEN_READER_INSTRUCTIONS);
  });

  it('puts the drag activator on the card itself, so focus and the pick-up key are the same element', async () => {
    const root = await mount();

    const cards = [...root.querySelectorAll('[aria-roledescription="draggable"]')];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.tagName).toBe('ARTICLE');
      expect(card.getAttribute('tabindex')).toBe('0');
      // A wrapper that also took a tab stop would make every card cost two
      // tabs and nest one button role inside another.
      expect(card.querySelector('[tabindex]')).toBeNull();
      expect(card.parentElement?.hasAttribute('tabindex')).toBe(false);
    }
  });

  it('picks a card up on space rather than opening it', async () => {
    const onSelect = vi.fn();
    const root = await mount({ onSelect });

    press(card(root, 'safe-1'), { key: ' ', code: 'Space' });

    expect(dnd.activated).toEqual(['safe-1']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('puts the card back and clears the overlay when a move is cancelled', async () => {
    const root = await mount();

    await act(async () => dnd.onDragStart?.({ active: { id: 'safe-1' } }));
    // The overlay renders a second, non-draggable copy of the picked-up card.
    // It is deliberately nameless — see the presentational test below — so the
    // ghost is counted by what identifies it instead: it is the hidden one.
    expect(root.querySelectorAll('article[aria-hidden="true"]').length).toBe(1);

    expect(dnd.onDragCancel).toBeDefined();
    await act(async () => dnd.onDragCancel?.());

    expect(root.querySelectorAll('article[aria-hidden="true"]').length).toBe(0);
    // The two real copies — narrow layout and wide — are untouched throughout.
    expect(root.querySelectorAll('article[aria-label^="safe-1:"]').length).toBe(2);
    expect(rpc.calls).toEqual([]);
  });

  it('renders the overlay copy as decoration: no name, no role, no tab stop', async () => {
    const root = await mount();

    await act(async () => dnd.onDragStart?.({ active: { id: 'safe-1' } }));

    // The board renders one card per layout (narrow + wide) and that count must
    // not move when a drag starts: a third element answering to the same name
    // is a screen reader reading the same issue twice.
    expect(root.querySelectorAll('[aria-label^="safe-1:"]').length).toBe(2);

    const ghost = root.querySelector('article[aria-hidden="true"]');
    expect(ghost).not.toBeNull();
    expect(ghost?.hasAttribute('tabindex')).toBe(false);
    expect(ghost?.hasAttribute('role')).toBe(false);
    expect(ghost?.hasAttribute('aria-label')).toBe(false);
    // The ghost still *shows* the issue; only its semantics are withdrawn.
    expect(ghost?.textContent).toContain('Auto-applied fix');

    // Nothing focusable may sit inside an aria-hidden subtree.
    expect(ghost?.querySelectorAll('[tabindex]:not([tabindex="-1"]), a[href], button').length).toBe(0);
  });

  it('still opens the issue on enter, which is what enter does on every other card', async () => {
    const onSelect = vi.fn();
    const root = await mount({ onSelect });

    press(card(root, 'safe-1'), { key: 'Enter', code: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('safe-1');
  });
});

/** The first rendered card for a bead. Narrow and wide layouts both render one. */
function card(root: HTMLElement, id: string): Element {
  const found = root.querySelector(`article[aria-label^="${id}:"]`);
  if (!found) throw new Error(`no card rendered for ${id}`);
  return found;
}

function press(element: Element, init: { key: string; code: string }): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}
