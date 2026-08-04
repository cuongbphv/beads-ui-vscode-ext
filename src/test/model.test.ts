import { describe, expect, it } from 'vitest';

import {
  StatusIndex,
  buildColumns,
  filterBeads,
  groupByEpic,
  parentIdOf,
  progressOf,
} from '../shared/model';
import type { Bead, StatusDef } from '../shared/types';

/** The vocabulary bd 1.1.2 reports, plus a project-defined status. */
const STATUSES: StatusDef[] = [
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'blocked', category: 'wip' },
  { name: 'deferred', category: 'frozen' },
  { name: 'closed', category: 'done' },
  { name: 'pinned', category: 'frozen' },
  { name: 'hooked', category: 'wip' },
  { name: 'in_review', category: 'wip', custom: true },
];

const index = new StatusIndex(STATUSES);

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return {
    title: partial.id,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...partial,
  };
}

describe('StatusIndex', () => {
  it('resolves a custom status through its category', () => {
    expect(index.category('in_review')).toBe('wip');
  });

  it('treats an unknown status as unspecified rather than guessing', () => {
    expect(index.category('nonsense')).toBe('unspecified');
  });

  it('lists every status in a category, custom ones included', () => {
    expect(index.namesIn('wip')).toEqual(['in_progress', 'blocked', 'hooked', 'in_review']);
  });
});

describe('groupByEpic', () => {
  const beads = [
    bead({ id: 'e1', issue_type: 'epic', title: 'Epic one', priority: 1 }),
    bead({ id: 't1', parent: 'e1', status: 'closed' }),
    bead({ id: 't2', parent: 'e1' }),
    bead({ id: 'orphan' }),
  ];

  it('hangs tasks under their epic and counts progress by category', () => {
    const groups = groupByEpic(beads, index);
    const epic = groups.find((group) => group.epic.id === 'e1');

    expect(epic?.children.map((child) => child.id).sort()).toEqual(['t1', 't2']);
    expect(epic?.doneCount).toBe(1);
    expect(epic?.totalCount).toBe(2);
    expect(progressOf(epic!)).toBe(50);
  });

  it('surfaces parentless issues instead of dropping them', () => {
    const groups = groupByEpic(beads, index);
    const loose = groups.find((group) => group.epic.id === '__unassigned__');

    expect(loose?.children.map((child) => child.id)).toEqual(['orphan']);
  });

  it('keeps a child visible when its epic is not in the list', () => {
    const groups = groupByEpic([bead({ id: 't9', parent: 'missing-epic' })], index);

    expect(groups).toHaveLength(1);
    expect(groups[0].children[0].id).toBe('t9');
  });

  it('reads the parent from the dependency edge when bd omits the parent field', () => {
    const child = bead({
      id: 't3',
      dependencies: [{ issue_id: 't3', depends_on_id: 'e1', type: 'parent-child' }],
    });

    expect(parentIdOf(child)).toBe('e1');
  });

  it('ignores non parent-child edges when resolving hierarchy', () => {
    const child = bead({
      id: 't4',
      dependencies: [{ issue_id: 't4', depends_on_id: 't1', type: 'blocks' }],
    });

    expect(parentIdOf(child)).toBeUndefined();
  });
});

describe('buildColumns', () => {
  it('derives columns from categories, folding a custom status into one', () => {
    const columns = buildColumns(
      [
        bead({ id: 'a', status: 'open' }),
        bead({ id: 'b', status: 'in_review' }),
        bead({ id: 'c', status: 'in_progress' }),
        bead({ id: 'd', status: 'closed' }),
      ],
      index,
    );

    expect(columns.map((column) => column.category)).toEqual(['active', 'wip', 'frozen', 'done']);
    expect(columns.find((column) => column.category === 'wip')?.beads.map((b) => b.id)).toEqual([
      'b',
      'c',
    ]);
  });

  it('still shows an issue whose status bd never declared', () => {
    const columns = buildColumns([bead({ id: 'x', status: 'invented' })], index);
    const other = columns.find((column) => column.category === 'unspecified');

    expect(other?.beads.map((b) => b.id)).toEqual(['x']);
  });

  it('orders cards by priority, then most recently updated', () => {
    const columns = buildColumns(
      [
        bead({ id: 'low', priority: 3, updated_at: '2026-01-03T00:00:00Z' }),
        bead({ id: 'old-high', priority: 0, updated_at: '2026-01-01T00:00:00Z' }),
        bead({ id: 'new-high', priority: 0, updated_at: '2026-01-02T00:00:00Z' }),
      ],
      index,
    );

    expect(columns[0].beads.map((b) => b.id)).toEqual(['new-high', 'old-high', 'low']);
  });
});

describe('filterBeads', () => {
  const beads = [
    bead({ id: 'bd-1', title: 'Fix the parser', issue_type: 'bug', assignee: 'ana', priority: 0 }),
    bead({ id: 'bd-2', title: 'Ship the board', labels: ['ui'], priority: 3 }),
    bead({ id: 'bd-3', title: 'Old work', status: 'closed' }),
  ];

  it('hides closed issues unless asked', () => {
    expect(filterBeads(beads, {}, index).map((b) => b.id)).toEqual(['bd-1', 'bd-2']);
    expect(filterBeads(beads, { includeClosed: true }, index)).toHaveLength(3);
  });

  it('matches id, title and labels case-insensitively', () => {
    expect(filterBeads(beads, { text: 'PARSER' }, index).map((b) => b.id)).toEqual(['bd-1']);
    expect(filterBeads(beads, { text: 'ui' }, index).map((b) => b.id)).toEqual(['bd-2']);
    expect(filterBeads(beads, { text: 'bd-2' }, index).map((b) => b.id)).toEqual(['bd-2']);
  });

  it('treats priorityMax as "this urgent or more"', () => {
    expect(filterBeads(beads, { priorityMax: 0 }, index).map((b) => b.id)).toEqual(['bd-1']);
  });

  it('filters by type and assignee', () => {
    expect(filterBeads(beads, { types: ['bug'] }, index).map((b) => b.id)).toEqual(['bd-1']);
    expect(filterBeads(beads, { assignees: ['ana'] }, index).map((b) => b.id)).toEqual(['bd-1']);
  });
});
