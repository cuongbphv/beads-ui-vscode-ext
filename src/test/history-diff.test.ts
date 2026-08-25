/**
 * `diffHistory`: the pure snapshot-diffing core of the issue history
 * timeline (bead 72m.3).
 *
 * Every case supplies snapshots in bd's own order — newest commit first,
 * verified against a real `bd history --json` call in this worktree — since
 * that is the order `BdQueries.history` hands the array straight through
 * without reordering it.
 */
import { describe, expect, it } from 'vitest';

import { diffHistory, type HistorySnapshot } from '../shared/history-diff';

function snapshot(
  hash: string,
  actor: string,
  at: string,
  issue: HistorySnapshot['issue'],
): HistorySnapshot {
  return { hash, actor, at, issue };
}

describe('diffHistory: value fields', () => {
  it('produces exactly one event for a status change', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', '2026-08-24T12:00:00Z', { status: 'in_progress' }),
      snapshot('c1', 'ana', '2026-08-24T11:00:00Z', { status: 'open' }),
    ]);

    expect(events).toEqual([
      {
        field: 'status',
        kind: 'value',
        from: 'open',
        to: 'in_progress',
        actor: 'ana',
        at: '2026-08-24T12:00:00Z',
      },
    ]);
  });

  it('diffs priority as a stringified number', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { priority: 0 }),
      snapshot('c1', 'ana', 't1', { priority: 2 }),
    ]);

    expect(events).toEqual([
      { field: 'priority', kind: 'value', from: '2', to: '0', actor: 'ana', at: 't2' },
    ]);
  });

  it('reports multiple field changes from the same commit as separate events', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { status: 'in_progress', assignee: 'ana' }),
      snapshot('c1', 'bob', 't1', { status: 'open', assignee: undefined }),
    ]);

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.field).sort()).toEqual(['assignee', 'status']);
    // Both attributed to the commit that produced the new state, not the old one.
    expect(events.every((e) => e.actor === 'ana' && e.at === 't2')).toBe(true);
  });

  it('treats undefined and empty string as the same "unset" value', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { assignee: '' }),
      snapshot('c1', 'ana', 't1', { assignee: undefined }),
    ]);

    expect(events).toEqual([]);
  });
});

describe('diffHistory: labels', () => {
  it('produces one event for a label added and one for a label removed', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { labels: ['ui', 'p1'] }),
      snapshot('c1', 'ana', 't1', { labels: ['ui', 'backend'] }),
    ]);

    expect(events).toHaveLength(2);
    expect(events).toContainEqual({
      field: 'labels',
      kind: 'label-added',
      to: 'p1',
      actor: 'ana',
      at: 't2',
    });
    expect(events).toContainEqual({
      field: 'labels',
      kind: 'label-removed',
      from: 'backend',
      actor: 'ana',
      at: 't2',
    });
  });

  it('produces zero label events when the label set is unchanged, even if reordered', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { labels: ['backend', 'ui'] }),
      snapshot('c1', 'ana', 't1', { labels: ['ui', 'backend'] }),
    ]);

    expect(events).toEqual([]);
  });

  it('treats a missing labels array as an empty set, not a crash', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { labels: ['ui'] }),
      snapshot('c1', 'ana', 't1', {}),
    ]);

    expect(events).toEqual([
      { field: 'labels', kind: 'label-added', to: 'ui', actor: 'ana', at: 't2' },
    ]);
  });
});

describe('diffHistory: long-form text fields', () => {
  it('produces a "changed" event with no from/to for a description edit', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { description: 'new, much longer text' }),
      snapshot('c1', 'ana', 't1', { description: 'old text' }),
    ]);

    expect(events).toEqual([{ field: 'description', kind: 'text-changed', actor: 'ana', at: 't2' }]);
  });

  it('never puts the actual text content on the event', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { design: 'B'.repeat(10_000) }),
      snapshot('c1', 'ana', 't1', { design: 'A'.repeat(10_000) }),
    ]);

    expect(events[0]).not.toHaveProperty('from');
    expect(events[0]).not.toHaveProperty('to');
  });

  it('covers design and acceptance_criteria the same way as description', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { design: 'x', acceptance_criteria: 'y' }),
      snapshot('c1', 'ana', 't1', { design: '', acceptance_criteria: '' }),
    ]);

    expect(events.map((e) => e.field).sort()).toEqual(['acceptance_criteria', 'design']);
  });
});

describe('diffHistory: no-op and boundary commits', () => {
  it('produces zero events for two snapshots with nothing observably different', () => {
    const events = diffHistory([
      snapshot('c2', 'ana', 't2', { status: 'open', title: 'Same title' }),
      snapshot('c1', 'ana', 't1', { status: 'open', title: 'Same title' }),
    ]);

    expect(events).toEqual([]);
  });

  it('handles a single-snapshot window without crashing, producing zero events', () => {
    const events = diffHistory([snapshot('c1', 'ana', 't1', { status: 'open' })]);

    expect(events).toEqual([]);
  });

  it('handles an empty array without crashing', () => {
    expect(diffHistory([])).toEqual([]);
  });

  it('the oldest snapshot in the window never produces a synthetic "created" event', () => {
    // Three snapshots: the oldest (c1) only ever serves as the baseline for
    // the c2/c1 diff; it must not itself generate an event.
    const events = diffHistory([
      snapshot('c3', 'ana', 't3', { status: 'in_progress' }),
      snapshot('c2', 'ana', 't2', { status: 'open' }),
      snapshot('c1', 'ana', 't1', { status: 'open' }),
    ]);

    expect(events).toEqual([
      { field: 'status', kind: 'value', from: 'open', to: 'in_progress', actor: 'ana', at: 't3' },
    ]);
  });
});
