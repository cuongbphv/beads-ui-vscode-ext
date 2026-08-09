/**
 * What the filter bar is currently hiding, as removable chips.
 *
 * The bar folds its pickers into a popover, so the query is no longer legible
 * from the controls themselves. This module is the readback: one chip per
 * applied filter, and the single place that decides what "applied" means. It
 * has to agree with `filterBeads` — a chip for a filter that narrows nothing
 * lies about the rows on screen, and a filter with no chip is one the user
 * cannot see or undo.
 *
 * Pure and framework-free on purpose: the wording and the removal rules are
 * worth testing without a DOM.
 */
import type { BeadQuery } from '../../shared/model';
import type { Bead } from '../../shared/types';

export type FilterKey = 'epic' | 'type' | 'assignee' | 'priority' | 'closed';

export interface ChipDescriptor {
  key: FilterKey;
  /** The field, e.g. `Epic`. Rendered muted, ahead of the value. */
  label: string;
  /** The current choice, e.g. `Roadmap polish` or `P0–P1`. */
  value: string;
}

/** The chip order, fixed so a chip does not move when a neighbour is removed. */
const ORDER: readonly FilterKey[] = ['epic', 'type', 'assignee', 'priority', 'closed'];

/** The picker's own wording, so a chip never renames the choice that made it. */
function priorityValue(priorityMax: number): string {
  return priorityMax === 0 ? 'P0 only' : `P0–P${priorityMax}`;
}

/**
 * Chips for every applied filter, in `ORDER`.
 *
 * `text` is deliberately absent: the search input is never hidden, so a chip
 * for it would be a second copy of a value the user is already looking at.
 */
export function activeFilters(query: BeadQuery, epics: Bead[]): ChipDescriptor[] {
  const chips = new Map<FilterKey, ChipDescriptor>();

  if (query.epicId) {
    // An epic that has been deleted, or has not loaded yet, still filters the
    // rows — so it still gets a chip, falling back to the raw id. Without it
    // the view would be empty with nothing on screen to undo.
    const epic = epics.find((candidate) => candidate.id === query.epicId);
    chips.set('epic', { key: 'epic', label: 'Epic', value: epic?.title ?? query.epicId });
  }

  // `filterBeads` skips a zero-length array, so an empty one is not a filter.
  if (query.types?.length) {
    chips.set('type', { key: 'type', label: 'Type', value: query.types.join(', ') });
  }

  if (query.assignees?.length) {
    chips.set('assignee', {
      key: 'assignee',
      label: 'Assignee',
      value: query.assignees.join(', '),
    });
  }

  // Compared against `number`, not truthiness: `priorityMax: 0` is the
  // narrowest filter the bar offers and is also falsy.
  if (typeof query.priorityMax === 'number') {
    chips.set('priority', {
      key: 'priority',
      label: 'Priority',
      value: priorityValue(query.priorityMax),
    });
  }

  if (query.includeClosed) {
    chips.set('closed', { key: 'closed', label: 'Closed', value: 'shown' });
  }

  return ORDER.flatMap((key) => chips.get(key) ?? []);
}

/** The badge on the Filters trigger. */
export function activeFilterCount(query: BeadQuery, epics: Bead[]): number {
  return activeFilters(query, epics).length;
}

/** The query with one filter removed and every other field left alone. */
export function clearFilter(query: BeadQuery, key: FilterKey): BeadQuery {
  switch (key) {
    case 'epic':
      return { ...query, epicId: undefined };
    case 'type':
      return { ...query, types: undefined };
    case 'assignee':
      return { ...query, assignees: undefined };
    case 'priority':
      return { ...query, priorityMax: undefined };
    case 'closed':
      return { ...query, includeClosed: false };
  }
}

/**
 * The query with every filter removed.
 *
 * `includeClosed` survives: it is the one choice whose removal *adds* a
 * restriction, and hiding rows the user asked to see is not what "clear"
 * promises. `text` survives for the same reason it has no chip — the input is
 * visible and cleared on its own.
 */
export function clearAllFilters(query: BeadQuery): BeadQuery {
  return { text: query.text, includeClosed: query.includeClosed };
}
