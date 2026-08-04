/**
 * How much chart a dataset has earned.
 *
 * A two-day-old workspace draws a burn-up as one flat line across a full-height
 * card, and a workload chart as a single `unassigned` bar. Both are technically
 * correct and tell you nothing, and *every* fresh install starts there — so the
 * decision to shrink or drop a chart is data, computed here and tested, not a
 * conditional buried in the render.
 */
import type { StatusIndex } from '../../shared/model';
import type { Bead } from '../../shared/types';

const DAY = 86_400_000;

/** Below this many days of closing activity a burn-up has no shape to show. */
export const BURNUP_MIN_DAYS = 7;

/** A workload split needs at least two people to be a split at all. */
export const WORKLOAD_MIN_ASSIGNEES = 2;

export interface BurnUpDensity {
  /** `empty`: nothing closed. `sparkline`: too short to plot. `full`: draw it. */
  mode: 'empty' | 'sparkline' | 'full';
  /** Days from the first close to the last, inclusive. 0 when nothing is closed. */
  spanDays: number;
  closed: number;
  total: number;
}

/**
 * `spanDays` counts calendar days inclusively: everything closed in one sitting
 * spans 1 day, not 0, so the threshold reads the way it is written.
 */
export function burnUpDensity(beads: Bead[], index: StatusIndex): BurnUpDensity {
  const days = closedDays(beads, index);
  const total = beads.length;
  const closed = beads.filter((bead) => index.isDone(bead.status) && bead.closed_at).length;

  if (days.length === 0) return { mode: 'empty', spanDays: 0, closed: 0, total };

  const spanDays = Math.round((days[days.length - 1] - days[0]) / DAY) + 1;
  return { mode: spanDays < BURNUP_MIN_DAYS ? 'sparkline' : 'full', spanDays, closed, total };
}

/** Local midnights on which something was closed → how many, ascending. */
function closesByDay(beads: Bead[], index: StatusIndex): Array<[day: number, count: number]> {
  const byDay = new Map<number, number>();
  for (const bead of beads) {
    if (!index.isDone(bead.status) || !bead.closed_at) continue;
    const at = Date.parse(bead.closed_at);
    if (Number.isNaN(at)) continue;
    const day = new Date(at).setHours(0, 0, 0, 0);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]);
}

function closedDays(beads: Bead[], index: StatusIndex): number[] {
  return closesByDay(beads, index).map(([day]) => day);
}

export interface BurnUpPoint {
  /** Local midnight. */
  day: number;
  /** Issues closed on or before that day. */
  closed: number;
}

/**
 * Cumulative closes per day.
 *
 * Two shaping decisions live here rather than in the chart: a zero anchor the
 * day before the first close, so a project that finished everything in one
 * sitting draws a line instead of a single invisible point, and a flat carry to
 * today, so a stalled project reads as "and nothing since".
 */
export function burnUpSeries(beads: Bead[], index: StatusIndex, now = Date.now()): BurnUpPoint[] {
  const perDay = closesByDay(beads, index);
  if (perDay.length === 0) return [];

  let running = 0;
  const points = perDay.map(([day, count]) => {
    running += count;
    return { day, closed: running };
  });

  const today = new Date(now).setHours(0, 0, 0, 0);
  return [
    { day: points[0].day - DAY, closed: 0 },
    ...points,
    ...(points[points.length - 1].day < today ? [{ day: today, closed: running }] : []),
  ];
}

export interface WorkloadDensity {
  /** `chart` only once the work is actually distributed across people. */
  mode: 'chart' | 'solo' | 'unowned' | 'idle';
  /** Named people carrying open work. `unassigned` is not a person. */
  assignees: string[];
  /** Open issues with no PIC. */
  unassigned: number;
  /** Open issues in total. */
  open: number;
}

/**
 * The three degenerate cases each get their own mode, because they call for
 * three different sentences: nothing open, nobody assigned, or one person
 * holding all of it.
 */
export function workloadDensity(beads: Bead[], index: StatusIndex): WorkloadDensity {
  const named = new Set<string>();
  let unassigned = 0;
  let open = 0;

  for (const bead of beads) {
    if (index.isDone(bead.status)) continue;
    open += 1;
    const assignee = bead.assignee?.trim();
    if (assignee) named.add(assignee);
    else unassigned += 1;
  }

  const assignees = [...named].sort((a, b) => a.localeCompare(b));
  const mode: WorkloadDensity['mode'] =
    open === 0
      ? 'idle'
      : assignees.length >= WORKLOAD_MIN_ASSIGNEES
        ? 'chart'
        : assignees.length === 0
          ? 'unowned'
          : 'solo';

  return { mode, assignees, unassigned, open };
}
