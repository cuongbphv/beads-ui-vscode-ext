// @vitest-environment jsdom

/**
 * Label chips in the detail pane (bead li0.7): add/remove applies
 * optimistically, rolls back with a toast on error, and the datalist is
 * derived from labels already present across `beads` rather than hardcoded.
 *
 * Same mount/typeInto scaffolding as `bead-detail-edit.test.tsx` — see that
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
let rerender: ((subject: Bead, beads: Bead[]) => Promise<void>) | undefined;

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
  rerender = undefined;
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
    title: 'Label chips',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  };
}

/** Same value-setter trick `bead-detail-edit.test.tsx` uses for a controlled input. */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount(subject: Bead, beads: Bead[] = [subject]): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  rerender = (nextSubject: Bead, nextBeads: Bead[]) =>
    act(async () =>
      mountedRoot?.render(
        createElement(BeadDetail, {
          bead: nextSubject,
          beads: nextBeads,
          index,
          onClose: vi.fn(),
          onSelect: vi.fn(),
          refreshKey: 0,
        }),
      ),
    );
  await rerender(subject, beads);
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function labelChips(root: HTMLDivElement): string[] {
  return [...root.querySelectorAll('.label-chip')].map((chip) => chip.textContent?.trim() ?? '');
}

describe('label chips (add/remove, optimistic)', () => {
  it('renders each existing label as a chip with a remove button', async () => {
    const root = await mount(bead({ labels: ['ui', 'backend'] }));

    expect(labelChips(root)).toEqual(['ui', 'backend']);
    expect(root.querySelector('button[aria-label="Remove label ui"]')).not.toBeNull();
  });

  it('adding a label applies immediately (before addLabel resolves)', async () => {
    const root = await mount(bead({ labels: ['ui'] }));
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Add label"]');
    if (!input) throw new Error('add-label input not found');

    await act(async () => typeInto(input, 'backend'));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    // Chip is on screen right away, ahead of the RPC resolving.
    expect(labelChips(root)).toEqual(['ui', 'backend']);
    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('addLabel');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', label: 'backend' });
    // The input clears once the label is submitted.
    expect(input.value).toBe('');
  });

  it('a failed addLabel rolls the chip back and shows an error toast', async () => {
    const root = await mount(bead({ labels: ['ui'] }));
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Add label"]');
    if (!input) throw new Error('add-label input not found');

    await act(async () => typeInto(input, 'backend'));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(labelChips(root)).toEqual(['ui', 'backend']);

    await act(async () => {
      rpc.calls[0].reject({ kind: 'bd-error', message: 'bd refused: unknown label syntax' });
      await Promise.resolve();
    });

    // Rolled back to the last known-good state.
    expect(labelChips(root)).toEqual(['ui']);
    expect(toast.notify).toHaveBeenCalledWith('bd refused: unknown label syntax', 'error');
  });

  it('removing a label applies immediately and calls removeLabel', async () => {
    const root = await mount(bead({ labels: ['ui', 'backend'] }));
    const removeButton = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove label ui"]',
    );
    if (!removeButton) throw new Error('remove button not found');

    await act(async () => removeButton.click());

    expect(labelChips(root)).toEqual(['backend']);
    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('removeLabel');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', label: 'ui' });
  });

  it('a failed removeLabel rolls the chip back and shows an error toast', async () => {
    const root = await mount(bead({ labels: ['ui', 'backend'] }));
    const removeButton = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove label ui"]',
    );
    if (!removeButton) throw new Error('remove button not found');

    await act(async () => removeButton.click());
    expect(labelChips(root)).toEqual(['backend']);

    await act(async () => {
      rpc.calls[0].reject({ kind: 'bd-error', message: 'bd refused the write' });
      await Promise.resolve();
    });

    expect(labelChips(root)).toEqual(['ui', 'backend']);
    expect(toast.notify).toHaveBeenCalledWith('bd refused the write', 'error');
  });

  it('retires the override once `beads` agrees with it, without a further RPC call', async () => {
    const subject = bead({ labels: ['ui'] });
    const root = await mount(subject, [subject]);
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Add label"]');
    if (!input) throw new Error('add-label input not found');

    await act(async () => typeInto(input, 'backend'));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(labelChips(root)).toEqual(['ui', 'backend']);

    await act(async () => {
      rpc.calls[0].resolve({ ok: true });
      await Promise.resolve();
    });

    // The host's refreshed snapshot now agrees — the real app updates the
    // `bead` prop and `beads` together from the same snapshot, so the test
    // does too.
    const refreshed = { ...subject, labels: ['ui', 'backend'] };
    await rerender?.(refreshed, [refreshed]);

    // Still correct after the override retires (no leftover state masking a
    // later change made outside this pane).
    expect(labelChips(root)).toEqual(['ui', 'backend']);
  });

  it('derives the add-input datalist from labels already present across `beads`, not a hardcoded list', async () => {
    const subject = bead({ labels: ['ui'] });
    const root = await mount(subject, [
      subject,
      bead({ id: 'bd-2', labels: ['backend', 'ui'] }),
      bead({ id: 'bd-3', labels: ['roadmap'] }),
    ]);

    const datalist = root.querySelector('datalist#bead-detail-labels');
    if (!datalist) throw new Error('datalist not found');
    const options = [...datalist.querySelectorAll('option')].map((option) => option.value);

    expect(options).toEqual(['backend', 'roadmap', 'ui']);
  });
});
