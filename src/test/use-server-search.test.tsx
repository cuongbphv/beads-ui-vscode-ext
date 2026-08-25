// @vitest-environment jsdom

/**
 * `useServerSearch` (beads-ui-vscode-ext-72m.4): active only once the
 * workspace is truncated and the query is long enough, debounced 300ms, and
 * guarded against a reply for a query the user has since changed. Same
 * mocked-bridge harness `use-molecules.test.tsx` uses, with fake timers to
 * drive the debounce deterministically.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Bead } from '../shared/types';
import type { UseServerSearchState } from '../webview/hooks/use-server-search';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown }>,
  // Resolved/rejected in FIFO order by the test, so a "stale reply" can be
  // settled after a fresher call has already been issued.
  pending: [] as Array<{ resolve: (value: unknown) => void; reject: (cause: unknown) => void }>,
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    rpc.calls.push({ method, params });
    return new Promise((resolve, reject) => {
      rpc.pending.push({ resolve, reject });
    });
  },
  asRpcError: (cause: unknown) => ({ message: String(cause), kind: 'unknown' as const }),
}));

const { useServerSearch } = await import('../webview/hooks/use-server-search');

let state: UseServerSearchState | undefined;
let mounted: Root | undefined;

function Probe({ text, truncated }: { text: string; truncated: boolean }): ReactNode {
  state = useServerSearch(text, truncated);
  return null;
}

function hook(): UseServerSearchState {
  if (!state) throw new Error('the probe must be mounted first');
  return state;
}

async function mount(text: string, truncated: boolean): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(Probe, { text, truncated })));
}

async function rerender(text: string, truncated: boolean): Promise<void> {
  await act(async () => mounted?.render(createElement(Probe, { text, truncated })));
}

async function advance(ms: number): Promise<void> {
  await act(async () => void vi.advanceTimersByTime(ms));
}

function bead(id: string, title: string): Bead {
  return { id, title, status: 'open', priority: 2, issue_type: 'task' };
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
  rpc.pending.length = 0;
  vi.useRealTimers();
});

describe('useServerSearch gating', () => {
  it('never calls searchBeads while the workspace is not truncated, no matter the query', async () => {
    vi.useFakeTimers();
    await mount('roadmap', false);

    await advance(1000);

    expect(rpc.calls).toEqual([]);
    expect(hook().extraBeads).toEqual([]);
    expect(hook().loading).toBe(false);
  });

  it('never calls searchBeads below the 2-character minimum, even when truncated', async () => {
    vi.useFakeTimers();
    await mount('r', true);

    await advance(1000);

    expect(rpc.calls).toEqual([]);
  });

  it('activates at exactly the 2-character minimum once truncated', async () => {
    vi.useFakeTimers();
    await mount('ro', true);

    await advance(300);

    expect(rpc.calls).toEqual([{ method: 'searchBeads', params: { text: 'ro' } }]);
  });

  it('clears a previous answer once the query is edited back below the minimum', async () => {
    vi.useFakeTimers();
    await mount('road', true);
    await advance(300);
    await act(async () => rpc.pending[0].resolve([bead('bd-1', 'Road trip')]));
    expect(hook().extraBeads).toHaveLength(1);

    await rerender('r', true);

    expect(hook().extraBeads).toEqual([]);
  });
});

describe('useServerSearch debounce', () => {
  it('waits 300ms after the last keystroke before calling, asserting the exact RPC argv', async () => {
    vi.useFakeTimers();
    await mount('ro', true);
    await advance(200);
    await rerender('roa', true);
    await advance(200);
    await rerender('road', true);

    // Still short of 300ms since the *last* keystroke — no call yet.
    await advance(299);
    expect(rpc.calls).toEqual([]);

    await advance(1);
    expect(rpc.calls).toEqual([{ method: 'searchBeads', params: { text: 'road' } }]);
  });

  it('sends the trimmed text, not the raw input', async () => {
    vi.useFakeTimers();
    await mount('  road  ', true);

    await advance(300);

    expect(rpc.calls).toEqual([{ method: 'searchBeads', params: { text: 'road' } }]);
  });

  it('reports loading while the debounce timer and the call are outstanding, then clears it', async () => {
    vi.useFakeTimers();
    await mount('road', true);
    expect(hook().loading).toBe(true);

    await advance(300);
    expect(hook().loading).toBe(true); // call issued, not yet resolved

    await act(async () => rpc.pending[0].resolve([]));
    expect(hook().loading).toBe(false);
  });
});

describe('useServerSearch stale-reply guard', () => {
  it('drops a reply for a query the user has since changed, and keeps the fresh one', async () => {
    vi.useFakeTimers();
    await mount('road', true);
    await advance(300);
    expect(rpc.calls).toHaveLength(1);
    const stale = rpc.pending[0];

    await rerender('roadx', true);
    await advance(300);
    expect(rpc.calls).toHaveLength(2);

    // The stale call settles after the fresh one was already issued.
    await act(async () => stale.resolve([bead('stale-1', 'Stale hit')]));
    expect(hook().extraBeads).toEqual([]);

    await act(async () => rpc.pending[1].resolve([bead('fresh-1', 'Fresh hit')]));
    expect(hook().extraBeads).toEqual([bead('fresh-1', 'Fresh hit')]);
  });

  it('ignores a late resolution after unmount', async () => {
    vi.useFakeTimers();
    await mount('road', true);
    await advance(300);
    const pending = rpc.pending[0];

    await act(async () => mounted?.unmount());
    mounted = undefined;

    expect(() => pending.resolve([bead('bd-1', 'x')])).not.toThrow();
  });

  it('surfaces a rejection as an RpcError without leaving loading stuck on', async () => {
    vi.useFakeTimers();
    await mount('road', true);
    await advance(300);

    await act(async () => rpc.pending[0].reject(new Error('bd: unknown command')));

    expect(hook().loading).toBe(false);
    expect(hook().error?.message).toContain('bd: unknown command');
  });
});
