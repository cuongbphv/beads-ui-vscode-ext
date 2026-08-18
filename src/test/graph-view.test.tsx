// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Bead } from '../shared/types';
import { GraphView } from '../webview/views/GraphView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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
});
