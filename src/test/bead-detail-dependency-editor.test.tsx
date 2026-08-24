// @vitest-environment jsdom

/**
 * Detail-pane dependency editor (bead li0.10): the "Add link" control (kind
 * select + `IssuePicker`) calls `addDependency`, optimistically shows the new
 * edge, and rolls back with a toast on RPC error — including the cycle
 * rejection bd itself surfaces as an ordinary `RpcError`. The per-row × on
 * `EdgeList` / "Blocked by" rows calls `removeDependency`. A self-edge is
 * rejected client-side: the picker never offers the issue's own id, so no
 * RPC is ever sent for one.
 *
 * Same mount/typeInto scaffolding as `bead-detail-labels.test.tsx` — see that
 * file for why `showBead` resolves with `null` and every other RPC call is
 * queued instead of resolved immediately.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead } from '../shared/types';

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
  asRpcError: (error: unknown) =>
    error && typeof error === 'object' && 'kind' in error
      ? error
      : { kind: 'unknown', message: String(error) },
}));

const toast = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('../webview/components/toast', () => ({
  useToast: () => toast,
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
  toast.notify.mockClear();
});

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'done', category: 'done' },
]);

function bead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: 'bd-1',
    title: 'Dependency editor',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  };
}

async function mount(subject: Bead, beads: Bead[] = [subject]): Promise<HTMLDivElement> {
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
        onSelect: vi.fn(),
        refreshKey: 0,
      }),
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function button(root: HTMLDivElement, text: string): HTMLButtonElement | null {
  return [...root.querySelectorAll('button')].find((el) => el.textContent?.trim() === text) ?? null;
}

/** Opens the "Add link" popover and returns its search input. */
async function openAddLink(root: HTMLDivElement): Promise<HTMLInputElement> {
  const trigger = button(root, 'Add link');
  if (!trigger) throw new Error('Add link trigger not found');
  await act(async () => trigger.click());
  const input = root.querySelector<HTMLInputElement>('input[aria-label="Search issues"]');
  if (!input) throw new Error('search input not found');
  return input;
}

function optionButtons(root: HTMLDivElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('li[role="option"] button')];
}

function edgeRowLabels(root: HTMLDivElement, sectionTitle: string): string[] {
  const heading = [...root.querySelectorAll('h3')].find(
    (el) => el.textContent?.trim() === sectionTitle,
  );
  const section = heading?.closest('section');
  if (!section) return [];
  return [...section.querySelectorAll('li')].map((li) => li.textContent?.trim() ?? '');
}

describe('Add-link control', () => {
  it('opens on "Add link" and lists other loaded issues as pickable options', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const root = await mount(bead(), [bead(), other]);
    await openAddLink(root);

    const labels = optionButtons(root).map((el) => el.textContent?.trim());
    expect(labels).toContain('bd-2Target issue');
  });

  it('defaults the kind select to "blocks" and shows blocks/related/discovered-from before "More kinds…"', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const root = await mount(bead(), [bead(), other]);
    await openAddLink(root);

    const kindSelect = [...root.querySelectorAll('select')].find((el) =>
      [...el.options].some((option) => option.value === 'blocks'),
    );
    expect(kindSelect?.value).toBe('blocks');
    const optionValues = kindSelect ? [...kindSelect.options].map((option) => option.value) : [];
    expect(optionValues).toEqual(['blocks', 'related', 'discovered-from']);
  });

  it('"More kinds…" reveals the rest of the allowlist, reusing DEP_TYPES rather than a new hardcoded list', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const root = await mount(bead(), [bead(), other]);
    await openAddLink(root);

    const moreButton = button(root, 'More kinds…');
    expect(moreButton).not.toBeNull();
    await act(async () => moreButton?.click());

    const kindSelect = [...root.querySelectorAll('select')].find((el) =>
      [...el.options].some((option) => option.value === 'blocks'),
    );
    const optionValues = kindSelect ? [...kindSelect.options].map((option) => option.value) : [];
    expect(optionValues).toEqual([
      'blocks',
      'tracks',
      'related',
      'parent-child',
      'discovered-from',
      'until',
      'caused-by',
      'validates',
      'relates-to',
      'supersedes',
    ]);
  });

  it('picking an issue applies the edge optimistically and calls addDependency with the selected kind', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const root = await mount(bead(), [bead(), other]);
    await openAddLink(root);

    const kindSelect = [...root.querySelectorAll('select')].find((el) =>
      [...el.options].some((option) => option.value === 'blocks'),
    );
    if (!kindSelect) throw new Error('kind select not found');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(kindSelect, 'related');
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const option = optionButtons(root).find((el) => el.textContent?.trim() === 'bd-2Target issue');
    if (!option) throw new Error('option not found');
    await act(async () => option.click());

    // Shows up immediately, ahead of the RPC resolving.
    expect(edgeRowLabels(root, 'Related')).toEqual(['taskbd-2Target issue']);
    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('addDependency');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', dependsOn: 'bd-2', type: 'related' });

    // The popover closes once a pick is made.
    expect(root.querySelector('input[aria-label="Search issues"]')).toBeNull();
  });

  it('a failed addDependency rolls the optimistic edge back and shows the RpcError message as a toast', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const root = await mount(bead(), [bead(), other]);
    await openAddLink(root);
    const option = optionButtons(root).find((el) => el.textContent?.trim() === 'bd-2Target issue');
    if (!option) throw new Error('option not found');
    await act(async () => option.click());

    expect(edgeRowLabels(root, 'Depends on')).toEqual(['taskbd-2Target issue']);

    await act(async () => {
      rpc.calls[0].reject({ kind: 'bd-error', message: 'bd refused: would create a dependency cycle' });
      await Promise.resolve();
    });

    // Rolled back — the edge is gone again.
    expect(edgeRowLabels(root, 'Depends on')).toEqual([]);
    expect(toast.notify).toHaveBeenCalledWith(
      'bd refused: would create a dependency cycle',
      'error',
    );
  });

  it('never offers the issue itself as a pickable target, so a self-edge is never sent to the RPC', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const subject = bead();
    const root = await mount(subject, [subject, other]);
    const input = await openAddLink(root);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'bd-1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The subject's own id/title never appears as an option.
    expect(optionButtons(root).map((el) => el.textContent?.trim())).toEqual([]);
    expect(root.textContent).toContain('No matching issues.');

    // Even if Enter is pressed with nothing highlighted, no RPC is sent.
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(rpc.calls).toEqual([]);
  });

  it('does not offer an id already linked by any edge kind, since bd allows only one edge per pair', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const subject = bead({ dependencies: [{ depends_on_id: 'bd-2', type: 'blocks' }] });
    const root = await mount(subject, [subject, other]);
    await openAddLink(root);

    expect(optionButtons(root).map((el) => el.textContent?.trim())).toEqual([]);
  });
});

describe('Removing a dependency edge', () => {
  it('shows a × on each Depends-on row that calls removeDependency and removes the row optimistically', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const subject = bead({ dependencies: [{ depends_on_id: 'bd-2', type: 'blocks' }] });
    const root = await mount(subject, [subject, other]);

    expect(edgeRowLabels(root, 'Depends on')).toEqual(['taskbd-2Target issue']);
    const removeButton = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove link to bd-2"]',
    );
    if (!removeButton) throw new Error('remove button not found');

    await act(async () => removeButton.click());

    expect(edgeRowLabels(root, 'Depends on')).toEqual([]);
    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('removeDependency');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', dependsOn: 'bd-2' });
  });

  it('a failed removeDependency rolls the row back and shows an error toast', async () => {
    const other = bead({ id: 'bd-2', title: 'Target issue' });
    const subject = bead({ dependencies: [{ depends_on_id: 'bd-2', type: 'blocks' }] });
    const root = await mount(subject, [subject, other]);
    const removeButton = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove link to bd-2"]',
    );
    if (!removeButton) throw new Error('remove button not found');

    await act(async () => removeButton.click());
    expect(edgeRowLabels(root, 'Depends on')).toEqual([]);

    await act(async () => {
      rpc.calls[0].reject({ kind: 'bd-error', message: 'bd refused the write' });
      await Promise.resolve();
    });

    expect(edgeRowLabels(root, 'Depends on')).toEqual(['taskbd-2Target issue']);
    expect(toast.notify).toHaveBeenCalledWith('bd refused the write', 'error');
  });

  it('shows a × on "Blocked by" rows too, calling removeDependency the same way', async () => {
    const other = bead({ id: 'bd-2', title: 'Blocker issue' });
    const subject = bead({ blocked_by: ['bd-2'] });
    const root = await mount(subject, [subject, other]);

    expect(edgeRowLabels(root, 'Blocked by')).toEqual(['taskbd-2Blocker issue']);
    const removeButton = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove link to bd-2"]',
    );
    if (!removeButton) throw new Error('remove button not found');

    await act(async () => removeButton.click());

    expect(edgeRowLabels(root, 'Blocked by')).toEqual([]);
    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('removeDependency');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', dependsOn: 'bd-2' });
  });
});
