// @vitest-environment jsdom

/**
 * Defer / Undefer / Reopen quick actions in the detail pane (bead li0.8).
 *
 * Reopen is toggled on `index.isDone(bead.status)` (the runtime status
 * vocabulary, never a hardcoded status name); Defer/Undefer toggle on
 * `bead.defer_until` being set, independent of `done`. Same mount/typeInto
 * scaffolding as `bead-detail-labels.test.tsx` — see that file for why
 * `showBead` resolves with `null` and every other RPC call is queued instead
 * of resolved immediately.
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
    title: 'Defer/reopen quick actions',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  };
}

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount(subject: Bead, onClose: () => void = vi.fn()): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () =>
    mountedRoot?.render(
      createElement(BeadDetail, {
        bead: subject,
        beads: [subject],
        index,
        onClose,
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

describe('Reopen quick action', () => {
  it('is hidden while the issue is open (not done)', async () => {
    const root = await mount(bead({ status: 'open' }));
    expect(button(root, 'Reopen')).toBeNull();
  });

  it('is shown once the issue is done, and calls reopenBead with just the id', async () => {
    const root = await mount(bead({ status: 'done' }));
    const reopen = button(root, 'Reopen');
    expect(reopen).not.toBeNull();

    await act(async () => reopen?.click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('reopenBead');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1' });
  });

  it('is driven by the runtime status vocabulary (isDone), not a hardcoded status string', async () => {
    // A custom "done"-category status this codebase never hardcodes by name.
    const customIndex = new StatusIndex([
      { name: 'open', category: 'active' },
      { name: 'shipped', category: 'done' },
    ]);
    container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);
    const subject = bead({ status: 'shipped' });
    await act(async () =>
      mountedRoot?.render(
        createElement(BeadDetail, {
          bead: subject,
          beads: [subject],
          index: customIndex,
          onClose: vi.fn(),
          onSelect: vi.fn(),
          refreshKey: 0,
        }),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(button(container, 'Reopen')).not.toBeNull();
  });

  it('does not show the "Close issue" action once the issue is done', async () => {
    const root = await mount(bead({ status: 'done' }));
    expect(button(root, 'Close issue')).toBeNull();
  });
});

describe('Defer / Undefer quick actions', () => {
  it('shows "Defer…" and no Undefer button when the issue is not deferred', async () => {
    const root = await mount(bead({ defer_until: undefined }));
    expect(button(root, 'Defer…')).not.toBeNull();
    expect(button(root, 'Undefer')).toBeNull();
  });

  it('shows Undefer and no "Defer…" button when the issue is deferred, and calls undeferBead with just the id', async () => {
    const root = await mount(bead({ defer_until: '2026-09-01T00:00:00Z' }));
    expect(button(root, 'Defer…')).toBeNull();
    const undefer = button(root, 'Undefer');
    expect(undefer).not.toBeNull();

    await act(async () => undefer?.click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('undeferBead');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1' });
  });

  it('opens a composer on "Defer…" and calls deferBead with the trimmed until/reason', async () => {
    const root = await mount(bead());
    await act(async () => button(root, 'Defer…')?.click());

    const untilInput = root.querySelector<HTMLInputElement>('#defer-until');
    const reasonInput = root.querySelector<HTMLInputElement>('#defer-reason');
    if (!untilInput || !reasonInput) throw new Error('defer composer inputs not found');

    await act(async () => typeInto(untilInput, '  tomorrow  '));
    await act(async () => typeInto(reasonInput, '  waiting on API access  '));
    await act(async () => button(root, 'Defer')?.click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('deferBead');
    expect(rpc.calls[0].params).toEqual({
      id: 'bd-1',
      until: 'tomorrow',
      reason: 'waiting on API access',
    });
  });

  it('sends until/reason as undefined, not empty strings, when both are left blank', async () => {
    const root = await mount(bead());
    await act(async () => button(root, 'Defer…')?.click());
    await act(async () => button(root, 'Defer')?.click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', until: undefined, reason: undefined });
  });

  it('Escape cancels the composer without closing the pane', async () => {
    const onClose = vi.fn();
    const root = await mount(bead(), onClose);
    await act(async () => button(root, 'Defer…')?.click());

    const untilInput = root.querySelector<HTMLInputElement>('#defer-until');
    if (!untilInput) throw new Error('defer-until input not found');
    await act(async () => typeInto(untilInput, 'tomorrow'));

    await act(async () => {
      untilInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(root.querySelector('#defer-until')).toBeNull();
    expect(button(root, 'Defer…')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(rpc.calls).toEqual([]);
  });

  it('a failed deferBead reports an error toast and leaves the composer open for a retry', async () => {
    const root = await mount(bead());
    await act(async () => button(root, 'Defer…')?.click());
    await act(async () => button(root, 'Defer')?.click());

    await act(async () => {
      rpc.calls[0].reject({ kind: 'bd-error', message: 'bd refused: bad --until value' });
      await Promise.resolve();
    });

    expect(toast.notify).toHaveBeenCalledWith('bd refused: bad --until value', 'error');
    // Unlike a successful defer, a failed one does not fold the composer back
    // up — the draft survives so the user can fix and resubmit.
    expect(root.querySelector('#defer-until')).not.toBeNull();
  });
});
