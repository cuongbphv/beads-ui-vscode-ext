import { describe, expect, it } from 'vitest';

import type { BeadQuery } from '../shared/model';
import type { Bead } from '../shared/types';
import {
  activeFilterCount,
  activeFilters,
  clearAllFilters,
  clearFilter,
} from '../webview/lib/filter-chips';

const epics: Bead[] = [
  { id: 'epic-1', title: 'Roadmap polish', status: 'open', priority: 1, issue_type: 'epic' },
  { id: 'epic-2', title: 'Board polish', status: 'open', priority: 2, issue_type: 'epic' },
];

describe('activeFilters', () => {
  it('returns nothing for a query that filters nothing', () => {
    expect(activeFilters({}, epics)).toEqual([]);
  });

  it('leaves the search text out — the input already shows its own value', () => {
    // A chip for `text` would be a second, desynchronisable copy of a control
    // that is never hidden.
    expect(activeFilters({ text: 'auth' }, epics)).toEqual([]);
  });

  it('names the epic by title, not by id', () => {
    expect(activeFilters({ epicId: 'epic-2' }, epics)).toEqual([
      { key: 'epic', label: 'Epic', value: 'Board polish' },
    ]);
  });

  it('still describes an epic filter whose epic is gone', () => {
    // A filter pointing at a deleted or not-yet-loaded epic hides every row and
    // would be unremovable if it produced no chip.
    expect(activeFilters({ epicId: 'epic-404' }, epics)).toEqual([
      { key: 'epic', label: 'Epic', value: 'epic-404' },
    ]);
  });

  it('joins multi-valued type and assignee filters', () => {
    // `filterBeads` accepts arrays, so one chip has to speak for all of them.
    expect(activeFilters({ types: ['bug', 'task'], assignees: ['ana'] }, epics)).toEqual([
      { key: 'type', label: 'Type', value: 'bug, task' },
      { key: 'assignee', label: 'Assignee', value: 'ana' },
    ]);
  });

  it('ignores array filters that are present but empty', () => {
    // `filterBeads` skips a zero-length array, so a chip claiming otherwise
    // would report a filter that is not being applied.
    expect(activeFilters({ types: [], assignees: [] }, epics)).toEqual([]);
  });

  it('renders the priority ceiling the way the picker words it', () => {
    expect(activeFilters({ priorityMax: 0 }, epics)[0]?.value).toBe('P0 only');
    expect(activeFilters({ priorityMax: 2 }, epics)[0]?.value).toBe('P0–P2');
  });

  it('treats a P0 ceiling as an applied filter', () => {
    // `priorityMax: 0` is falsy; a truthiness check would silently drop the
    // narrowest filter in the bar.
    expect(activeFilters({ priorityMax: 0 }, epics)).toHaveLength(1);
  });

  it('chips the closed toggle only when closed issues are being shown', () => {
    expect(activeFilters({ includeClosed: true }, epics)).toEqual([
      { key: 'closed', label: 'Closed', value: 'shown' },
    ]);
    expect(activeFilters({ includeClosed: false }, epics)).toEqual([]);
  });

  it('orders chips epic, type, assignee, priority, closed regardless of key order', () => {
    // Chip positions must not shuffle as filters are toggled on and off.
    const query: BeadQuery = {
      includeClosed: true,
      priorityMax: 1,
      assignees: ['ana'],
      types: ['bug'],
      epicId: 'epic-1',
    };

    expect(activeFilters(query, epics).map((chip) => chip.key)).toEqual([
      'epic',
      'type',
      'assignee',
      'priority',
      'closed',
    ]);
  });
});

describe('activeFilterCount', () => {
  it('counts every applied filter', () => {
    const query: BeadQuery = { epicId: 'epic-1', types: ['bug'], includeClosed: true };
    expect(activeFilterCount(query, epics)).toBe(3);
  });

  it('does not count the search text', () => {
    expect(activeFilterCount({ text: 'auth' }, epics)).toBe(0);
  });
});

describe('clearFilter', () => {
  const full: BeadQuery = {
    text: 'auth',
    epicId: 'epic-1',
    types: ['bug'],
    assignees: ['ana'],
    priorityMax: 1,
    includeClosed: true,
  };

  it('removes only the named filter', () => {
    expect(clearFilter(full, 'type')).toEqual({
      text: 'auth',
      epicId: 'epic-1',
      types: undefined,
      assignees: ['ana'],
      priorityMax: 1,
      includeClosed: true,
    });
  });

  it('keeps the search text when a filter is removed', () => {
    // Removing a chip must not empty the input the user is typing in.
    expect(clearFilter(full, 'epic').text).toBe('auth');
  });

  it('turns the closed chip back into a hidden-closed query', () => {
    expect(clearFilter(full, 'closed').includeClosed).toBe(false);
  });

  it('clears a P0 ceiling rather than leaving it at zero', () => {
    expect(clearFilter(full, 'priority').priorityMax).toBeUndefined();
  });
});

describe('clearAllFilters', () => {
  it('drops every filter but keeps the text and the closed choice', () => {
    // Clearing filters must not also hide rows the user asked to see: that
    // would be a second, unrequested change hiding behind one click.
    const query: BeadQuery = {
      text: 'auth',
      epicId: 'epic-1',
      types: ['bug'],
      assignees: ['ana'],
      priorityMax: 1,
      includeClosed: true,
    };

    expect(clearAllFilters(query)).toEqual({ text: 'auth', includeClosed: true });
  });

  it('leaves only the closed chip standing', () => {
    const query: BeadQuery = { epicId: 'epic-1', includeClosed: true };
    expect(activeFilters(clearAllFilters(query), epics)).toEqual([
      { key: 'closed', label: 'Closed', value: 'shown' },
    ]);
  });
});
