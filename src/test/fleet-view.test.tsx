// @vitest-environment jsdom

/**
 * `FleetView`: wires `useFleet()` to `WorkerList`/the loading and empty
 * states. The subscribe/unsubscribe contract itself is `use-fleet.test.tsx`'s
 * subject; this file only checks that mount/unmount actually drives it and
 * that each snapshot shape renders the right view.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FleetSnapshot } from '../shared/fleet';
import type { HostEvent } from '../shared/protocol';

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

const { FleetView } = await import('../webview/views/FleetView');

function fire(fleet: FleetSnapshot): void {
  for (const listener of [...rpc.listeners]) listener({ kind: 'event', name: 'fleetChanged', fleet });
}

function snapshot(overrides: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return {
    orchestrators: [],
    workers: [],
    worktrees: [],
    orphanWorktrees: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

let mounted: Root | undefined;
let container: HTMLElement | undefined;

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
  rpc.calls.length = 0;
  rpc.listeners.clear();
});

async function mount(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(FleetView)));
  return container;
}

describe('FleetView', () => {
  it('subscribes to Fleet on mount and unsubscribes on unmount', async () => {
    await mount();
    expect(rpc.calls).toEqual([{ method: 'subscribeFleet', params: undefined }]);

    await act(async () => mounted?.unmount());
    mounted = undefined;

    expect(rpc.calls).toEqual([
      { method: 'subscribeFleet', params: undefined },
      { method: 'unsubscribeFleet', params: undefined },
    ]);
  });

  it('renders the no-data empty state before any fleetChanged has arrived', async () => {
    const el = await mount();
    expect(el.textContent).toContain('No fleet data yet');
  });

  it('renders WorkerList content once a snapshot arrives', async () => {
    const el = await mount();

    await act(async () =>
      fire(
        snapshot({
          orchestrators: [{ sessionId: 'session-1', workerIds: [], lastActivityAt: null }],
        }),
      ),
    );

    expect(el.textContent).toContain('session-1'.slice(0, 8));
    expect(el.textContent).not.toContain('No fleet data yet');
  });

  it('renders the degraded hint when discovery reports no-claude-dir', async () => {
    const el = await mount();

    await act(async () => fire(snapshot({ degraded: { reason: 'no-claude-dir' } })));

    expect(el.textContent).toContain('No Claude Code session data');
  });
});
