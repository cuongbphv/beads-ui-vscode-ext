import { describe, expect, it } from 'vitest';

import { sortGroups, sortTimeline } from '../shared/roadmap-sort';
import type { EpicSpan, Span } from '../shared/schedule';
import type { Bead, EpicGroup } from '../shared/types';

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return { title: partial.id, status: 'open', priority: 2, issue_type: 'task', ...partial };
}

function span(b: Bead, start: number): Span {
  return { bead: b, start, end: start + 1000, kind: 'nominal', overdue: false, deferred: false };
}

function group(epic: Bead, children: Bead[]): EpicGroup {
  return { epic, children, doneCount: 0, totalCount: children.length };
}

function epicSpanOf(epic: Bead, start: number, children: Array<[Bead, number]>): EpicSpan {
  const kids = children.map(([b, s]) => span(b, s));
  return {
    group: group(epic, kids.map((k) => k.bead)),
    own: span(epic, start),
    children: kids,
    start,
    end: start + 5000,
    hasOverdue: false,
  };
}

describe('sortTimeline', () => {
  it('leaves start order and child order alone for the timeline sort', () => {
    const a = epicSpanOf(bead({ id: 'e1', issue_type: 'epic', priority: 4 }), 100, [
      [bead({ id: 't2', priority: 0 }), 20],
      [bead({ id: 't1', priority: 3 }), 10],
    ]);
    const b = epicSpanOf(bead({ id: 'e2', issue_type: 'epic', priority: 0 }), 50, []);

    const out = sortTimeline([a, b], 'timeline');

    expect(out.map((e) => e.group.epic.id)).toEqual(['e2', 'e1']);
    expect(out[1].children.map((c) => c.bead.id)).toEqual(['t2', 't1']);
  });

  it('puts P0 first at both levels for the priority sort', () => {
    const a = epicSpanOf(bead({ id: 'e1', issue_type: 'epic', priority: 3 }), 100, [
      [bead({ id: 't1', priority: 3 }), 10],
      [bead({ id: 't2', priority: 0 }), 20],
    ]);
    const b = epicSpanOf(bead({ id: 'e2', issue_type: 'epic', priority: 0 }), 900, []);

    const out = sortTimeline([a, b], 'priority');

    expect(out.map((e) => e.group.epic.id)).toEqual(['e2', 'e1']);
    expect(out[1].children.map((c) => c.bead.id)).toEqual(['t2', 't1']);
  });

  it('keeps group.children aligned with the reordered spans', () => {
    const a = epicSpanOf(bead({ id: 'e1', issue_type: 'epic' }), 100, [
      [bead({ id: 't1', priority: 3 }), 10],
      [bead({ id: 't2', priority: 0 }), 20],
    ]);

    const out = sortTimeline([a], 'priority');

    expect(out[0].group.children.map((c) => c.id)).toEqual(
      out[0].children.map((c) => c.bead.id),
    );
  });

  it('sorts types alphabetically rather than by a rank table', () => {
    const a = epicSpanOf(bead({ id: 'e1', issue_type: 'epic' }), 0, [
      [bead({ id: 't1', issue_type: 'task' }), 0],
      [bead({ id: 't2', issue_type: 'bug' }), 0],
      [bead({ id: 't3', issue_type: 'aardvark' }), 0],
    ]);

    const out = sortTimeline([a], 'type');

    expect(out[0].children.map((c) => c.bead.id)).toEqual(['t3', 't2', 't1']);
  });

  it('pins the synthetic No epic group last under every sort', () => {
    const real = epicSpanOf(bead({ id: 'e1', issue_type: 'epic', priority: 4 }), 900, []);
    const synthetic = epicSpanOf(
      bead({ id: '__unassigned__', title: 'No epic', issue_type: 'epic', priority: 0 }),
      0,
      [],
    );

    for (const sort of ['timeline', 'priority', 'type'] as const) {
      const out = sortTimeline([synthetic, real], sort);
      expect(out.map((e) => e.group.epic.id)).toEqual(['e1', '__unassigned__']);
    }
  });

  it('breaks ties on id so the order is stable across renders', () => {
    const rows = ['c', 'a', 'b'].map((id) =>
      epicSpanOf(bead({ id, issue_type: 'epic', priority: 2 }), 500, []),
    );

    expect(sortTimeline(rows, 'priority').map((e) => e.group.epic.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const rows = [
      epicSpanOf(bead({ id: 'e2', issue_type: 'epic', priority: 3 }), 0, []),
      epicSpanOf(bead({ id: 'e1', issue_type: 'epic', priority: 0 }), 0, []),
    ];

    sortTimeline(rows, 'priority');

    expect(rows.map((e) => e.group.epic.id)).toEqual(['e2', 'e1']);
  });
});

describe('sortGroups', () => {
  it('returns groupByEpic order untouched for the timeline sort', () => {
    const groups = [
      group(bead({ id: 'e2', issue_type: 'epic', priority: 3 }), []),
      group(bead({ id: 'e1', issue_type: 'epic', priority: 0 }), []),
    ];

    expect(sortGroups(groups, 'timeline').map((g) => g.epic.id)).toEqual(['e2', 'e1']);
  });

  it('sorts epics and children by priority', () => {
    const groups = [
      group(bead({ id: 'e2', issue_type: 'epic', priority: 3 }), [
        bead({ id: 't1', priority: 4 }),
        bead({ id: 't2', priority: 1 }),
      ]),
      group(bead({ id: 'e1', issue_type: 'epic', priority: 0 }), []),
    ];

    const out = sortGroups(groups, 'priority');

    expect(out.map((g) => g.epic.id)).toEqual(['e1', 'e2']);
    expect(out[1].children.map((c) => c.id)).toEqual(['t2', 't1']);
  });
});
