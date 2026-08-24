// @vitest-environment jsdom

/**
 * The sync-status chip's fetch trigger (bead ayq.2).
 *
 * `getSyncStatus` must be piggybacked on the manual Refresh button and must
 * never fire on its own — in particular not on `issuesChanged`, the same
 * host event a poll tick pushes to every webview.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardSnapshot } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const bridgeState = vi.hoisted(() => ({
  calls: new Array<{ method: string; params: unknown }>(),
  hostListeners: new Array<(event: unknown) => void>(),
}));

vi.mock('../webview/bridge/rpc', () => ({
  restore: () => undefined,
  persist: () => {},
  signalReady: () => {},
  onHostEvent: (listener: (event: unknown) => void) => {
    bridgeState.hostListeners.push(listener);
    return () => {
      const index = bridgeState.hostListeners.indexOf(listener);
      if (index >= 0) bridgeState.hostListeners.splice(index, 1);
    };
  },
  call: (method: string, params: unknown) => {
    bridgeState.calls.push({ method, params });
    if (method === 'getSyncStatus') {
      return Promise.resolve({ mode: 'embedded', server_running: false });
    }
    // getSnapshot and everything else: never settle, so the panel just sits
    // on its initial/loading state — irrelevant to what this file checks.
    return new Promise(() => undefined);
  },
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

import { App } from '../webview/App';
import { installResizeObserver } from './support/dom-harness';

let root: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  installResizeObserver();
  bridgeState.calls.length = 0;
  bridgeState.hostListeners.length = 0;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
});

async function mountApp(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(App)));
  return container;
}

function syncStatusCalls(): Array<{ method: string; params: unknown }> {
  return bridgeState.calls.filter((call) => call.method === 'getSyncStatus');
}

const emptySnapshot: DashboardSnapshot = {
  context: { bd_version: 'test', beads_dir: '.beads', repo_root: '/repo' },
  vocabulary: { statuses: [], types: [] },
  stats: {
    total_issues: 0,
    open_issues: 0,
    in_progress_issues: 0,
    blocked_issues: 0,
    closed_issues: 0,
    deferred_issues: 0,
    pinned_issues: 0,
    ready_issues: 0,
  },
  beads: [],
  readyIds: [],
  blockedIds: [],
  gates: [],
  truncated: false,
  fetchedAt: '2026-08-24T00:00:00.000Z',
};

describe('sync status chip fetch trigger', () => {
  it('does not fetch on mount, and not on a simulated poll tick (issuesChanged)', async () => {
    await mountApp();
    expect(syncStatusCalls()).toEqual([]);

    // The host pushes `issuesChanged` on its own poll timer, independent of
    // any Refresh click; the chip must stay silent through it.
    await act(async () => {
      bridgeState.hostListeners.forEach((listener) =>
        listener({ kind: 'event', name: 'issuesChanged', snapshot: emptySnapshot }),
      );
    });

    expect(syncStatusCalls()).toEqual([]);
  });

  it('fetches exactly once when the manual Refresh button is clicked', async () => {
    const container = await mountApp();

    const refreshButton = container.querySelector<HTMLButtonElement>(
      'button[title="Refresh from bd"]',
    );
    expect(refreshButton).not.toBeNull();

    await act(async () => refreshButton?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(syncStatusCalls()).toHaveLength(1);
  });

  it('fetches exactly once more per additional Refresh click, not once per render', async () => {
    const container = await mountApp();
    const refreshButton = container.querySelector<HTMLButtonElement>(
      'button[title="Refresh from bd"]',
    );

    await act(async () => refreshButton?.click());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => refreshButton?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(syncStatusCalls()).toHaveLength(2);
  });
});
