// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Bead } from '../shared/types';
import { COL_W } from '../webview/lib/graph-layout';
import { GraphView } from '../webview/views/GraphView';
import { installPointerCapture, pointerEvent } from './support/dom-harness';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let mountedRoot: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installPointerCapture();
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.replaceChildren();
  container = undefined;
});

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return {
    title: partial.id,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...partial,
  };
}

const linkedBeads: Bead[] = [
  bead({ id: 'a', title: 'Root cause' }),
  bead({
    id: 'b',
    title: 'Blocked follower',
    dependencies: [{ depends_on_id: 'a', type: 'blocks' }],
  }),
  // No dependencies of its own and nothing points at it — stays out of the
  // visible set entirely, per "only render beads with at least one edge".
  bead({ id: 'lonely', title: 'Untouched' }),
];

function props(overrides: Partial<Parameters<typeof GraphView>[0]> = {}): Parameters<typeof GraphView>[0] {
  return {
    beads: linkedBeads,
    onSelect: vi.fn(),
    selectedId: undefined,
    blockedIds: new Set<string>(),
    ...overrides,
  };
}

async function mount(overrides: Partial<Parameters<typeof GraphView>[0]> = {}): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(createElement(GraphView, props(overrides))));
  return container;
}

describe('GraphView', () => {
  it('renders a node for every bead in the visible (edge-bearing) set', async () => {
    const root = await mount();

    expect(root.querySelector('[aria-label^="a:"]')).not.toBeNull();
    expect(root.querySelector('[aria-label^="b:"]')).not.toBeNull();
  });

  it('excludes beads with no edges from the rendered nodes', async () => {
    const root = await mount();

    expect(root.querySelector('[aria-label^="lonely:"]')).toBeNull();
  });

  it('calls onSelect with the bead id when a node is clicked', async () => {
    const onSelect = vi.fn();
    const root = await mount({ onSelect });

    const node = root.querySelector<SVGElement>('[aria-label^="b:"]');
    expect(node).not.toBeNull();
    await act(async () => node?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('calls onSelect with the bead id when Enter is pressed on a focused node', async () => {
    const onSelect = vi.fn();
    const root = await mount({ onSelect });

    const node = root.querySelector<SVGElement>('[aria-label^="a:"]');
    expect(node).not.toBeNull();
    await act(async () =>
      node?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );

    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('shows an empty state when no bead in the board has a dependency edge', async () => {
    const root = await mount({ beads: [bead({ id: 'solo' })] });

    expect(root.textContent).toContain('No dependencies');
    expect(root.querySelector('[role="button"]')).toBeNull();
  });

  it('announces a screen-reader summary of the visible graph', async () => {
    const root = await mount();

    const summary = root.querySelector('p.sr-only');
    expect(summary?.textContent).toMatch(/2 issues?/);
    expect(summary?.textContent).toMatch(/1 dependency link/);
  });

  describe('dragging a node', () => {
    /** `translate(x, y)` off the node group's own `transform` attribute. */
    function transformOf(node: Element): { x: number; y: number } {
      const match = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(node.getAttribute('transform') ?? '');
      if (!match) throw new Error(`no translate() on ${node.outerHTML}`);
      return { x: Number(match[1]), y: Number(match[2]) };
    }

    it('moves the node transform live as the pointer drags past the threshold', async () => {
      const root = await mount();
      const node = root.querySelector<SVGElement>('[aria-label^="b:"]');
      expect(node).not.toBeNull();
      const start = transformOf(node!);

      await act(async () => node?.dispatchEvent(pointerEvent('pointerdown', { clientX: 0 })));
      await act(async () => node?.dispatchEvent(pointerEvent('pointermove', { clientX: 30 })));

      expect(transformOf(node!)).toEqual({ x: start.x + 30, y: start.y });
    });

    it('does not move the node before the drag threshold is crossed', async () => {
      const root = await mount();
      const node = root.querySelector<SVGElement>('[aria-label^="b:"]');
      const start = transformOf(node!);

      await act(async () => node?.dispatchEvent(pointerEvent('pointerdown', { clientX: 0 })));
      await act(async () => node?.dispatchEvent(pointerEvent('pointermove', { clientX: 2 })));

      expect(transformOf(node!)).toEqual(start);
    });

    it('suppresses the click that follows a drag past the threshold', async () => {
      const onSelect = vi.fn();
      const root = await mount({ onSelect });
      const node = root.querySelector<SVGElement>('[aria-label^="b:"]');

      await act(async () => node?.dispatchEvent(pointerEvent('pointerdown', { clientX: 0 })));
      await act(async () => node?.dispatchEvent(pointerEvent('pointermove', { clientX: 30 })));
      await act(async () => node?.dispatchEvent(pointerEvent('pointerup', { clientX: 30 })));
      // The browser fires `click` right after `pointerup` on a real drag.
      await act(async () => node?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(onSelect).not.toHaveBeenCalled();
    });

    it('still selects on a press-and-release that never crosses the threshold', async () => {
      const onSelect = vi.fn();
      const root = await mount({ onSelect });
      const node = root.querySelector<SVGElement>('[aria-label^="b:"]');

      await act(async () => node?.dispatchEvent(pointerEvent('pointerdown', { clientX: 0 })));
      await act(async () => node?.dispatchEvent(pointerEvent('pointerup', { clientX: 1 })));
      await act(async () => node?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(onSelect).toHaveBeenCalledWith('b');
    });

    it('drops the in-progress drag when the browser takes the capture away', async () => {
      const root = await mount();
      const node = root.querySelector<SVGElement>('[aria-label^="b:"]');
      const start = transformOf(node!);

      await act(async () => node?.dispatchEvent(pointerEvent('pointerdown', { clientX: 0 })));
      await act(async () => node?.dispatchEvent(pointerEvent('pointermove', { clientX: 30 })));
      expect(transformOf(node!)).toEqual({ x: start.x + 30, y: start.y });

      await act(async () => node?.dispatchEvent(pointerEvent('lostpointercapture')));
      await act(async () => node?.dispatchEvent(pointerEvent('pointermove', { clientX: 60 })));

      // The move after capture is lost must not keep dragging the node.
      expect(transformOf(node!)).toEqual({ x: start.x + 30, y: start.y });
    });
  });

  describe('keyboard nudge', () => {
    function transformOf(node: Element): { x: number; y: number } {
      const match = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(node.getAttribute('transform') ?? '');
      if (!match) throw new Error(`no translate() on ${node.outerHTML}`);
      return { x: Number(match[1]), y: Number(match[2]) };
    }

    it('nudges a focused node 8px per arrow key press', async () => {
      const root = await mount();
      const node = root.querySelector<SVGElement>('[aria-label^="b:"]');
      const start = transformOf(node!);

      await act(async () =>
        node?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
      );

      expect(transformOf(node!)).toEqual({ x: start.x + 8, y: start.y });
    });

    it('jumps a full grid cell with Shift+arrow', async () => {
      const root = await mount();
      const node = root.querySelector<SVGElement>('[aria-label^="b:"]');
      const start = transformOf(node!);

      await act(async () =>
        node?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
        ),
      );

      expect(transformOf(node!)).toEqual({ x: start.x + COL_W, y: start.y });
    });

    it('still selects on Enter/Space after adding the arrow-key handling', async () => {
      const onSelect = vi.fn();
      const root = await mount({ onSelect });
      const node = root.querySelector<SVGElement>('[aria-label^="a:"]');

      await act(async () =>
        node?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })),
      );

      expect(onSelect).toHaveBeenCalledWith('a');
    });
  });

  describe('reset layout', () => {
    it('starts disabled with nothing dragged', async () => {
      const root = await mount();
      const resetButton = root.querySelector<HTMLButtonElement>('button[title="Reset layout"]');
      expect(resetButton).not.toBeNull();
      expect(resetButton?.disabled).toBe(true);
    });

    it('enables once a node has been moved and restores its original position on click', async () => {
      const root = await mount();
      const node = root.querySelector<SVGElement>('[aria-label^="b:"]');
      const transformOf = (): { x: number; y: number } => {
        const match = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(node!.getAttribute('transform') ?? '');
        return { x: Number(match?.[1]), y: Number(match?.[2]) };
      };
      const before = transformOf();

      await act(async () =>
        node?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
      );
      expect(transformOf()).toEqual({ x: before.x + 8, y: before.y });

      const resetButton = root.querySelector<HTMLButtonElement>('button[title="Reset layout"]');
      expect(resetButton?.disabled).toBe(false);

      await act(async () => resetButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(transformOf()).toEqual(before);
      expect(root.querySelector<HTMLButtonElement>('button[title="Reset layout"]')?.disabled).toBe(
        true,
      );
    });
  });
});
