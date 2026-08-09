import { describe, expect, it } from 'vitest';

import {
  commitFor,
  DRAG_THRESHOLD_PX,
  ESTIMATE_STEP_MINUTES,
  RESCHEDULE_STEPS,
  editFieldFor,
  endFromDrag,
  keyReschedule,
  pastDragThreshold,
  planBarEdit,
  rescheduleRange,
  snapToDay,
  toDueDate,
} from '../webview/lib/bar-drag';
import { DAY, HOUR, MINUTE, type Span, type Timeline } from '../shared/schedule';
import type { Bead } from '../shared/types';

const NOW = Date.parse('2026-08-04T12:00:00Z');

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return { title: partial.id, status: 'open', priority: 2, issue_type: 'task', ...partial };
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

function span(partial: Partial<Span> & { bead: Bead }): Span {
  return {
    start: NOW,
    end: NOW + DAY,
    kind: 'nominal',
    overdue: false,
    deferred: false,
    ...partial,
  };
}

/** A 10-day window; with a 1000px track that is exactly 100px per day. */
const timeline: Timeline = {
  epics: [],
  start: NOW,
  end: NOW + 10 * DAY,
  now: NOW,
  ticks: [],
};

describe('endFromDrag', () => {
  it('converts pixels to milliseconds against the window', () => {
    const s = span({ bead: bead({ id: 'a' }) });
    expect(endFromDrag(s, 100, 1000, timeline)).toBe(s.end + DAY);
    expect(endFromDrag(s, -50, 1000, timeline)).toBe(s.end - DAY / 2);
  });

  it('never lets the end fall to or before the start', () => {
    const s = span({ bead: bead({ id: 'a' }) });
    expect(endFromDrag(s, -9999, 1000, timeline)).toBe(s.start + MINUTE);
  });

  it('returns the current end when the track has not been measured', () => {
    const s = span({ bead: bead({ id: 'a' }) });
    expect(endFromDrag(s, 400, 0, timeline)).toBe(s.end);
  });

  it('never lets the end run past the window the chart draws', () => {
    // An unclamped preview is a bar wider than its own track: `placement`
    // turns it into a width above 100% and the row overflows the chart.
    const s = span({ bead: bead({ id: 'a' }) });
    expect(endFromDrag(s, 100_000, 1000, timeline)).toBe(timeline.end);
  });
});

describe('rescheduleRange', () => {
  it('runs from a minute after the bar starts to the end of the window', () => {
    const s = span({ bead: bead({ id: 'a' }) });
    expect(rescheduleRange(s, timeline)).toEqual({ min: NOW + MINUTE, max: NOW + 10 * DAY });
  });

  it('collapses rather than inverting when the bar starts past the window', () => {
    // A padded window always contains its bars, but the range is also the
    // slider's advertised ARIA bounds — `min > max` there is invalid markup.
    const s = span({ bead: bead({ id: 'a' }), start: NOW + 20 * DAY, end: NOW + 21 * DAY });
    const range = rescheduleRange(s, timeline);

    expect(range.min).toBe(NOW + 20 * DAY + MINUTE);
    expect(range.max).toBe(range.min);
  });
});

describe('editFieldFor', () => {
  it('reports the field `planBarEdit` would write for this bar', () => {
    expect(editFieldFor(span({ bead: bead({ id: 'a', due_at: iso(NOW) }) }))).toBe('due');
    expect(editFieldFor(span({ bead: bead({ id: 'a', estimated_minutes: 60 }) }))).toBe('estimate');
    expect(editFieldFor(span({ bead: bead({ id: 'a' }) }))).toBe('estimate');
  });
});

describe('keyReschedule', () => {
  // Started before the window opens, so a leftward nudge is bounded by the
  // window rather than by the bar's own start.
  const dueSpan = span({
    bead: bead({ id: 'a', due_at: iso(NOW + DAY) }),
    start: NOW - 5 * DAY,
    end: NOW + DAY,
    kind: 'due',
  });
  const estimateSpan = span({
    bead: bead({ id: 'b', estimated_minutes: 480 }),
    end: NOW + 8 * HOUR,
    kind: 'estimated',
  });

  it('nudges a due-backed bar by a calendar day, and by a week with Shift', () => {
    // bd's `--due` takes a calendar date, so anything finer than a day is
    // thrown away by `snapToDay` and the bar would never appear to move.
    expect(keyReschedule('ArrowRight', false, dueSpan.end, dueSpan, timeline)).toBe(NOW + 2 * DAY);
    expect(keyReschedule('ArrowLeft', false, dueSpan.end, dueSpan, timeline)).toBe(NOW);
    expect(keyReschedule('ArrowRight', true, dueSpan.end, dueSpan, timeline)).toBe(NOW + 8 * DAY);
  });

  it('nudges an estimate-backed bar by an hour, and by a working day with Shift', () => {
    expect(keyReschedule('ArrowRight', false, estimateSpan.end, estimateSpan, timeline)).toBe(
      NOW + 9 * HOUR,
    );
    expect(keyReschedule('ArrowRight', true, estimateSpan.end, estimateSpan, timeline)).toBe(
      NOW + 16 * HOUR,
    );
  });

  it('matches the documented steps rather than a second copy of them', () => {
    expect(RESCHEDULE_STEPS.due).toEqual({ step: DAY, large: 7 * DAY });
    expect(RESCHEDULE_STEPS.estimate).toEqual({ step: HOUR, large: 8 * HOUR });
  });

  it('treats the vertical arrows as the horizontal ones', () => {
    expect(keyReschedule('ArrowUp', false, dueSpan.end, dueSpan, timeline)).toBe(NOW + 2 * DAY);
    expect(keyReschedule('ArrowDown', false, dueSpan.end, dueSpan, timeline)).toBe(NOW);
  });

  it('jumps to the ends of the reschedule range on Home and End', () => {
    expect(keyReschedule('Home', false, dueSpan.end, dueSpan, timeline)).toBe(NOW);
    expect(keyReschedule('End', false, dueSpan.end, dueSpan, timeline)).toBe(NOW + 10 * DAY);
  });

  it('clamps a nudge to the same window a drag is clamped to', () => {
    // Keyboard and pointer must not disagree about where a bar may end.
    const late = span({ bead: bead({ id: 'a', due_at: iso(NOW + 10 * DAY) }), end: NOW + 10 * DAY });
    expect(keyReschedule('ArrowRight', true, late.end, late, timeline)).toBe(timeline.end);
    expect(keyReschedule('ArrowLeft', true, NOW + HOUR, late, timeline)).toBe(NOW + MINUTE);
  });

  it('returns undefined for keys it does not own', () => {
    expect(keyReschedule('Enter', false, dueSpan.end, dueSpan, timeline)).toBeUndefined();
    expect(keyReschedule('Escape', false, dueSpan.end, dueSpan, timeline)).toBeUndefined();
    expect(keyReschedule('a', false, dueSpan.end, dueSpan, timeline)).toBeUndefined();
  });
});

describe('snapToDay', () => {
  it('rounds to the nearer local midnight', () => {
    const morning = new Date(2026, 7, 4, 9, 0, 0, 0).getTime();
    const evening = new Date(2026, 7, 4, 20, 0, 0, 0).getTime();
    expect(snapToDay(morning)).toBe(new Date(2026, 7, 4).getTime());
    expect(snapToDay(evening)).toBe(new Date(2026, 7, 5).getTime());
  });

  it('rounds up at exactly the halfway point (>= DAY / 2)', () => {
    const midnight = new Date(2026, 7, 4).getTime();
    const exactHalf = midnight + DAY / 2;
    expect(snapToDay(exactHalf)).toBe(new Date(2026, 7, 5).getTime());
  });
});

describe('toDueDate', () => {
  it('formats the local calendar day, not the UTC one', () => {
    // 2026-08-04 23:30 local is 2026-08-04 for bd, even where toISOString says the 5th.
    expect(toDueDate(new Date(2026, 7, 4, 23, 30).getTime())).toBe('2026-08-04');
    expect(toDueDate(new Date(2026, 11, 31).getTime())).toBe('2026-12-31');
  });
});

describe('planBarEdit', () => {
  it('refuses to edit a closed issue', () => {
    const s = span({ bead: bead({ id: 'a', status: 'closed' }), kind: 'actual' });
    expect(planBarEdit(s, s.end + DAY)).toEqual({ field: 'none', reason: 'closed' });
  });

  it('writes a due date when the issue carries one', () => {
    const due = new Date(2026, 7, 8).getTime();
    const s = span({ bead: bead({ id: 'a', due_at: new Date(due).toISOString() }), end: due, kind: 'due' });

    const edit = planBarEdit(s, due + 4 * DAY);

    expect(edit).toEqual({ field: 'due', at: new Date(2026, 7, 12).getTime() });
  });

  it('does nothing when the drag lands on the same calendar day', () => {
    const due = new Date(2026, 7, 8).getTime();
    const s = span({ bead: bead({ id: 'a', due_at: new Date(due).toISOString() }), end: due, kind: 'due' });

    expect(planBarEdit(s, due + 2 * HOUR)).toEqual({ field: 'none', reason: 'unchanged' });
  });

  it('measures "unchanged" against the stored due date, not the clamped bar end', () => {
    // A due date that precedes the bar's start is drawn as a one-hour stub at
    // the start (`spanOf` refuses a backwards bar), so `span.end` says nothing
    // about what bd holds. Comparing against it swallows a real move and
    // reports a genuine no-op as a change.
    const start = new Date(2026, 7, 10).getTime();
    const due = new Date(2026, 7, 1).getTime();
    const s = span({
      bead: bead({ id: 'a', due_at: new Date(due).toISOString() }),
      start,
      end: start + HOUR,
      kind: 'due',
    });

    expect(planBarEdit(s, start + 2 * HOUR)).toEqual({ field: 'due', at: start });
    expect(planBarEdit(s, due + HOUR)).toEqual({ field: 'none', reason: 'unchanged' });
  });

  it('falls back to the drawn end when bd sent a due date it cannot parse', () => {
    const due = new Date(2026, 7, 8).getTime();
    const s = span({
      bead: bead({ id: 'a', due_at: 'not-a-date' }),
      start: due - DAY,
      end: due,
      kind: 'due',
    });

    expect(planBarEdit(s, due + 2 * HOUR)).toEqual({ field: 'none', reason: 'unchanged' });
  });

  it('writes an estimate when the issue has no due date', () => {
    const s = span({ bead: bead({ id: 'a', estimated_minutes: 60 }), end: NOW + HOUR, kind: 'estimated' });

    expect(planBarEdit(s, NOW + 3 * HOUR)).toEqual({ field: 'estimate', minutes: 180 });
  });

  it('snaps an estimate to a quarter hour and never below one step', () => {
    const s = span({ bead: bead({ id: 'a' }), end: NOW + HOUR, kind: 'nominal' });

    expect(planBarEdit(s, NOW + 22 * MINUTE)).toEqual({ field: 'estimate', minutes: 15 });
    expect(planBarEdit(s, NOW - 5 * DAY)).toEqual({
      field: 'estimate',
      minutes: ESTIMATE_STEP_MINUTES,
    });
  });

  it('does nothing when the snapped estimate equals the stored one', () => {
    const s = span({ bead: bead({ id: 'a', estimated_minutes: 60 }), end: NOW + HOUR, kind: 'estimated' });

    expect(planBarEdit(s, NOW + 62 * MINUTE)).toEqual({ field: 'none', reason: 'unchanged' });
  });

  it('does nothing when a nominal span (no prior estimate) is dragged to its current length', () => {
    // A nominal span defaults to end = start + DAY; dragging it to exactly that length is unchanged.
    const s = span({ bead: bead({ id: 'a' }), kind: 'nominal' });
    expect(planBarEdit(s, s.end)).toEqual({ field: 'none', reason: 'unchanged' });
  });
});

describe('pastDragThreshold', () => {
  it('stays false below the 4px threshold', () => {
    expect(pastDragThreshold(false, 0)).toBe(false);
    expect(pastDragThreshold(false, DRAG_THRESHOLD_PX - 1)).toBe(false);
    expect(pastDragThreshold(false, -(DRAG_THRESHOLD_PX - 1))).toBe(false);
  });

  it('becomes true at exactly the threshold, in either direction', () => {
    expect(pastDragThreshold(false, DRAG_THRESHOLD_PX)).toBe(true);
    expect(pastDragThreshold(false, -DRAG_THRESHOLD_PX)).toBe(true);
  });

  it('stays true once a gesture has moved, even if the pointer eases back', () => {
    // A gesture that already crossed the threshold must not "un-drag" just
    // because the pointer drifted back toward its start.
    expect(pastDragThreshold(true, 0)).toBe(true);
    expect(pastDragThreshold(true, 1)).toBe(true);
  });
});

describe('commitFor', () => {
  it('produces no payload for a `none` edit, regardless of reason', () => {
    expect(commitFor({ field: 'none', reason: 'unchanged' })).toBeUndefined();
    expect(commitFor({ field: 'none', reason: 'closed' })).toBeUndefined();
  });

  it('passes a real edit through unchanged', () => {
    const due = { field: 'due', at: NOW + DAY } as const;
    expect(commitFor(due)).toBe(due);

    const estimate = { field: 'estimate', minutes: 90 } as const;
    expect(commitFor(estimate)).toBe(estimate);
  });
});
