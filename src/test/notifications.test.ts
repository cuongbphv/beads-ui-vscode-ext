import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

import { createBeadsNotifier, decideNotifications, type NotificationsMode } from '../extension/notifications';
import type { StoreState } from '../extension/store';
import type { Bead, BdGate, DashboardSnapshot } from '../shared/types';

/**
 * Just enough of a snapshot for `decideNotifications` to read `gates`,
 * `blockedIds` and `beads` from. Cast rather than filled out in full: the
 * other fields (`context`, `vocabulary`, `stats`, …) are irrelevant here,
 * mirroring `status-bar.test.ts`'s `snapshot()` helper.
 */
function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    beads: [],
    readyIds: [],
    blockedIds: [],
    gates: [],
    truncated: false,
    fetchedAt: '2026-08-24T00:00:00Z',
    ...overrides,
  } as unknown as DashboardSnapshot;
}

function gate(id: string, awaitType: BdGate['await_type'] = 'human'): BdGate {
  return { id, title: `Gate ${id}`, status: 'open', priority: 2, issue_type: 'gate', await_type: awaitType };
}

function bead(id: string, overrides: Partial<Bead> = {}): Bead {
  return { id, title: `Issue ${id}`, status: 'open', priority: 2, issue_type: 'task', ...overrides };
}

const NO_NOTIFIED = new Set<string>();

describe('decideNotifications', () => {
  it('never toasts on the baseline snapshot (prev undefined), even with open gates', () => {
    const next = snapshot({ gates: [gate('g1')] });

    expect(decideNotifications(undefined, next, 'me', 'gates-and-blocked', NO_NOTIFIED)).toEqual([]);
  });

  it('never toasts when mode is off, regardless of what changed', () => {
    const prev = snapshot();
    const next = snapshot({
      gates: [gate('g1')],
      blockedIds: ['b1'],
      beads: [bead('b1', { assignee: 'me' })],
    });

    expect(decideNotifications(prev, next, 'me', 'off', NO_NOTIFIED)).toEqual([]);
  });

  it('fires once when a single human gate opens', () => {
    const prev = snapshot({ gates: [] });
    const next = snapshot({ gates: [gate('g1')] });

    const decisions = decideNotifications(prev, next, 'me', 'gates', NO_NOTIFIED);

    expect(decisions).toEqual([
      { kind: 'gate-opened', ids: ['g1'], message: '1 gate needs you.' },
    ]);
  });

  it('stays silent when the same gate is present in both snapshots (not new)', () => {
    const prev = snapshot({ gates: [gate('g1')] });
    const next = snapshot({ gates: [gate('g1')] });

    expect(decideNotifications(prev, next, 'me', 'gates', NO_NOTIFIED)).toEqual([]);
  });

  it('ignores timer and CI gates opening — only human gates notify', () => {
    const prev = snapshot({ gates: [] });
    const next = snapshot({ gates: [gate('g1', 'timer'), gate('g2', 'gh:pr'), gate('g3', 'gh:run')] });

    expect(decideNotifications(prev, next, 'me', 'gates', NO_NOTIFIED)).toEqual([]);
  });

  it('coalesces multiple gates opening in the same tick into one message', () => {
    const prev = snapshot({ gates: [] });
    const next = snapshot({ gates: [gate('g1'), gate('g2'), gate('g3')] });

    const decisions = decideNotifications(prev, next, 'me', 'gates', NO_NOTIFIED);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'gate-opened', message: '3 gates need you.' });
    expect(decisions[0].ids.sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it('never re-notifies a gate id already in alreadyNotified, even though it looks new', () => {
    const prev = snapshot({ gates: [] });
    const next = snapshot({ gates: [gate('g1'), gate('g2')] });
    const alreadyNotified = new Set(['g1']);

    const decisions = decideNotifications(prev, next, 'me', 'gates', alreadyNotified);

    expect(decisions).toEqual([{ kind: 'gate-opened', ids: ['g2'], message: '1 gate needs you.' }]);
  });

  it('stops entirely once every open gate has already been notified', () => {
    const prev = snapshot({ gates: [] });
    const next = snapshot({ gates: [gate('g1')] });
    const alreadyNotified = new Set(['g1']);

    expect(decideNotifications(prev, next, 'me', 'gates', alreadyNotified)).toEqual([]);
  });

  it('fires when an issue assigned to me becomes blocked, in gates-and-blocked mode', () => {
    const prev = snapshot({ blockedIds: [], beads: [bead('b1', { assignee: 'me' })] });
    const next = snapshot({ blockedIds: ['b1'], beads: [bead('b1', { assignee: 'me' })] });

    const decisions = decideNotifications(prev, next, 'me', 'gates-and-blocked', NO_NOTIFIED);

    expect(decisions).toEqual([{ kind: 'own-blocked', ids: ['b1'], message: 'Issue b1 is now blocked.' }]);
  });

  it('also fires when the newly blocked issue names me as owner, not assignee', () => {
    const prev = snapshot({ blockedIds: [], beads: [bead('b1', { owner: 'me' })] });
    const next = snapshot({ blockedIds: ['b1'], beads: [bead('b1', { owner: 'me' })] });

    const decisions = decideNotifications(prev, next, 'me', 'gates-and-blocked', NO_NOTIFIED);

    expect(decisions).toEqual([{ kind: 'own-blocked', ids: ['b1'], message: 'Issue b1 is now blocked.' }]);
  });

  it('coalesces multiple newly-blocked issues assigned to me into one message', () => {
    const prev = snapshot({ blockedIds: [], beads: [bead('b1', { assignee: 'me' }), bead('b2', { assignee: 'me' })] });
    const next = snapshot({
      blockedIds: ['b1', 'b2'],
      beads: [bead('b1', { assignee: 'me' }), bead('b2', { assignee: 'me' })],
    });

    const decisions = decideNotifications(prev, next, 'me', 'gates-and-blocked', NO_NOTIFIED);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'own-blocked', message: '2 of your issues are now blocked.' });
    expect(decisions[0].ids.sort()).toEqual(['b1', 'b2']);
  });

  it('stays silent for a newly-blocked issue assigned to somebody else', () => {
    const prev = snapshot({ blockedIds: [], beads: [bead('b1', { assignee: 'someone-else' })] });
    const next = snapshot({ blockedIds: ['b1'], beads: [bead('b1', { assignee: 'someone-else' })] });

    expect(decideNotifications(prev, next, 'me', 'gates-and-blocked', NO_NOTIFIED)).toEqual([]);
  });

  it('stays silent when a bead already blocked in prev stays blocked (not newly blocked)', () => {
    const prev = snapshot({ blockedIds: ['b1'], beads: [bead('b1', { assignee: 'me' })] });
    const next = snapshot({ blockedIds: ['b1'], beads: [bead('b1', { assignee: 'me' })] });

    expect(decideNotifications(prev, next, 'me', 'gates-and-blocked', NO_NOTIFIED)).toEqual([]);
  });

  it('never fires own-blocked when mode is only "gates"', () => {
    const prev = snapshot({ blockedIds: [], beads: [bead('b1', { assignee: 'me' })] });
    const next = snapshot({ blockedIds: ['b1'], beads: [bead('b1', { assignee: 'me' })] });

    expect(decideNotifications(prev, next, 'me', 'gates', NO_NOTIFIED)).toEqual([]);
  });

  it('never fires own-blocked when there is no resolved identity', () => {
    const prev = snapshot({ blockedIds: [], beads: [bead('b1', { assignee: 'me' })] });
    const next = snapshot({ blockedIds: ['b1'], beads: [bead('b1', { assignee: 'me' })] });

    expect(decideNotifications(prev, next, undefined, 'gates-and-blocked', NO_NOTIFIED)).toEqual([]);
  });

  it('can fire a gate decision and an own-blocked decision in the same tick, as two entries', () => {
    const prev = snapshot({ gates: [], blockedIds: [], beads: [bead('b1', { assignee: 'me' })] });
    const next = snapshot({
      gates: [gate('g1')],
      blockedIds: ['b1'],
      beads: [bead('b1', { assignee: 'me' })],
    });

    const decisions = decideNotifications(prev, next, 'me', 'gates-and-blocked', NO_NOTIFIED);

    expect(decisions).toHaveLength(2);
    expect(decisions.map((d) => d.kind).sort()).toEqual(['gate-opened', 'own-blocked']);
  });
});

/** A fake `vscode` namespace just capable enough to drive `createBeadsNotifier`. */
function fakeVscodeApi(notificationsMode: NotificationsMode) {
  const showInformationMessage = vi.fn().mockResolvedValue(undefined);
  const showWarningMessage = vi.fn().mockResolvedValue(undefined);
  const api = {
    window: { showInformationMessage, showWarningMessage },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn(() => notificationsMode),
      })),
    },
  } as unknown as typeof vscode;
  return { api, showInformationMessage, showWarningMessage };
}

/** A store double exposing just the surface `createBeadsNotifier` reads. */
function fakeStore(initial: StoreState) {
  let listener: ((state: StoreState) => void) | undefined;
  const state = { current: initial };
  return {
    store: {
      get current(): StoreState {
        return state.current;
      },
      onDidChange: vi.fn((fn: (state: StoreState) => void) => {
        listener = fn;
        return { dispose: vi.fn() };
      }),
    },
    fire: (next: StoreState) => {
      state.current = next;
      listener?.(next);
    },
  };
}

describe('createBeadsNotifier wiring', () => {
  it('never shows a toast when beadsDashboard.notifications is off, even when a gate opens', () => {
    const { api, showInformationMessage } = fakeVscodeApi('off');
    const { store, fire } = fakeStore({ snapshot: snapshot({ gates: [] }), loading: false });
    createBeadsNotifier(store, api, { getIdentity: () => 'me', openDashboard: vi.fn() });

    fire({ snapshot: snapshot({ gates: [gate('g1')] }), loading: false });

    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('treats whatever snapshot is already on the store at wiring time as the baseline', () => {
    const { api, showInformationMessage } = fakeVscodeApi('gates');
    const baseline = snapshot({ gates: [gate('g1')] });
    const { store, fire } = fakeStore({ snapshot: baseline, loading: false });
    createBeadsNotifier(store, api, { getIdentity: () => 'me', openDashboard: vi.fn() });

    // Re-fires the same baseline gate set — must not be treated as new.
    fire({ snapshot: snapshot({ gates: [gate('g1')] }), loading: false });

    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('shows an information toast when a gate opens, with Open Dashboard / Show issue actions', () => {
    const { api, showInformationMessage } = fakeVscodeApi('gates');
    const { store, fire } = fakeStore({ snapshot: snapshot({ gates: [] }), loading: false });
    createBeadsNotifier(store, api, { getIdentity: () => 'me', openDashboard: vi.fn() });

    fire({ snapshot: snapshot({ gates: [gate('g1')] }), loading: false });

    expect(showInformationMessage).toHaveBeenCalledWith('1 gate needs you.', 'Open Dashboard', 'Show issue');
  });

  it('"Show issue" opens the dashboard focused on the affected issue', async () => {
    const { api } = fakeVscodeApi('gates');
    api.window.showInformationMessage = vi.fn().mockResolvedValue('Show issue');
    const { store, fire } = fakeStore({ snapshot: snapshot({ gates: [] }), loading: false });
    const openDashboard = vi.fn();
    createBeadsNotifier(store, api, { getIdentity: () => 'me', openDashboard });

    fire({ snapshot: snapshot({ gates: [gate('g1')] }), loading: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(openDashboard).toHaveBeenCalledWith('g1');
  });

  it('shows a warning toast (not information) for an own-blocked decision', () => {
    const { api, showWarningMessage, showInformationMessage } = fakeVscodeApi('gates-and-blocked');
    const { store, fire } = fakeStore({
      snapshot: snapshot({ blockedIds: [], beads: [bead('b1', { assignee: 'me' })] }),
      loading: false,
    });
    createBeadsNotifier(store, api, { getIdentity: () => 'me', openDashboard: vi.fn() });

    fire({
      snapshot: snapshot({ blockedIds: ['b1'], beads: [bead('b1', { assignee: 'me' })] }),
      loading: false,
    });

    expect(showWarningMessage).toHaveBeenCalledWith('Issue b1 is now blocked.', 'Open Dashboard', 'Show issue');
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('ignores state changes that carry no snapshot (e.g. a bare loading flip)', () => {
    const { api, showInformationMessage } = fakeVscodeApi('gates');
    const { store, fire } = fakeStore({ snapshot: snapshot({ gates: [] }), loading: false });
    createBeadsNotifier(store, api, { getIdentity: () => 'me', openDashboard: vi.fn() });

    fire({ snapshot: undefined, loading: true });

    expect(showInformationMessage).not.toHaveBeenCalled();
  });
});
