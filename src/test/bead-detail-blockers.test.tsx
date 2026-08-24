// @vitest-environment jsdom

/**
 * The "Blocked by" section of the detail pane (bead 72m.5).
 *
 * The chain itself is computed by `shared/blocker-chain` (unit-tested in
 * blocker-chain.test.ts); these tests cover the wiring: the section merges
 * the transitive chain with any `blocked_by` id the chain does not already
 * cover, depth-1 rows carry a × (removal) that deeper rows never get, a
 * cycle is labelled, the section is hidden once the bead is done, and it
 * stays out of the pane entirely when nothing open blocks the bead.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead, BeadDependency } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface PendingCall {
  method: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const rpc = vi.hoisted(() => ({
  calls: [] as PendingCall[],
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: Record<string, unknown>) => {
    if (method === 'showBead') {
      return Promise.resolve({ bead: null, comments: [] });
    }
    return new Promise((resolve, reject) => {
      rpc.calls.push({ method, params, resolve, reject });
    });
  },
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
  rpc.calls.length = 0;
});

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'done', category: 'done' },
]);

function blocksEdge(from: string, to: string): BeadDependency {
  return { issue_id: from, depends_on_id: to, type: 'blocks' };
}

function bead(
  id: string,
  blockers: string[] = [],
  status = 'open',
  blockedBy?: string[],
): Bead {
  return {
    id,
    title: `Title of ${id}`,
    status,
    priority: 2,
    issue_type: 'task',
    dependencies: blockers.map((blocker) => blocksEdge(id, blocker)),
    blocked_by: blockedBy,
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

function blockedBySection(root: HTMLDivElement): HTMLElement | undefined {
  return [...root.querySelectorAll('section')].find(
    (section) => section.querySelector('h3')?.textContent?.trim() === 'Blocked by',
  );
}

function rowFor(section: HTMLElement | undefined, title: string): HTMLLIElement | undefined {
  return [...(section?.querySelectorAll('li') ?? [])].find((li) =>
    li.textContent?.includes(title),
  ) as HTMLLIElement | undefined;
}

describe('Blocked by section', () => {
  it('renders a direct-only blocker with no transitive rows', async () => {
    const a = bead('a', ['b']);
    const b = bead('b');
    const { root } = await mount(a, [a, b]);

    const section = blockedBySection(root);
    expect(section).toBeDefined();
    expect(section?.textContent).toContain('Title of b');
    expect(section?.querySelectorAll('li')).toHaveLength(1);
  });

  it('renders the full transitive chain, with deeper rows indented past direct ones', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['c']);
    const c = bead('c');
    const { root } = await mount(a, [a, b, c]);

    const section = blockedBySection(root);
    expect(section?.textContent).toContain('Title of b');
    expect(section?.textContent).toContain('Title of c');

    const rowB = rowFor(section, 'Title of b');
    const rowC = rowFor(section, 'Title of c');
    const depthOf = (row?: HTMLLIElement): number => parseFloat(row?.style.paddingLeft || '0');
    expect(depthOf(rowB)).toBe(0);
    expect(depthOf(rowC)).toBeGreaterThan(depthOf(rowB));
  });

  it('selects the blocker when its row is clicked', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['c']);
    const c = bead('c');
    const { root, onSelect } = await mount(a, [a, b, c]);

    const section = blockedBySection(root);
    const row = [...(section?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes('Title of c'),
    );
    expect(row).toBeDefined();

    await act(async () => row?.click());
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('still flags a dependency cycle', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['a']);
    const { root } = await mount(a, [a, b]);

    expect(blockedBySection(root)?.textContent).toContain('cycle');
  });

  it('offers removal only on the direct (depth-1) row, not on deeper transitive rows', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['c']);
    const c = bead('c');
    const { root } = await mount(a, [a, b, c]);

    const section = blockedBySection(root);
    expect(
      section?.querySelector('button[aria-label="Remove link to b"]'),
    ).not.toBeNull();
    expect(
      section?.querySelector('button[aria-label="Remove link to c"]'),
    ).toBeNull();
  });

  it('removing the direct blocker calls removeDependency with this bead and that id', async () => {
    const a = bead('a', ['b']);
    const b = bead('b');
    const { root } = await mount(a, [a, b]);

    const section = blockedBySection(root);
    const removeButton = section?.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove link to b"]',
    );
    if (!removeButton) throw new Error('remove button not found');

    await act(async () => removeButton.click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('removeDependency');
    expect(rpc.calls[0].params).toEqual({ id: 'a', dependsOn: 'b' });
  });

  it('still shows a blocked_by id the blocks-edge chain does not cover, as a depth-1 row', async () => {
    // `a` has a `blocks`-edge chain to `b`, but `blocked_by` also names `x`
    // — a second bd data source for the same relationship — and `x` is not
    // in the loaded set at all. It must not be dropped by the merge.
    const a = bead('a', ['b'], 'open', ['b', 'x']);
    const b = bead('b');
    const { root } = await mount(a, [a, b]);

    const section = blockedBySection(root);
    expect(section?.textContent).toContain('Title of b');
    expect(section?.textContent).toContain('x');
    // `x` is not loaded, so it is still a removable depth-1 row.
    expect(section?.querySelector('button[aria-label="Remove link to x"]')).not.toBeNull();
    // No duplicate row for `b`, which the chain already covers.
    expect(section?.querySelectorAll('li')).toHaveLength(2);
  });

  it('is absent when the only blocker is closed', async () => {
    const a = bead('a', ['b']);
    const b = bead('b', [], 'done');
    const { root } = await mount(a, [a, b]);

    expect(blockedBySection(root)).toBeUndefined();
  });

  it('is absent for a bead with no blockers at all', async () => {
    const a = bead('a');
    const { root } = await mount(a, [a]);

    expect(blockedBySection(root)).toBeUndefined();
  });

  it('is absent entirely once the bead is done, even with blockers on record', async () => {
    const a = bead('a', ['b'], 'done', ['b']);
    const b = bead('b');
    const { root } = await mount(a, [a, b]);

    expect(blockedBySection(root)).toBeUndefined();
  });
});
