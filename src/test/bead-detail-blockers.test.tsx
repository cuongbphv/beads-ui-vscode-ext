// @vitest-environment jsdom

/**
 * The "Why blocked" section of the detail pane.
 *
 * The chain itself is computed by `shared/blocker-chain` (unit-tested in
 * blocker-chain.test.ts); these tests cover the wiring: the section renders
 * the transitive chain for a blocked bead, each row selects its blocker
 * through the same `onSelect` the other link rows use, a cycle is labelled,
 * and the section stays out of the pane when nothing open blocks the bead.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead, BeadDependency } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string) =>
    method === 'showBead'
      ? Promise.resolve({ bead: null, comments: [] })
      : new Promise(() => undefined),
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

vi.mock('../webview/components/toast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

import { BeadDetail } from '../webview/components/bead-detail';

let mountedRoot: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  container?.remove();
  container = undefined;
});

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'done', category: 'done' },
]);

function blocksEdge(from: string, to: string): BeadDependency {
  return { issue_id: from, depends_on_id: to, type: 'blocks' };
}

function bead(id: string, blockers: string[] = [], status = 'open'): Bead {
  return {
    id,
    title: `Title of ${id}`,
    status,
    priority: 2,
    issue_type: 'task',
    dependencies: blockers.map((blocker) => blocksEdge(id, blocker)),
  };
}

async function mount(
  subject: Bead,
  beads: Bead[],
  onSelect = vi.fn(),
): Promise<{ root: HTMLDivElement; onSelect: typeof onSelect }> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () =>
    mountedRoot?.render(
      createElement(BeadDetail, {
        bead: subject,
        beads,
        index,
        onClose: vi.fn(),
        onSelect,
        refreshKey: 0,
      }),
    ),
  );
  // Let the `showBead` fetch inside useBeadDetail settle.
  await act(async () => {
    await Promise.resolve();
  });
  return { root: container, onSelect };
}

function whyBlockedSection(root: HTMLDivElement): HTMLElement | undefined {
  return [...root.querySelectorAll('section')].find((section) =>
    section.querySelector('h3')?.textContent?.includes('Why blocked'),
  );
}

describe('why-blocked section', () => {
  it('renders the transitive chain for a blocked bead', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['c']);
    const c = bead('c');
    const { root } = await mount(a, [a, b, c]);

    const section = whyBlockedSection(root);
    expect(section).toBeDefined();
    expect(section?.textContent).toContain('Title of b');
    expect(section?.textContent).toContain('Title of c');
  });

  it('selects the blocker when its row is clicked', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['c']);
    const c = bead('c');
    const { root, onSelect } = await mount(a, [a, b, c]);

    const section = whyBlockedSection(root);
    const row = [...(section?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes('Title of c'),
    );
    expect(row).toBeDefined();

    await act(async () => row?.click());
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('labels a dependency cycle', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['a']);
    const { root } = await mount(a, [a, b]);

    expect(whyBlockedSection(root)?.textContent).toContain('cycle');
  });

  it('is absent when the only blocker is closed', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', [], 'done');
    const { root } = await mount(a, [a, b]);

    expect(whyBlockedSection(root)).toBeUndefined();
  });

  it('is absent for a bead with no blockers at all', async () => {
    const a = bead('a');
    const { root } = await mount(a, [a]);

    expect(whyBlockedSection(root)).toBeUndefined();
  });
});
