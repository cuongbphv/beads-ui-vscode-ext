import { describe, expect, it } from 'vitest';

import { statusBarContent } from '../extension/status-bar';
import type { StoreState } from '../extension/store';
import type { DashboardSnapshot } from '../shared/types';

/**
 * Just enough of a snapshot for the status bar to read `readyIds` from.
 * Cast rather than filled out in full: the other fields are irrelevant here
 * and `statusBarContent` never touches them.
 */
function snapshot(readyIds: string[]): DashboardSnapshot {
  return {
    beads: [],
    readyIds,
    blockedIds: [],
    truncated: false,
    fetchedAt: '2026-08-18T00:00:00Z',
  } as unknown as DashboardSnapshot;
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
