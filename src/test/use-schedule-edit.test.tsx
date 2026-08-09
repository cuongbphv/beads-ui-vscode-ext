// @vitest-environment jsdom

/**
 * The hook that turns a released bar into a bd write.
 *
 * Everything here is about time: what the bar looks like while a write is in
 * flight, what happens when two edits land on the same bead, and which answer
 * wins. None of that is reachable from the pure planners it delegates to.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DAY, type Span } from '../shared/schedule';
import type { Bead } from '../shared/types';
import type { BarEdit } from '../webview/lib/bar-drag';
import { useScheduleEdit, type ScheduleEditApi } from '../webview/hooks/use-schedule-edit';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Pending {
  method: string;
  params: { id: string };
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface Notified {
  text: string;
  tone: string;
  action?: { label: string; run: () => void };
}

const bridge = vi.hoisted(() => ({ calls: [] as Pending[] }));
const toast = vi.hoisted(() => ({ messages: [] as Notified[] }));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: { id: string }) =>
    new Promise<void>((resolve, reject) => {
      bridge.calls.push({ method, params, resolve: () => resolve(), reject });
    }),
  asRpcError: (error: unknown) => ({
    kind: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

vi.mock('../webview/components/toast', () => ({
  useToast: () => ({
    notify: (text: string, tone = 'info', action?: Notified['action']) => {
      toast.messages.push({ text, tone, action });
    },
  }),
}));

const NOW = new Date(2026, 7, 4).getTime();

function span(id: string): Span {
  return {
    bead: {
      id,
      title: id,
      status: 'open',
      priority: 2,
      issue_type: 'task',
      due_at: new Date(NOW + DAY).toISOString(),
    } satisfies Bead,
    start: NOW,
    end: NOW + DAY,
    kind: 'due',
    overdue: false,
    deferred: false,
  };
}

/** No due date and no estimate: the bar's end writes minutes, with nothing to undo to. */
function unestimated(id: string): Span {
  return {
    bead: { id, title: id, status: 'open', priority: 2, issue_type: 'task' } satisfies Bead,
    start: NOW,
    end: NOW + DAY,
    kind: 'nominal',
    overdue: false,
    deferred: false,
  };
}

function dueOn(days: number): BarEdit {
  return { field: 'due', at: NOW + days * DAY };
}

let api: ScheduleEditApi | undefined;
let mounted: ReturnType<typeof createRoot> | undefined;

function Probe(): ReactNode {
  api = useScheduleEdit();
  return null;
}

/** The live hook. Re-read after every `act`, because `pending` is state. */
function hook(): ScheduleEditApi {
  if (!api) throw new Error('the probe must be mounted first');
  return api;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.unmount());
    mounted = undefined;
  }
  api = undefined;
  bridge.calls.length = 0;
  toast.messages.length = 0;
});

async function mount(): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(Probe)));
}

async function commit(target: string | Span, edit: BarEdit): Promise<void> {
  const subject = typeof target === 'string' ? span(target) : target;
  await act(async () => hook().commit(subject, edit));
}

/** Press the Undo button on the toast at `index`, as the user would. */
async function undo(index: number): Promise<void> {
  const action = toast.messages[index].action;
  if (!action) throw new Error(`toast ${index} carries no action`);
  await act(async () => action.run());
}

async function settle(index: number, outcome?: unknown): Promise<void> {
  await act(async () => {
    const call = bridge.calls[index];
    if (outcome === undefined) call.resolve();
    else call.reject(outcome);
  });
}

describe('useScheduleEdit', () => {
  it('holds the bead pending from the request until bd answers', async () => {
    await mount();
    await commit('bd-1', dueOn(3));

    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].method).toBe('setDue');
    expect([...hook().pending]).toEqual(['bd-1']);

    await settle(0);

    expect([...hook().pending]).toEqual([]);
    expect(toast.messages).toEqual([
      { text: expect.stringContaining('bd-1'), tone: 'info', action: { label: 'Undo', run: expect.any(Function) } },
    ]);
  });

  it('surfaces a refusal and still lets go of the bead', async () => {
    // A bar left pulsing forever is worse than a failed edit: the user cannot
    // tell whether to retry, and the bar keeps showing a date bd never took.
    await mount();
    await commit('bd-1', dueOn(3));

    await settle(0, new Error('bd: invalid date'));

    expect([...hook().pending]).toEqual([]);
    expect(toast.messages).toEqual([{ text: 'bd: invalid date', tone: 'error' }]);
  });

  it('sends nothing at all for an edit with nothing to write', async () => {
    await mount();
    await commit('bd-1', { field: 'none', reason: 'unchanged' });

    expect(bridge.calls).toHaveLength(0);
    expect([...hook().pending]).toEqual([]);
  });

  it('writes two edits to one bead in the order they were made', async () => {
    // Fired concurrently, the two writes race inside bd and the later answer
    // may be the earlier edit — the bead would settle on a date the user
    // already moved away from.
    await mount();
    await commit('bd-1', dueOn(3));
    await commit('bd-1', dueOn(5));

    expect(bridge.calls).toHaveLength(1);

    await settle(0);

    expect(bridge.calls).toHaveLength(2);
    expect(bridge.calls[1].method).toBe('setDue');

    await settle(1);

    expect(toast.messages.map((message) => message.text)).toEqual([
      expect.stringContaining('Aug 7'),
      expect.stringContaining('Aug 9'),
    ]);
  });

  it('keeps the bead pending until every queued edit on it has settled', async () => {
    await mount();
    await commit('bd-1', dueOn(3));
    await commit('bd-1', dueOn(5));

    expect([...hook().pending]).toEqual(['bd-1']);

    await settle(0);
    expect([...hook().pending]).toEqual(['bd-1']);

    await settle(1);
    expect([...hook().pending]).toEqual([]);
  });

  it('lets the next queued edit run after the one before it failed', async () => {
    await mount();
    await commit('bd-1', dueOn(3));
    await commit('bd-1', dueOn(5));

    await settle(0, new Error('bd: refused'));

    expect(bridge.calls).toHaveLength(2);

    await settle(1);

    expect([...hook().pending]).toEqual([]);
    expect(toast.messages.map((message) => message.tone)).toEqual(['error', 'info']);
  });

  it('runs edits on different beads at the same time', async () => {
    // Serialising everything would make a multi-bar reschedule as slow as the
    // slowest bd call, one after another.
    await mount();
    await commit('bd-1', dueOn(3));
    await commit('bd-2', dueOn(3));

    expect(bridge.calls.map((call) => call.params.id)).toEqual(['bd-1', 'bd-2']);
    expect([...hook().pending].sort()).toEqual(['bd-1', 'bd-2']);

    await settle(1);

    expect([...hook().pending]).toEqual(['bd-1']);
  });

  it('sends the inverse write when the toast’s Undo is pressed', async () => {
    await mount();
    await commit('bd-1', dueOn(3));
    await settle(0);

    await undo(0);

    expect(bridge.calls).toHaveLength(2);
    // The bar started one day out; Undo must aim at that, not at the drag target.
    expect(bridge.calls[1]).toMatchObject({
      method: 'setDue',
      params: { id: 'bd-1', date: '2026-08-05' },
    });
    // The bead is busy again — the bar must not read as settled while bd works.
    expect([...hook().pending]).toEqual(['bd-1']);

    await settle(1);

    expect([...hook().pending]).toEqual([]);
    expect(toast.messages[1].text).toContain('Aug 7');
    expect(toast.messages[1].text).toContain('Aug 5');
  });

  it('offers no Undo on the undo’s own toast', async () => {
    // Otherwise the same button flips the bead back and forth with nothing on
    // screen saying which of the two dates is now stored.
    await mount();
    await commit('bd-1', dueOn(3));
    await settle(0);
    await undo(0);
    await settle(1);

    expect(toast.messages[1].action).toBeUndefined();
  });

  it('offers no Undo when the edit has no expressible inverse', async () => {
    // An issue with no estimate cannot be put back to having none: bd's
    // --estimate stores a zero rather than clearing the field.
    await mount();
    await commit(unestimated('bd-9'), { field: 'estimate', minutes: 120 });
    await settle(0);

    expect(bridge.calls[0].method).toBe('setEstimate');
    expect(toast.messages[0].action).toBeUndefined();
  });

  it('offers no Undo when the write itself failed', async () => {
    await mount();
    await commit('bd-1', dueOn(3));

    await settle(0, new Error('bd: refused'));

    expect(toast.messages).toEqual([{ text: 'bd: refused', tone: 'error' }]);
  });

  it('queues an undo behind an edit already in flight on the same bead', async () => {
    await mount();
    await commit('bd-1', dueOn(3));
    await settle(0);
    await commit('bd-1', dueOn(5));

    await undo(0);

    // Two writes to one bead must not race inside bd; the undo waits its turn.
    expect(bridge.calls).toHaveLength(2);

    await settle(1);

    expect(bridge.calls).toHaveLength(3);
    expect(bridge.calls[2].params).toMatchObject({ id: 'bd-1', date: '2026-08-05' });
  });

  it('survives the panel closing while a write is still out', async () => {
    // The reply lands on an unmounted tree; React warns loudly about a state
    // update there, and the toast would be for a panel nobody is looking at.
    await mount();
    await commit('bd-1', dueOn(3));

    const settled = bridge.calls[0];
    await act(async () => mounted?.unmount());
    mounted = undefined;

    await act(async () => settled.resolve());

    expect(toast.messages).toHaveLength(1);
  });
});
