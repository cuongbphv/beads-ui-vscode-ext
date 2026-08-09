/**
 * Row order for the Roadmap.
 *
 * Sorting is presentation only — it never calls bd. It lives in `shared/` and is
 * framework-free so the comparators can be tested without a DOM, and so the
 * Timeline and List shapes cannot quietly disagree about what "by priority" means.
 */
import type { EpicSpan } from './schedule';
import type { Bead, EpicGroup } from './types';

export type RoadmapSort = 'timeline' | 'priority' | 'type';

export const ROADMAP_SORTS: readonly RoadmapSort[] = ['timeline', 'priority', 'type'];

/** The synthetic bucket `groupByEpic` appends for work with no reachable parent. */
const UNASSIGNED = '__unassigned__';

/** A row to be ordered. `start` is absent in the List shape, which has no bars. */
interface Row {
  bead: Bead;
  start?: number;
}

/**
 * The "No epic" bucket is not a real epic — it is a catch-all, and a catch-all
 * that floats to the top of a plan reads as the most important thing in it.
 */
function pinLast(a: Bead, b: Bead): number | undefined {
  const left = a.id === UNASSIGNED;
  const right = b.id === UNASSIGNED;
  if (left === right) return undefined;
  return left ? 1 : -1;
}

function byStart(a: Row, b: Row): number {
  return (a.start ?? 0) - (b.start ?? 0);
}

/**
 * Every comparator terminates in `id`, so the order is total: two rows tying on
 * every other key still land in the same place on every render.
 */
function byKey(sort: RoadmapSort, a: Row, b: Row): number {
  const id = (): number => a.bead.id.localeCompare(b.bead.id);

  if (sort === 'priority') {
    return a.bead.priority - b.bead.priority || byStart(a, b) || id();
  }
  if (sort === 'type') {
    // Alphabetical, never a rank table: beads issue types are user-extensible,
    // so any fixed list would silently mis-sort a project's custom type.
    return (
      a.bead.issue_type.localeCompare(b.bead.issue_type) ||
      a.bead.priority - b.bead.priority ||
      id()
    );
  }
  return byStart(a, b) || id();
}

/** Order the Gantt's epic rows and their bars, preserving the nesting. */
export function sortTimeline(epics: EpicSpan[], sort: RoadmapSort): EpicSpan[] {
  const sorted = [...epics].sort(
    (a, b) =>
      pinLast(a.group.epic, b.group.epic) ??
      byKey(
        sort,
        { bead: a.group.epic, start: a.start },
        { bead: b.group.epic, start: b.start },
      ),
  );

  // `timeline` is the status quo: groupByEpic already ordered the children.
  if (sort === 'timeline') return sorted;

  return sorted.map((epic) => {
    const children = [...epic.children].sort((a, b) =>
      byKey(sort, { bead: a.bead, start: a.start }, { bead: b.bead, start: b.start }),
    );
    // `group.children` is re-derived rather than left behind: anything reading
    // the group must see the same order as the bars, or a rollup and a row will
    // one day disagree about which child is which.
    return { ...epic, children, group: { ...epic.group, children: children.map((c) => c.bead) } };
  });
}

/** The same comparators for the List shape, which has no spans. */
export function sortGroups(groups: EpicGroup[], sort: RoadmapSort): EpicGroup[] {
  if (sort === 'timeline') return groups;

  return [...groups]
    .sort((a, b) => pinLast(a.epic, b.epic) ?? byKey(sort, { bead: a.epic }, { bead: b.epic }))
    .map((group) => ({
      ...group,
      children: [...group.children].sort((a, b) => byKey(sort, { bead: a }, { bead: b })),
    }));
}
