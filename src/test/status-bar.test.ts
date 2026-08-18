import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

import { createBeadsStatusBar, statusBarContent } from '../extension/status-bar';
import type { StoreState } from '../extension/store';
import type { BdGate, DashboardSnapshot } from '../shared/types';

/**
 * Just enough of a snapshot for the status bar to read `readyIds` from.
 * Cast rather than filled out in full: the other fields are irrelevant here
 * and `statusBarContent` never touches them.
 */
function snapshot(readyIds: string[], gates: BdGate[] = []): DashboardSnapshot {
  return {
    beads: [],
    readyIds,
    blockedIds: [],
    gates,
    truncated: false,
    fetchedAt: '2026-08-18T00:00:00Z',
  } as unknown as DashboardSnapshot;
}

function gate(id: string, awaitType: BdGate['await_type']): BdGate {
  return { id, title: `Gate: ${awaitType}`, status: 'open', priority: 2, issue_type: 'gate', await_type: awaitType };
}

/** A fake `vscode` namespace just capable enough to drive `createBeadsStatusBar`. */
function fakeVscodeApi() {
  const item = { text: '', tooltip: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
  const api = {
    window: { createStatusBarItem: vi.fn(() => item) },
    StatusBarAlignment: { Left: 1 },
  } as unknown as typeof vscode;
  return { api, item };
}

/** A store double exposing just the surface `createBeadsStatusBar` reads. */
function fakeStore(state: StoreState): {
  current: StoreState;
  onDidChange: (listener: (state: StoreState) => void) => vscode.Disposable;
} {
  return { current: state, onDidChange: vi.fn(() => ({ dispose: vi.fn() })) };
}

describe('statusBarContent', () => {
  it('shows the ready count from the snapshot', () => {
    const state: StoreState = { snapshot: snapshot(['a', 'b', 'c']), loading: false };

    const content = statusBarContent(state);

    expect(content?.text).toBe('$(dashboard) 3 ready');
  });

  it('appends a gate count when gates are open', () => {
    const state: StoreState = { snapshot: snapshot(['a']), loading: false };

    const content = statusBarContent(state, ['gate-1', 'gate-2']);

    expect(content?.text).toBe('$(dashboard) 1 ready · $(shield) 2');
  });

  it('omits the gate segment when there are zero open gates', () => {
    const state: StoreState = { snapshot: snapshot(['a']), loading: false };

    const content = statusBarContent(state, []);

    expect(content?.text).toBe('$(dashboard) 1 ready');
  });

  it('shows a warning glyph with the error message when bd fails', () => {
    const state: StoreState = {
      error: { kind: 'bd-not-found', message: '`bd` was not found on PATH.' },
      loading: false,
    };

    const content = statusBarContent(state);

    expect(content?.text).toBe('$(warning) Beads');
    expect(content?.tooltip).toContain('`bd` was not found on PATH.');
  });

  it('prefers the warning over a stale snapshot so a failure never looks like a count', () => {
    const state: StoreState = {
      snapshot: snapshot(['a', 'b']),
      error: { kind: 'bd-error', message: 'bd refused: unknown status "bogus"' },
      loading: false,
    };

    const content = statusBarContent(state);

    expect(content?.text).toBe('$(warning) Beads');
  });

  it('keeps the last count on screen while a refresh is in flight', () => {
    const state: StoreState = { snapshot: snapshot(['a', 'b']), loading: true };

    const content = statusBarContent(state);

    expect(content?.text).toBe('$(dashboard) 2 ready');
  });

  it('returns undefined when there is no snapshot and no error to show', () => {
    const state: StoreState = { loading: true };

    expect(statusBarContent(state)).toBeUndefined();
  });
});

describe('createBeadsStatusBar', () => {
  it('counts only human gates from the live snapshot, not timer/gh gates', () => {
    const { api, item } = fakeVscodeApi();
    const state: StoreState = {
      snapshot: snapshot(['a'], [gate('g1', 'human'), gate('g2', 'timer'), gate('g3', 'human')]),
      loading: false,
    };
    createBeadsStatusBar(fakeStore(state), api);

    expect(item.text).toBe('$(dashboard) 1 ready · $(shield) 2');
  });

  it('omits the gate segment when no gate on the snapshot is a human gate', () => {
    const { api, item } = fakeVscodeApi();
    const state: StoreState = {
      snapshot: snapshot(['a'], [gate('g1', 'timer')]),
      loading: false,
    };
    createBeadsStatusBar(fakeStore(state), api);

    expect(item.text).toBe('$(dashboard) 1 ready');
  });
});
