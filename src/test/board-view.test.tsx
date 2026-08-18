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
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: { active: { id: string }; over?: { id: string } }) => void) | undefined,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: unknown;
    onDragEnd: (event: { active: { id: string }; over?: { id: string } }) => void;
  }) => {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
  DragOverlay: ({ children }: { children: unknown }) => children,
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  useSensor: () => undefined,
  useSensors: () => [],
  PointerSensor: class {},
}));

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
