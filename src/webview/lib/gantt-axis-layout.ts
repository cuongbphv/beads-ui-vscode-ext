/**
 * Pure layout math for the Gantt's date axis and today marker.
 *
 * `gantt-axis.tsx` renders a sticky header row and a gridline overlay, but the
 * decisions underneath them — where a tick sits, where "today" sits, and
 * whether "today" is even inside the window — are ordinary arithmetic that
 * has no business needing a DOM to test. Extracted here so that arithmetic is
 * exercised directly, and the component is left with nothing but JSX.
 */
import { placement, type Timeline } from '../../shared/schedule';
import { shortDate } from './utils';

export interface AxisTick {
  at: number;
  label: string;
  major: boolean;
  /** Horizontal position within the track, as a percentage. */
  left: number;
}

/**
 * Every tick's horizontal position, in the timeline's own order.
 *
 * A tick has no width — it marks an instant — so its position is `placement`
 * applied to a zero-length span at that instant.
 */
export function axisTicks(timeline: Timeline): AxisTick[] {
  return timeline.ticks.map((tick) => ({
    at: tick.at,
    label: tick.label,
    major: tick.major,
    left: placement({ start: tick.at, end: tick.at }, timeline).left,
  }));
}

export interface TodayMarker {
  /** Horizontal position within the track, as a percentage. */
  left: number;
  /** False once "now" falls outside the padded start/end window. */
  withinWindow: boolean;
}

/** Where "today" lands on the track, and whether it is inside the window at all. */
export function todayMarker(timeline: Timeline): TodayMarker {
  return {
    left: placement({ start: timeline.now, end: timeline.now }, timeline).left,
    withinWindow: timeline.now >= timeline.start && timeline.now <= timeline.end,
  };
}

/** The sticky corner cell's label: the window's start and end dates. */
export function windowLabel(timeline: Timeline): string {
  return `${shortDate(timeline.start)} → ${shortDate(timeline.end)}`;
}
