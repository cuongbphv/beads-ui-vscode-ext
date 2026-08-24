// @vitest-environment jsdom

/**
 * `useMolDetail`: fetch `showMolecule` only while a non-undefined id is
 * passed in, refetch on every `issuesChanged` host event while mounted with
 * one, coalesced to one in-flight call — same harness style as
 * `use-molecules.test.tsx`'s `Probe` component.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MolDetail } from '../shared/mol';
import type { HostEvent } from '../shared/protocol';
import type { MolDetailState } from '../webview/hooks/use-mol-detail';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown }>,
  listeners: new Set<(event: HostEvent) => void>(),
  pending: [] as Array<{ resolve: (value: unknown) => void; reject: (cause: unknown) => void }>,
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    rpc.calls.push({ method, params });
    return new Promise((resolve, reject) => {
      rpc.pending.push({ resolve, reject });
    });
  },
  onHostEvent: (listener: (event: HostEvent) => void) => {
    rpc.listeners.add(listener);
    return () => rpc.listeners.delete(listener);
  },
  asRpcError: (cause: unknown) => ({ message: String(cause), kind: 'unknown' as const }),
}));

const { useMolDetail } = await import('../webview/hooks/use-mol-detail');

function fireIssuesChanged(): void {
  for (const listener of [...rpc.listeners]) {
    listener({ kind: 'event', name: 'issuesChanged', snapshot: {} as never });
  }
}

function makeDetail(overrides: Partial<MolDetail> = {}): MolDetail {
  return {
    root: { id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' },
    steps: [],
    parallelAvailable: false,
    progress: null,
    ...overrides,
  };
}

/** Resolves the oldest still-pending `showMolecule` call. */
async function resolveOldest(value: MolDetail): Promise<void> {
  const call = rpc.pending.shift();
  if (!call) throw new Error('no pending showMolecule call to resolve');
  await act(async () => call.resolve(value));
}

let state: MolDetailState | undefined;
let mounted: ReturnType<typeof createRoot> | undefined;
let container: HTMLElement | undefined;

function Probe({ id }: { id: string | undefined }): ReactNode {
  state = useMolDetail(id);
  return null;
}

function hook(): MolDetailState {
  if (!state) throw new Error('the probe must be mounted first');
  return state;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.unmount());
    mounted = undefined;
  }
  container?.remove();
  container = undefined;
  state = undefined;
  rpc.calls.length = 0;
  rpc.listeners.clear();
  rpc.pending.length = 0;
});

async function mount(id: string | undefined): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(Probe, { id })));
}

async function rerender(id: string | undefined): Promise<void> {
  await act(async () => mounted?.render(createElement(Probe, { id })));
}

describe('useMolDetail', () => {
  it('issues no call and holds no data while id is undefined', async () => {
    await mount(undefined);

    expect(rpc.calls).toEqual([]);
    expect(hook()).toEqual({ detail: undefined, loading: false, error: undefined });
  });

  it('fetches showMolecule with the given id once one is passed', async () => {
    await mount('mol-1');

    expect(rpc.calls).toEqual([{ method: 'showMolecule', params: { id: 'mol-1' } }]);
    expect(hook().loading).toBe(true);
  });

  it('renders the detail once the fetch settles and clears loading', async () => {
    await mount('mol-1');

    const detail = makeDetail({ parallelAvailable: true });
    await resolveOldest(detail);

    expect(hook().detail).toEqual(detail);
    expect(hook().loading).toBe(false);
    expect(hook().error).toBeUndefined();
  });

  it('surfaces a rejection as error without leaving loading stuck on', async () => {
    await mount('mol-1');

    await act(async () => rpc.pending.shift()?.reject(new Error('bd mol show failed')));

    expect(hook().loading).toBe(false);
    expect(hook().detail).toBeUndefined();
    expect(hook().error?.message).toContain('bd mol show failed');
  });

  it('refetches on issuesChanged while mounted with an id', async () => {
    await mount('mol-1');
    await resolveOldest(makeDetail());
    rpc.calls.length = 0;

    await act(async () => fireIssuesChanged());

    expect(rpc.calls).toEqual([{ method: 'showMolecule', params: { id: 'mol-1' } }]);
    await resolveOldest(makeDetail());
  });

  it('coalesces a refetch requested while one is already in flight into a single call', async () => {
    await mount('mol-1'); // one call outstanding
    rpc.calls.length = 0;

    await act(async () => fireIssuesChanged());
    await act(async () => fireIssuesChanged());

    expect(rpc.calls).toEqual([]);
    expect(rpc.pending).toHaveLength(1);

    await resolveOldest(makeDetail());
    expect(hook().loading).toBe(false);
  });

  it('refetches with the new id, discarding stale state, when the id prop changes', async () => {
    await mount('mol-1');
    await resolveOldest(makeDetail({ root: { id: 'mol-1', title: 'A', status: 'open', priority: 2, issue_type: 'molecule' } }));
    rpc.calls.length = 0;

    await rerender('mol-2');

    expect(rpc.calls).toEqual([{ method: 'showMolecule', params: { id: 'mol-2' } }]);
    // Stale mol-1 detail is cleared while mol-2's fetch is outstanding.
    expect(hook().detail).toBeUndefined();
    expect(hook().loading).toBe(true);

    await resolveOldest(makeDetail({ root: { id: 'mol-2', title: 'B', status: 'open', priority: 2, issue_type: 'molecule' } }));
    expect(hook().detail?.root.id).toBe('mol-2');
  });

  it('clears detail/loading/error when the id prop goes back to undefined', async () => {
    await mount('mol-1');
    await resolveOldest(makeDetail());

    await rerender(undefined);

    expect(hook()).toEqual({ detail: undefined, loading: false, error: undefined });
  });

  it('ignores a late resolution after unmount', async () => {
    await mount('mol-1');
    const pending = rpc.pending[0];
    await act(async () => mounted?.unmount());
    mounted = undefined;

    expect(() => pending?.resolve(makeDetail())).not.toThrow();
  });
});
