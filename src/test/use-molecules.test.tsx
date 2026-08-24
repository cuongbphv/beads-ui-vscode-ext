// @vitest-environment jsdom

/**
 * `useMolecules`: fetch `getMolSnapshot` on mount, refetch on every
 * `issuesChanged` host event while mounted, coalesced to one in-flight call.
 * Same harness style as `use-fleet.test.tsx` — a `Probe` component captures
 * the hook's return value so it can be inspected after each `act`.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MolSnapshot } from '../shared/mol';
import type { HostEvent } from '../shared/protocol';
import type { MoleculesState } from '../webview/hooks/use-molecules';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown }>,
  listeners: new Set<(event: HostEvent) => void>(),
  // Resolved/rejected in FIFO order by the test as it decides — lets a test
  // assert "one in-flight call" by holding the first resolution open.
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

const { useMolecules } = await import('../webview/hooks/use-molecules');

function fireIssuesChanged(): void {
  for (const listener of [...rpc.listeners]) {
    listener({ kind: 'event', name: 'issuesChanged', snapshot: {} as never });
  }
}

function makeSnapshot(overrides: Partial<MolSnapshot> = {}): MolSnapshot {
  return {
    molecules: [],
    wisps: [],
    gates: [],
    fetchedAt: new Date().toISOString(),
    degraded: false,
    ...overrides,
  };
}

/** Resolves the oldest still-pending `getMolSnapshot` call. */
async function resolveOldest(value: MolSnapshot): Promise<void> {
  const call = rpc.pending.shift();
  if (!call) throw new Error('no pending getMolSnapshot call to resolve');
  await act(async () => call.resolve(value));
}

let state: MoleculesState | undefined;
let mounted: ReturnType<typeof createRoot> | undefined;

function Probe(): ReactNode {
  state = useMolecules();
  return null;
}

function hook(): MoleculesState {
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
  state = undefined;
  rpc.calls.length = 0;
  rpc.listeners.clear();
  rpc.pending.length = 0;
});

async function mount(): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(Probe)));
}

describe('useMolecules', () => {
  it('fetches getMolSnapshot on mount', async () => {
    await mount();

    expect(rpc.calls).toEqual([{ method: 'getMolSnapshot', params: undefined }]);
    expect(hook().loading).toBe(true);
  });

  it('renders the snapshot once the first fetch settles and clears loading', async () => {
    await mount();

    const snapshot = makeSnapshot({ degraded: true });
    await resolveOldest(snapshot);

    expect(hook().snapshot).toEqual(snapshot);
    expect(hook().loading).toBe(false);
    expect(hook().error).toBeUndefined();
  });

  it('surfaces a rejection as error without leaving loading stuck on', async () => {
    await mount();

    await act(async () => rpc.pending.shift()?.reject(new Error('bd not found')));

    expect(hook().loading).toBe(false);
    expect(hook().snapshot).toBeUndefined();
    expect(hook().error?.message).toContain('bd not found');
  });

  it('refetches on issuesChanged while mounted', async () => {
    await mount();
    await resolveOldest(makeSnapshot());
    rpc.calls.length = 0;

    await act(async () => fireIssuesChanged());

    expect(rpc.calls).toEqual([{ method: 'getMolSnapshot', params: undefined }]);

    const next = makeSnapshot({ degraded: true });
    await resolveOldest(next);
    expect(hook().snapshot).toEqual(next);
  });

  it('coalesces a refetch requested while one is already in flight into a single call', async () => {
    await mount(); // one call outstanding
    rpc.calls.length = 0;

    // Fired twice before the outstanding call ever resolves.
    await act(async () => fireIssuesChanged());
    await act(async () => fireIssuesChanged());

    // Neither trigger issued a new call — the first fetch (from mount) is
    // still outstanding.
    expect(rpc.calls).toEqual([]);
    expect(rpc.pending).toHaveLength(1);

    await resolveOldest(makeSnapshot());
    expect(hook().loading).toBe(false);
  });

  it('ignores a late resolution after unmount', async () => {
    await mount();
    const pending = rpc.pending[0];
    await act(async () => mounted?.unmount());
    mounted = undefined;

    expect(() => pending?.resolve(makeSnapshot())).not.toThrow();
  });
});
