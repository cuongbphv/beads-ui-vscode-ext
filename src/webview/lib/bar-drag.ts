/**
 * Turning a drag on a bar's right edge into a bd write.
 *
 * beads has no `--start` (verified against bd's CLI reference), so only the end
 * of a bar is editable — and which field that end lands in depends on what the
 * issue already carries. All of that decision lives here, pure, because the
 * failure mode is writing the wrong date into someone's tracker.
 */
import { DAY, MINUTE, type Span, type Timeline } from '../../shared/schedule';

/** bd stores minutes; a quarter hour is the finest grid a drag can honestly hit. */
export const ESTIMATE_STEP_MINUTES = 15;

export type BarEdit =
  | { field: 'due'; at: number }
  | { field: 'estimate'; minutes: number }
  | { field: 'none'; reason: 'closed' | 'unchanged' };

/**
 * Where the bar's end lands after its handle moves `deltaPx` across a track
 * `trackPx` wide. `trackPx` of 0 means nothing has been measured yet.
 */
export function endFromDrag(
  span: Span,
  deltaPx: number,
  trackPx: number,
  timeline: Timeline,
): number {
  if (trackPx <= 0) return span.end;
  const msPerPx = (timeline.end - timeline.start) / trackPx;
  return Math.max(span.start + MINUTE, span.end + deltaPx * msPerPx);
}

/** The nearer local midnight — bd's `--due` takes a calendar date, not a time. */
export function snapToDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  const floor = date.getTime();
  if (at - floor < DAY / 2) return floor;
  // Advance to the next calendar day and re-zero to handle DST transitions.
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * `YYYY-MM-DD` in local time.
 *
 * Never `toISOString().slice(0, 10)`: in a +07 zone that reports tomorrow for
 * anything after 17:00, and the user would watch their due date jump a day.
 */
export function toDueDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Snap a duration (in milliseconds) to the estimate grid.
 * @internal
 */
function snapEstimate(ms: number): number {
  const raw = ms / MINUTE;
  return Math.max(ESTIMATE_STEP_MINUTES, Math.round(raw / ESTIMATE_STEP_MINUTES) * ESTIMATE_STEP_MINUTES);
}

/**
 * Decide what — if anything — to write.
 *
 * `none` is a first-class outcome, not an error: a drag that lands back where it
 * started must not spawn a bd subprocess, and a closed issue's end is
 * `closed_at`, which bd will not accept.
 */
export function planBarEdit(span: Span, newEnd: number): BarEdit {
  if (span.kind === 'actual') return { field: 'none', reason: 'closed' };

  if (span.bead.due_at) {
    const at = snapToDay(newEnd);
    if (toDueDate(at) === toDueDate(span.end)) return { field: 'none', reason: 'unchanged' };
    return { field: 'due', at };
  }

  const newMinutes = snapEstimate(newEnd - span.start);
  // Compare against the bar's current length (snapped), not against the stored
  // estimated_minutes field, which may be undefined. This way, dragging a bar back
  // to its current visual length is a no-op, even when the issue has no prior estimate.
  // E.g., dragging a 1-day nominal bar to exactly one day is unchanged, which prevents
  // an accidental drag-and-return from stamping a 24-hour estimate onto an unestimated issue.
  const currentMinutes = snapEstimate(span.end - span.start);
  if (newMinutes === currentMinutes) return { field: 'none', reason: 'unchanged' };
  return { field: 'estimate', minutes: newMinutes };
}
