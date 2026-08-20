/**
 * What the Roadmap should open as, and how much it is hiding.
 *
 * A plan whose dates all land inside the same couple of days has no timeline in
 * it — every bar starts and ends in the same pixel column. The tab therefore
 * *opens* as a list in that case, but it never switches shape underneath
 * someone who is already looking at it: the toggle stays, and an explicit
 * choice always wins. Graph is a third shape, but never an inferred one — it
 * is reached only by an explicit pick, never by `defaultShape`.
 */
import { filterBeads, type BeadQuery, type StatusIndex } from '../../shared/model';
import { DAY } from '../../shared/schedule';
import type { Bead } from '../../shared/types';

export type RoadmapShape = 'timeline' | 'list' | 'graph';

/** Below this many days, a Gantt is a stack of identical stubs. */
export const MIN_TIMELINE_DAYS = 7;

/** The shape a window of this length deserves before anyone has chosen. */
export function defaultShape(window: { start: number; end: number }): RoadmapShape {
  return window.end - window.start < MIN_TIMELINE_DAYS * DAY ? 'list' : 'timeline';
}

/** An explicit choice always wins; otherwise the window decides. */
export function resolveShape(
  chosen: RoadmapShape | undefined,
  window: { start: number; end: number },
): RoadmapShape {
  return chosen ?? defaultShape(window);
}

/**
 * How many issues the Roadmap's own "closed hidden" default is keeping out of
 * view. Rendered as a count the user can click, never as a silent filter — a
 * tab that quietly shows less than the one beside it is how a dashboard loses
 * the user's trust.
 */
export function hiddenClosedCount(beads: Bead[], query: BeadQuery, index: StatusIndex): number {
  if (query.includeClosed) return 0;
  const withClosed = filterBeads(beads, { ...query, includeClosed: true }, index).length;
  const withoutClosed = filterBeads(beads, { ...query, includeClosed: false }, index).length;
  return Math.max(0, withClosed - withoutClosed);
}
