// @vitest-environment jsdom

/**
 * `useTranscript`: subscribe for a `targetId` on mount (and whenever it
 * changes), unsubscribe on unmount/change, filter `transcriptAppend` events
 * strictly by `targetId` (switching targets must never leak a stale event
 * from the previous one), keep a rolling window of the last 500 events, and
 * surface `truncated`/`degraded` banner flags. Same harness style as
 * `use-fleet.test.tsx` — a `Probe` component captures the hook's return value.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TranscriptEvent } from '../shared/fleet';
import type { HostEvent } from '../shared/protocol';
import type { TranscriptState } from '../webview/hooks/use-transcript';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown }>,
  listeners: new Set<(event: HostEvent) => void>(),
  subscribeImpl: undefined as ((targetId: string) => Promise<unknown>) | undefined,
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: { targetId: string }) => {
    rpc.calls.push({ method, params });
    if (method === 'subscribeTranscript' && rpc.subscribeImpl) return rpc.subscribeImpl(params.targetId);
    if (method === 'subscribeTranscript') {
      return Promise.resolve({ target: params.targetId, events: [], offset: 0, truncated: false, totalBytes: 0 });
    }
    return Promise.resolve({ ok: true });
  },
  onHostEvent: (listener: (event: HostEvent) => void) => {
    rpc.listeners.add(listener);
    return () => rpc.listeners.delete(listener);
  },
  asRpcError: (error: unknown) => ({
    kind: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

const { useTranscript, MAX_TRANSCRIPT_EVENTS } = await import('../webview/hooks/use-transcript');

function fireAppend(targetId: string, events: TranscriptEvent[], degraded = false): void {
  for (const listener of [...rpc.listeners]) {
    listener({
      kind: 'event',
      name: 'transcriptAppend',
      targetId,
      events,
      totalBytes: 0,
      ...(degraded ? { degraded: true } : {}),
    });
  }
}

function makeEvent(overrides: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    uuid: null,
    role: 'user',
    timestamp: null,
    agentId: null,
    sessionId: null,
    blocks: [{ type: 'text', text: 'hi', truncated: false }],
    ...overrides,
  };
}

let state: TranscriptState | undefined;
let mounted: ReturnType<typeof createRoot> | undefined;
let container: HTMLElement | undefined;

function Probe({ targetId }: { targetId: string }): ReactNode {
  state = useTranscript(targetId);
  return null;
}

function hook(): TranscriptState {
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
  rpc.subscribeImpl = undefined;
});

async function mount(targetId: string): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(Probe, { targetId })));
}

async function rerender(targetId: string): Promise<void> {
  await act(async () => mounted?.render(createElement(Probe, { targetId })));
}

describe('useTranscript', () => {
  it('calls subscribeTranscript with the given targetId on mount', async () => {
    await mount('agent:worker-1');
    expect(rpc.calls).toEqual([{ method: 'subscribeTranscript', params: { targetId: 'agent:worker-1' } }]);
  });

  it('populates events from the backfill and clears loading', async () => {
    rpc.subscribeImpl = async (targetId) =>
      ({ target: targetId, events: [makeEvent(), makeEvent()], offset: 10, truncated: false, totalBytes: 10 });
    await mount('agent:worker-1');

    expect(hook().loading).toBe(false);
    expect(hook().events).toHaveLength(2);
    expect(hook().truncated).toBe(false);
  });

  it('surfaces backfill.truncated as the truncated banner flag', async () => {
    rpc.subscribeImpl = async (targetId) =>
      ({ target: targetId, events: [makeEvent()], offset: 999_999, truncated: true, totalBytes: 999_999 });
    await mount('agent:worker-1');

    expect(hook().truncated).toBe(true);
  });

  it('surfaces backfill.degraded as the degraded flag', async () => {
    rpc.subscribeImpl = async (targetId) =>
      ({ target: targetId, events: [], offset: 0, truncated: false, totalBytes: 0, degraded: true });
    await mount('agent:worker-1');

    expect(hook().degraded).toBe(true);
  });

  it('surfaces a rejected subscribeTranscript (e.g. unknown target) as an error, not a throw', async () => {
    rpc.subscribeImpl = async () => {
      throw new Error('Unknown transcript target: agent:ghost');
    };
    await mount('agent:ghost');

    expect(hook().loading).toBe(false);
    expect(hook().error).toMatch(/unknown transcript target/i);
  });

  it('appends events delivered by transcriptAppend for the same targetId', async () => {
    await mount('agent:worker-1');

    await act(async () => fireAppend('agent:worker-1', [makeEvent({ role: 'assistant' })]));

    expect(hook().events).toHaveLength(1);
    expect(hook().events[0].role).toBe('assistant');
  });

  it('ignores a transcriptAppend event for a different targetId', async () => {
    await mount('agent:worker-1');

    await act(async () => fireAppend('agent:someone-else', [makeEvent()]));

    expect(hook().events).toHaveLength(0);
  });

  it('sets degraded from a later transcriptAppend batch', async () => {
    await mount('agent:worker-1');

    await act(async () => fireAppend('agent:worker-1', [], true));

    expect(hook().degraded).toBe(true);
  });

  it('keeps only the most recent 500 events and flags truncated once the window overflows', async () => {
    await mount('agent:worker-1');

    const burst = Array.from({ length: MAX_TRANSCRIPT_EVENTS + 50 }, (_, i) =>
      makeEvent({ uuid: `e-${i}` }),
    );
    await act(async () => fireAppend('agent:worker-1', burst));

    expect(hook().events).toHaveLength(MAX_TRANSCRIPT_EVENTS);
    expect(hook().events[0].uuid).toBe('e-50'); // the oldest 50 were dropped
    expect(hook().truncated).toBe(true);
  });

  it('calls unsubscribeTranscript with the same targetId on unmount', async () => {
    await mount('agent:worker-1');
    rpc.calls.length = 0;

    await act(async () => mounted?.unmount());
    mounted = undefined;

    expect(rpc.calls).toEqual([{ method: 'unsubscribeTranscript', params: { targetId: 'agent:worker-1' } }]);
  });

  it('unsubscribes the old target and subscribes the new one when targetId changes', async () => {
    await mount('agent:worker-1');
    rpc.calls.length = 0;

    await rerender('agent:worker-2');

    expect(rpc.calls).toEqual([
      { method: 'unsubscribeTranscript', params: { targetId: 'agent:worker-1' } },
      { method: 'subscribeTranscript', params: { targetId: 'agent:worker-2' } },
    ]);
  });

  it('resets events and does not leak a stale event from the previous target after switching', async () => {
    await mount('agent:worker-1');
    await act(async () => fireAppend('agent:worker-1', [makeEvent({ uuid: 'from-worker-1' })]));
    expect(hook().events).toHaveLength(1);

    await rerender('agent:worker-2');
    expect(hook().events).toHaveLength(0); // fresh subscription starts with an empty window

    // An event that arrives for the OLD target after switching must never appear.
    await act(async () => fireAppend('agent:worker-1', [makeEvent({ uuid: 'late-from-worker-1' })]));
    expect(hook().events).toHaveLength(0);

    await act(async () => fireAppend('agent:worker-2', [makeEvent({ uuid: 'from-worker-2' })]));
    expect(hook().events).toHaveLength(1);
    expect(hook().events[0].uuid).toBe('from-worker-2');
  });

  it('ignores an event delivered after unmount', async () => {
    await mount('agent:worker-1');
    await act(async () => mounted?.unmount());
    mounted = undefined;

    expect(rpc.listeners.size).toBe(0);
    fireAppend('agent:worker-1', [makeEvent()]);
    expect(hook().events).toHaveLength(0);
  });
});
