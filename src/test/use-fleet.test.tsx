// @vitest-environment jsdom

/**
 * `useFleet`: subscribe on mount, unsubscribe on unmount, render whatever
 * `fleetChanged` last delivered. Same harness style as
 * `use-schedule-edit.test.tsx` — a `Probe` component captures the hook's
 * return value so it can be inspected after each `act`.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FleetSnapshot } from '../shared/fleet';
import type { HostEvent } from '../shared/protocol';
import type { FleetState } from '../webview/hooks/use-fleet';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown }>,
  listeners: new Set<(event: HostEvent) => void>(),
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    rpc.calls.push({ method, params });
    return Promise.resolve({ ok: true });
  },
  onHostEvent: (listener: (event: HostEvent) => void) => {
    rpc.listeners.add(listener);
    return () => rpc.listeners.delete(listener);
  },
}));

const { useFleet } = await import('../webview/hooks/use-fleet');

function fire(fleet: FleetSnapshot): void {
  for (const listener of [...rpc.listeners]) listener({ kind: 'event', name: 'fleetChanged', fleet });
}

function makeSnapshot(overrides: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return {
    orchestrators: [],
    workers: [],
    worktrees: [],
    orphanWorktrees: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

let state: FleetState | undefined;
let mounted: ReturnType<typeof createRoot> | undefined;

function Probe(): ReactNode {
  state = useFleet();
  return null;
}

function hook(): FleetState {
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
});

async function mount(): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(Probe)));
}

describe('useFleet', () => {
  it('calls subscribeFleet on mount', async () => {
    await mount();

    expect(rpc.calls).toEqual([{ method: 'subscribeFleet', params: undefined }]);
  });

  it('starts loading and clears it once subscribeFleet settles', async () => {
    await mount();

    expect(hook().loading).toBe(false);
    expect(hook().snapshot).toBeUndefined();
  });

  it('renders whatever fleetChanged delivers', async () => {
    await mount();

    const snapshot = makeSnapshot({ orphanWorktrees: ['/repo/wt-stale'] });
    await act(async () => fire(snapshot));

    expect(hook().snapshot).toEqual(snapshot);
    expect(hook().loading).toBe(false);
  });

  it('renders a later fleetChanged over an earlier one', async () => {
    await mount();

    await act(async () => fire(makeSnapshot({ orphanWorktrees: ['/repo/wt-a'] })));
    await act(async () => fire(makeSnapshot({ orphanWorktrees: ['/repo/wt-b'] })));

    expect(hook().snapshot?.orphanWorktrees).toEqual(['/repo/wt-b']);
  });

  it('calls unsubscribeFleet on unmount', async () => {
    await mount();
    rpc.calls.length = 0;

    await act(async () => mounted?.unmount());
    mounted = undefined;

    expect(rpc.calls).toEqual([{ method: 'unsubscribeFleet', params: undefined }]);
  });

  it('ignores an event delivered after unmount', async () => {
    await mount();
    await act(async () => mounted?.unmount());
    mounted = undefined;
    const before = hook().snapshot;

    // No listener should remain registered; firing must be a no-op.
    expect(rpc.listeners.size).toBe(0);
    fire(makeSnapshot());
    expect(hook().snapshot).toBe(before);
  });
});
