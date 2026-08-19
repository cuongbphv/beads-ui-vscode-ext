// @vitest-environment jsdom

/**
 * `FleetView`: wires `useFleet()` to `WorkerList`/the loading and empty
 * states, and (beads-ui-vscode-ext-37b) a selected worker/session through to
 * the `Transcript` detail pane. The subscribe/unsubscribe contract itself is
 * `use-fleet.test.tsx`'s subject, and `Transcript`'s own rendering is
 * `fleet-transcript-view.test.tsx`'s; this file only checks that mount/unmount
 * drives `useFleet`, that each snapshot shape renders the right view, and that
 * selecting a row actually mounts the transcript pane (`subscribeTranscript`)
 * and closing it tears the subscription back down.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetSnapshot, TranscriptBackfill } from '../shared/fleet';
import type { FleetStatusFilter } from '../shared/fleet-filter';
import type { HostEvent } from '../shared/protocol';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** A no-op ResizeObserver — `FleetView` only needs the ref not to throw; the
 * detail pane's width maths are `lib/drag-resize.test.ts`'s own subject. */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown }>,
  listeners: new Set<(event: HostEvent) => void>(),
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    rpc.calls.push({ method, params });
    if (method === 'subscribeTranscript') {
      const backfill: TranscriptBackfill = {
        target: (params as { targetId: string }).targetId as TranscriptBackfill['target'],
        events: [],
        offset: 0,
        truncated: false,
        totalBytes: 0,
      };
      return Promise.resolve(backfill);
    }
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
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: NoopResizeObserver,
  });
});

beforeEach(() => {
  rpc.calls.length = 0;
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

async function mount(
  options: { statusFilter?: FleetStatusFilter; onStatusFilterChange?: (filter: FleetStatusFilter) => void } = {},
): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () =>
    mounted?.render(
      createElement(FleetView, {
        detailWidth: 384,
        onDetailWidthChange: () => {},
        statusFilter: options.statusFilter ?? 'all',
        onStatusFilterChange: options.onStatusFilterChange ?? (() => {}),
      }),
    ),
  );
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

describe('FleetView transcript pane (beads-ui-vscode-ext-37b)', () => {
  it('mounts the transcript pane and calls subscribeTranscript when a worker row is selected', async () => {
    const el = await mount();
    await act(async () =>
      fire(
        snapshot({
          orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
          workers: [
            {
              agentId: 'agent-a',
              sessionId: 'session-1',
              beadId: null,
              worktreePath: null,
              briefSummary: '',
              lastActivityAt: null,
              status: 'unknown',
            },
          ],
        }),
      ),
    );

    const row = el.querySelector('li[role="button"]') as HTMLElement;
    await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(rpc.calls).toContainEqual({ method: 'subscribeTranscript', params: { targetId: 'agent:agent-a' } });
    expect(el.querySelector('aside[aria-label^="Transcript for"]')).not.toBeNull();
  });

  it('unsubscribes the transcript and closes the pane when its close button is clicked', async () => {
    const el = await mount();
    await act(async () =>
      fire(
        snapshot({
          orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
          workers: [
            {
              agentId: 'agent-a',
              sessionId: 'session-1',
              beadId: null,
              worktreePath: null,
              briefSummary: '',
              lastActivityAt: null,
              status: 'unknown',
            },
          ],
        }),
      ),
    );

    const row = el.querySelector('li[role="button"]') as HTMLElement;
    await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(el.querySelector('aside[aria-label^="Transcript for"]')).not.toBeNull();

    const closeButton = el.querySelector('button[aria-label="Close transcript"]') as HTMLElement;
    await act(async () => closeButton.click());

    expect(el.querySelector('aside[aria-label^="Transcript for"]')).toBeNull();
    expect(rpc.calls).toContainEqual({
      method: 'unsubscribeTranscript',
      params: { targetId: 'agent:agent-a' },
    });
  });

  it('puts the worker list and transcript pane in the same flex-row container, not stacked (beads-ui-vscode-ext-w9a.8)', async () => {
    const el = await mount();
    await act(async () =>
      fire(
        snapshot({
          orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
          workers: [
            {
              agentId: 'agent-a',
              sessionId: 'session-1',
              beadId: null,
              worktreePath: null,
              briefSummary: '',
              lastActivityAt: null,
              status: 'unknown',
            },
          ],
        }),
      ),
    );

    const row = el.querySelector('li[role="button"]') as HTMLElement;
    await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const aside = el.querySelector('aside[aria-label^="Transcript for"]') as HTMLElement;
    // The nearest `flex` ancestor shared by the aside and the worker row must
    // be a row container (no `flex-col`) so the transcript pane sits beside
    // the list at `@3xl`+ instead of stacking underneath it.
    const rowContainer = aside.closest('div.flex') as HTMLElement;
    expect(rowContainer).not.toBeNull();
    expect(rowContainer.className).not.toMatch(/flex-col/);
    expect(rowContainer.contains(row)).toBe(true);
  });
});

describe('FleetView status filter (beads-ui-vscode-ext-w9a.6)', () => {
  it('narrows the visible workers and reports the choice to onStatusFilterChange', async () => {
    const onStatusFilterChange = vi.fn();
    const el = await mount({ statusFilter: 'all', onStatusFilterChange });

    await act(async () =>
      fire(
        snapshot({
          orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a', 'agent-b'], lastActivityAt: null }],
          workers: [
            {
              agentId: 'agent-running',
              sessionId: 'session-1',
              beadId: null,
              worktreePath: null,
              briefSummary: '',
              lastActivityAt: null,
              status: 'running',
            },
            {
              agentId: 'agent-idle',
              sessionId: 'session-1',
              beadId: null,
              worktreePath: null,
              briefSummary: '',
              lastActivityAt: null,
              status: 'idle',
            },
          ],
        }),
      ),
    );

    expect(el.querySelectorAll('li[role="button"]')).toHaveLength(2);

    const select = el.querySelector('select[aria-label="Status"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    await act(async () => {
      select.value = 'running';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onStatusFilterChange).toHaveBeenCalledWith('running');
  });

  it('actually narrows the rendered list when statusFilter="running" is passed in', async () => {
    const el = await mount({ statusFilter: 'running' });

    await act(async () =>
      fire(
        snapshot({
          orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a', 'agent-b'], lastActivityAt: null }],
          workers: [
            {
              agentId: 'agent-running',
              sessionId: 'session-1',
              beadId: null,
              worktreePath: null,
              briefSummary: '',
              lastActivityAt: null,
              status: 'running',
            },
            {
              agentId: 'agent-idle',
              sessionId: 'session-1',
              beadId: null,
              worktreePath: null,
              briefSummary: '',
              lastActivityAt: null,
              status: 'idle',
            },
          ],
        }),
      ),
    );

    const rows = Array.from(el.querySelectorAll('li[role="button"]'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('aria-label')).toContain('agent-running');
  });
});
