import { describe, expect, it } from 'vitest';

import { ESTIMATE_STEP_MINUTES, endFromDrag, planBarEdit, snapToDay, toDueDate } from '../webview/lib/bar-drag';
import { DAY, HOUR, MINUTE, type Span, type Timeline } from '../shared/schedule';
import type { Bead } from '../shared/types';

const NOW = Date.parse('2026-08-04T12:00:00Z');

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return { title: partial.id, status: 'open', priority: 2, issue_type: 'task', ...partial };
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
