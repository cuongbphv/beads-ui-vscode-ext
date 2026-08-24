// @vitest-environment jsdom

/**
 * `useSyncStatus` (bead ayq.2): no effects of its own, so mounting or
 * re-rendering never fetches — only calling the returned `refresh` does.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const getSyncStatusCalls: unknown[] = [];

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    if (method === 'getSyncStatus') {
      getSyncStatusCalls.push(params);
      return Promise.resolve({ mode: 'embedded', server_running: false });
    }
    return new Promise(() => undefined);
  },
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

import { useSyncStatus } from '../webview/hooks/use-sync-status';

let mountedRoot: Root | undefined;
let container: HTMLDivElement | undefined;
let lastRefresh: (() => void) | undefined;

function Probe(): null {
  const { refresh } = useSyncStatus();
  lastRefresh = refresh;
  return null;
}

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
  lastRefresh = undefined;
  getSyncStatusCalls.length = 0;
});

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(createElement(Probe)));
}

describe('useSyncStatus', () => {
  it('fetches nothing on mount', async () => {
    await mount();
    expect(getSyncStatusCalls).toEqual([]);
  });

  it('fetches nothing on a re-render with no call to refresh (simulated poll-driven rerender)', async () => {
    await mount();
    // A parent re-render (e.g. from an unrelated snapshot update) must not
    // itself trigger a fetch: there is no effect here to react to it.
    await act(async () => mountedRoot?.render(createElement(Probe)));

    expect(getSyncStatusCalls).toEqual([]);
  });

  it('fetches exactly once per call to refresh', async () => {
    await mount();

    await act(async () => lastRefresh?.());
    expect(getSyncStatusCalls).toEqual([{}]);

    await act(async () => lastRefresh?.());
    expect(getSyncStatusCalls).toEqual([{}, {}]);
  });
});
