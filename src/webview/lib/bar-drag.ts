/**
 * Turning a drag on a bar's right edge into a bd write.
 *
 * beads has no `--start` (verified against bd's CLI reference), so only the end
 * of a bar is editable — and which field that end lands in depends on what the
 * issue already carries. All of that decision lives here, pure, because the
 * failure mode is writing the wrong date into someone's tracker.
 */
import { DAY, HOUR, MINUTE, type Span, type Timeline } from '../../shared/schedule';

/** bd stores minutes; a quarter hour is the finest grid a drag can honestly hit. */
export const ESTIMATE_STEP_MINUTES = 15;

/** Below this a pointer move does not yet mean a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

export type BarEdit =
  | { field: 'due'; at: number }
  | { field: 'estimate'; minutes: number }
  | { field: 'none'; reason: 'closed' | 'unchanged' };

/**
 * Whether the pointer has moved far enough, over the course of the current
 * gesture, to count as a drag rather than a click. `alreadyMoved` is the
 * caller's memory of the gesture so far: once a gesture crosses the
 * threshold it must stay "moved" even if the pointer eases back under it.
 */
export function pastDragThreshold(alreadyMoved: boolean, deltaPx: number): boolean {
  return alreadyMoved || Math.abs(deltaPx) >= DRAG_THRESHOLD_PX;
}

/**
 * What, if anything, should reach the host's `onCommit`. `planBarEdit`
 * returning `none` — a drag that landed back where it started, or a closed
 * issue — must never spawn a bd subprocess, so it maps to no call at all.
 */
export function commitFor(edit: BarEdit): BarEdit | undefined {
  return edit.field === 'none' ? undefined : edit;
}

/**
 * The window a bar's end may be moved within, by pointer or by keyboard.
 *
 * The floor keeps a bar from folding through its own start; the ceiling is the
 * chart's own window, because `placement` sizes a bar as a percentage of that
 * window — an end beyond it is a bar wider than the track it is drawn in.
 *
 * `max` is held at or above `min` so the slider's ARIA bounds stay valid even
 * for a bar that somehow starts after the window ends.
 */
export function rescheduleRange(span: Span, timeline: Timeline): { min: number; max: number } {
  const min = Math.max(timeline.start, span.start + MINUTE);
  return { min, max: Math.max(timeline.end, min) };
}

function clampEnd(at: number, range: { min: number; max: number }): number {
  return Math.min(Math.max(at, range.min), range.max);
}

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
  return clampEnd(span.end + deltaPx * msPerPx, rescheduleRange(span, timeline));
}

/** Which bd field this bar's end writes back to. `planBarEdit` takes the same branch. */
export function editFieldFor(span: Span): 'due' | 'estimate' {
  return span.bead.due_at ? 'due' : 'estimate';
}

/**
 * The due date bd actually holds.
 *
 * Not `span.end`: `spanOf` refuses a backwards bar, so a due date earlier than
 * the bar's start is drawn as a one-hour stub at the start. Falls back to the
 * drawn end when there is no due date, or bd sent one that will not parse.
 */
export function currentDueAt(span: Span): number {
  const stored = span.bead.due_at ? Date.parse(span.bead.due_at) : Number.NaN;
  return Number.isNaN(stored) ? span.end : stored;
}

/**
 * How far one arrow key moves a bar's end, per field.
 *
 * A due-backed bar writes `bd update --due`, which takes a calendar date, so
 * anything finer than a day is discarded by `snapToDay` and the bar would sit
 * still however long the key was held; Shift is a week. An estimate-backed bar
 * writes minutes, so an hour is the coarsest step that still lands on the
 * 15-minute grid, and Shift is an eight-hour working day — the same day
 * `formatDuration` renders.
 */
export const RESCHEDULE_STEPS: Record<'due' | 'estimate', { step: number; large: number }> = {
  due: { step: DAY, large: 7 * DAY },
  estimate: { step: HOUR, large: 8 * HOUR },
};

/**
 * A keyboard nudge of the bar's end. `undefined` means the key is not ours —
 * leave the event alone.
 *
 * `current` is what the handle is showing, which during a keyboard edit is the
 * uncommitted preview rather than `span.end`, so repeated presses accumulate.
 */
export function keyReschedule(
  key: string,
  shift: boolean,
  current: number,
  span: Span,
  timeline: Timeline,
): number | undefined {
  const range = rescheduleRange(span, timeline);
  const { step, large } = RESCHEDULE_STEPS[editFieldFor(span)];
  const delta = shift ? large : step;

  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clampEnd(current + delta, range);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampEnd(current - delta, range);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    default:
      return undefined;
  }
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
    // Against what bd holds, never against the drawn end, or a real move is
    // swallowed as "unchanged" and a genuine no-op is reported as a change.
    if (toDueDate(at) === toDueDate(currentDueAt(span))) {
      return { field: 'none', reason: 'unchanged' };
    }
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
