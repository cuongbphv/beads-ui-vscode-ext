// @vitest-environment jsdom

/**
 * The create-issue form (`BeadCreate`).
 *
 * Covers the vocabulary-driven selects, the exact params shape sent to
 * `createBead`, the empty-title disabled state, a successful create
 * selecting the new id, and a failed create leaving the form populated.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Bead, DashboardSnapshot } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface PendingCall {
  method: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const rpc = vi.hoisted(() => ({ calls: [] as PendingCall[] }));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      rpc.calls.push({ method, params, resolve, reject });
    }),
  asRpcError: (error: unknown) =>
    error && typeof error === 'object' && 'kind' in error
      ? error
      : { kind: 'unknown', message: String(error) },
}));

const toastState = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../webview/components/toast', () => ({
  useToast: () => ({ notify: toastState.notify }),
}));

import { BeadCreate } from '../webview/components/bead-create';

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
  toastState.notify.mockClear();
});

const snapshot: DashboardSnapshot = {
  context: { bd_version: 'test', beads_dir: '.beads', repo_root: '/repo' },
  vocabulary: {
    statuses: [{ name: 'open', category: 'active' }],
    types: [{ name: 'task' }, { name: 'bug' }],
  },
  stats: {
    total_issues: 2,
    open_issues: 2,
    in_progress_issues: 0,
    blocked_issues: 0,
    closed_issues: 0,
    deferred_issues: 0,
    pinned_issues: 0,
    ready_issues: 2,
  },
  beads: [],
  readyIds: [],
  blockedIds: [],
  gates: [],
  truncated: false,
  fetchedAt: '2026-08-24T00:00:00.000Z',
};

const epic: Bead = {
  id: 'epic-1',
  title: 'Editing suite',
  status: 'open',
  priority: 2,
  issue_type: 'epic',
};

const task: Bead = {
  id: 'task-1',
  title: 'Existing task',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  labels: ['frontend', 'urgent'],
};

async function mount(
  beads: Bead[] = [epic, task],
  onSelect = vi.fn(),
  onCancel = vi.fn(),
): Promise<{ root: HTMLDivElement; onSelect: typeof onSelect; onCancel: typeof onCancel }> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () =>
    mountedRoot?.render(
      createElement(BeadCreate, { snapshot, beads, onCancel, onSelect }),
    ),
  );
  return { root: container, onSelect, onCancel };
}

function titleInput(root: HTMLDivElement): HTMLInputElement {
  const el = [...root.querySelectorAll('input')].find(
    (input) => input.placeholder === 'Issue title',
  );
  if (!(el instanceof HTMLInputElement)) throw new Error('title input not found');
  return el;
}

function createButton(root: HTMLDivElement): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find(
    (b) => b.textContent === 'Create issue',
  );
  if (!button) throw new Error('Create issue button not found');
  return button;
}

function selectByLabel(root: HTMLDivElement, label: string): HTMLSelectElement {
  const labelEl = [...root.querySelectorAll('label')].find(
    (l) => l.querySelector('span')?.textContent === label,
  );
  const select = labelEl?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) throw new Error(`select "${label}" not found`);
  return select;
}

/**
 * React tracks a controlled input's value through the instance property it
 * installs over the native prototype setter, so assigning `.value` directly
 * leaves React's tracker thinking nothing changed. Going through the
 * prototype setter first is what makes the change visible to `onChange`.
 */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function selectOption(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('BeadCreate', () => {
  it('renders vocabulary-driven type and priority selects', async () => {
    const { root } = await mount();

    const typeSelect = selectByLabel(root, 'Type');
    const prioritySelect = selectByLabel(root, 'Priority');

    expect([...typeSelect.options].map((option) => option.value)).toEqual(['task', 'bug']);
    expect([...prioritySelect.options].map((option) => option.textContent)).toEqual([
      'P0 · Critical',
      'P1 · High',
      'P2 · Normal',
      'P3 · Low',
      'P4 · Trivial',
    ]);
  });

  it('filters the parent picker to epics only', async () => {
    const { root } = await mount();

    const parentSelect = selectByLabel(root, 'Parent epic');
    const values = [...parentSelect.options].map((option) => option.value);

    expect(values).toContain('epic-1');
    expect(values).not.toContain('task-1');
  });

  it('builds the labels datalist from labels already present across loaded beads', async () => {
    const { root } = await mount();

    const options = [...root.querySelectorAll('datalist option')].map(
      (option) => option.getAttribute('value'),
    );
    expect(options).toEqual(['frontend', 'urgent']);
  });

  it('disables the submit button while the title is empty', async () => {
    const { root } = await mount();

    expect(createButton(root).disabled).toBe(true);

    await act(async () => typeInto(titleInput(root), 'A new issue'));
    expect(createButton(root).disabled).toBe(false);
  });

  it('sends the exact params object to createBead on submit', async () => {
    const { root } = await mount();

    await act(async () => typeInto(titleInput(root), '  Ship the thing  '));
    await act(async () => selectOption(selectByLabel(root, 'Type'), 'bug'));
    await act(async () => createButton(root).click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('createBead');
    expect(rpc.calls[0].params).toEqual({
      title: 'Ship the thing',
      type: 'bug',
      priority: '2',
    });
  });

  it('calls onSelect with the new id on a successful create', async () => {
    const { root, onSelect } = await mount();

    await act(async () => typeInto(titleInput(root), 'New issue'));
    await act(async () => createButton(root).click());

    await act(async () => {
      rpc.calls[0].resolve({ id: 'new-42' });
      await Promise.resolve();
    });

    expect(onSelect).toHaveBeenCalledWith('new-42');
  });

  it('shows a toast and keeps the form populated when createBead rejects', async () => {
    const { root, onSelect } = await mount();

    await act(async () => typeInto(titleInput(root), 'Will fail'));
    await act(async () => createButton(root).click());

    await act(async () => {
      rpc.calls[0].reject({ kind: 'bd-error', message: 'bd refused' });
      await Promise.resolve();
    });

    expect(toastState.notify).toHaveBeenCalledWith('bd refused', 'error');
    expect(onSelect).not.toHaveBeenCalled();
    expect(titleInput(root).value).toBe('Will fail');
  });
});
