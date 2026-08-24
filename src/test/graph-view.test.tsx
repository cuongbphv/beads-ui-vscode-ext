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

interface AddDependencyCall {
  id: string;
  dependsOn: string;
  type?: string;
}

const rpc = vi.hoisted(() => ({
  addDependencyCalls: new Array<AddDependencyCall>(),
  /** Resolves immediately unless a test overrides this with a rejecting promise. */
  addDependencyResult: (): Promise<{ ok: true }> => Promise.resolve({ ok: true }),
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    if (method === 'addDependency') {
      rpc.addDependencyCalls.push(params as AddDependencyCall);
      return rpc.addDependencyResult();
    }
    return Promise.resolve({});
  },
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

interface Notified {
  text: string;
  tone: string;
}

const toast = vi.hoisted(() => ({ messages: new Array<Notified>() }));

vi.mock('../webview/components/toast', () => ({
  useToast: () => ({
    notify: (text: string, tone = 'info') => {
      toast.messages.push({ text, tone });
    },
  }),
}));

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
  rpc.addDependencyCalls.length = 0;
  rpc.addDependencyResult = () => Promise.resolve({ ok: true });
  toast.messages.length = 0;
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

  describe('link mode', () => {
    async function arm(root: HTMLDivElement): Promise<void> {
      const linkButton = root.querySelector<HTMLButtonElement>('button[title="Link two issues"]');
      await act(async () => linkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }

    function kindButton(root: HTMLDivElement, kind: string): HTMLButtonElement | undefined {
      const dialog = root.querySelector('[role="dialog"]');
      return Array.from(dialog?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent === kind,
      );
    }

    it('toggles armed state via the Link toolbar button', async () => {
      const root = await mount();
      const linkButton = root.querySelector<HTMLButtonElement>('button[title="Link two issues"]');
      expect(linkButton?.getAttribute('aria-pressed')).toBe('false');

      await arm(root);

      const armedButton = root.querySelector<HTMLButtonElement>('button[title="Cancel linking issues"]');
      expect(armedButton?.getAttribute('aria-pressed')).toBe('true');
    });

    it('renders a ring highlight on the first node clicked as the link source', async () => {
      const root = await mount();
      await arm(root);

      const nodeA = root.querySelector<SVGElement>('[aria-label^="a:"]');
      await act(async () => nodeA?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(nodeA?.getAttribute('aria-label')).toContain('(link source)');
      expect(nodeA?.querySelector('rect[stroke="var(--color-accent)"]')).not.toBeNull();
    });

    it('calls addDependency with the source, target, and chosen kind on a source-then-target click sequence', async () => {
      const root = await mount();
      await arm(root);

      const nodeA = root.querySelector<SVGElement>('[aria-label^="a:"]');
      const nodeB = root.querySelector<SVGElement>('[aria-label^="b:"]');
      await act(async () => nodeA?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => nodeB?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      const blocksButton = kindButton(root, 'blocks');
      expect(blocksButton).not.toBeUndefined();

      await act(async () => blocksButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(rpc.addDependencyCalls).toEqual([{ id: 'a', dependsOn: 'b', type: 'blocks' }]);
    });

    it('disarms on Escape, clearing the source selection and closing an open popover', async () => {
      const root = await mount();
      await arm(root);

      const nodeA = root.querySelector<SVGElement>('[aria-label^="a:"]');
      const nodeB = root.querySelector<SVGElement>('[aria-label^="b:"]');
      await act(async () => nodeA?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => nodeB?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(root.querySelector('[role="dialog"]')).not.toBeNull();

      await act(async () =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      );

      expect(root.querySelector('[role="dialog"]')).toBeNull();
      expect(root.querySelector('[aria-label^="a:"]')?.getAttribute('aria-label')).not.toContain(
        '(link source)',
      );
      expect(root.querySelector('button[title="Link two issues"]')).not.toBeNull();
      expect(rpc.addDependencyCalls).toHaveLength(0);
    });

    it('does not select the bead in the detail pane while armed', async () => {
      const onSelect = vi.fn();
      const root = await mount({ onSelect });
      await arm(root);

      const nodeA = root.querySelector<SVGElement>('[aria-label^="a:"]');
      await act(async () => nodeA?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(onSelect).not.toHaveBeenCalled();
    });

    it('renders a cycle-rejection RpcError as a toast, the same path every other mutating RPC uses', async () => {
      rpc.addDependencyResult = () => Promise.reject(new Error('would create a cycle'));
      const root = await mount();
      await arm(root);

      const nodeA = root.querySelector<SVGElement>('[aria-label^="a:"]');
      const nodeB = root.querySelector<SVGElement>('[aria-label^="b:"]');
      await act(async () => nodeA?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => nodeB?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      const blocksButton = kindButton(root, 'blocks');
      await act(async () => blocksButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(toast.messages).toEqual([{ text: 'Error: would create a cycle', tone: 'error' }]);
      // The popover closes regardless of outcome, per the "always closes" contract.
      expect(root.querySelector('[role="dialog"]')).toBeNull();
    });
  });
});
