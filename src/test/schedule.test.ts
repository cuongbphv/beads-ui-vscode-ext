import { describe, expect, it } from 'vitest';

import {
  DAY,
  HOUR,
  MINUTE,
  buildTimeline,
  epicSpan,
  formatDuration,
  placement,
  spanOf,
} from '../shared/schedule';
import type { Bead, EpicGroup } from '../shared/types';

/** A fixed "now" — every assertion here is about relative positions, not today. */
const NOW = Date.parse('2026-08-04T12:00:00Z');

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return {
    title: partial.id,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...partial,
  };
}

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe('spanOf', () => {
  it('ends a closed issue at its close time', () => {
    const span = spanOf(
      bead({ id: 'a', created_at: iso(-3 * DAY), closed_at: iso(-1 * DAY), status: 'closed' }),
      true,
      NOW,
    );
    expect(span.kind).toBe('actual');
    expect(span.end).toBe(NOW - DAY);
    expect(span.overdue).toBe(false);
  });

  it('prefers the due date over the estimate for an open issue', () => {
    const span = spanOf(
      bead({ id: 'a', created_at: iso(-DAY), due_at: iso(2 * DAY), estimated_minutes: 30 }),
      false,
      NOW,
    );
    expect(span.kind).toBe('due');
    expect(span.end).toBe(NOW + 2 * DAY);
  });

  it('derives the end from the estimate when there is no due date', () => {
    const span = spanOf(
      bead({ id: 'a', started_at: iso(0), estimated_minutes: 180 }),
      false,
      NOW,
    );
    expect(span.kind).toBe('estimated');
    expect(span.end).toBe(NOW + 180 * MINUTE);
  });

  it('falls back to a nominal one-day bar with no dates at all', () => {
    const span = spanOf(bead({ id: 'a' }), false, NOW);
    expect(span.kind).toBe('nominal');
    expect(span.end - span.start).toBe(DAY);
  });

  it('flags an open issue past its due date, but not a closed one', () => {
    const overdue = spanOf(bead({ id: 'a', due_at: iso(-DAY) }), false, NOW);
    const shipped = spanOf(
      bead({ id: 'b', due_at: iso(-DAY), closed_at: iso(-2 * HOUR), status: 'closed' }),
      true,
      NOW,
    );
    expect(overdue.overdue).toBe(true);
    expect(shipped.overdue).toBe(false);
  });

  it('never produces a backwards or zero-width bar', () => {
    // A due date before the issue existed: bad data, still has to render.
    const span = spanOf(bead({ id: 'a', created_at: iso(0), due_at: iso(-5 * DAY) }), false, NOW);
    expect(span.end).toBeGreaterThanOrEqual(span.start + HOUR);
  });

  it('marks a deferred issue', () => {
    expect(spanOf(bead({ id: 'a', defer_until: iso(DAY) }), false, NOW).deferred).toBe(true);
    expect(spanOf(bead({ id: 'b', defer_until: iso(-DAY) }), false, NOW).deferred).toBe(false);
  });
});

describe('epicSpan', () => {
  const group: EpicGroup = {
    epic: bead({ id: 'epic', issue_type: 'epic', created_at: iso(-HOUR) }),
    children: [
      bead({ id: 'c1', created_at: iso(-5 * DAY), due_at: iso(-2 * DAY) }),
      bead({ id: 'c2', created_at: iso(-DAY), due_at: iso(6 * DAY) }),
    ],
    doneCount: 0,
    totalCount: 2,
  };

  it('widens the epic bar to cover every child', () => {
    const span = epicSpan(group, () => false, NOW);
    expect(span.start).toBe(NOW - 5 * DAY);
    expect(span.end).toBe(NOW + 6 * DAY);
  });

  it('reports an overdue child', () => {
    expect(epicSpan(group, () => false, NOW).hasOverdue).toBe(true);
    // Once the children are done, nothing is overdue any more.
    expect(epicSpan(group, () => true, NOW).hasOverdue).toBe(false);
  });

  it('keeps its own span when it has no children', () => {
    const lonely: EpicGroup = { ...group, children: [], totalCount: 0 };
    const span = epicSpan(lonely, () => false, NOW);
    expect(span.start).toBe(span.own.start);
    expect(span.end).toBe(span.own.end);
  });
});

describe('buildTimeline', () => {
  const groups: EpicGroup[] = [
    {
      epic: bead({ id: 'e1', issue_type: 'epic' }),
      children: [bead({ id: 'c1', created_at: iso(-2 * DAY), due_at: iso(3 * DAY) })],
      doneCount: 0,
      totalCount: 1,
    },
  ];

  it('pads the window so bars are not flush against the edges', () => {
    const timeline = buildTimeline(groups, () => false, NOW);
    expect(timeline.start).toBeLessThan(NOW - 2 * DAY);
    expect(timeline.end).toBeGreaterThan(NOW + 3 * DAY);
  });

  it('always contains today, even for a plan entirely in the past', () => {
    const past: EpicGroup[] = [
      {
        epic: bead({ id: 'e', issue_type: 'epic' }),
        children: [
          bead({ id: 'c', created_at: iso(-90 * DAY), closed_at: iso(-80 * DAY), status: 'closed' }),
        ],
        doneCount: 1,
        totalCount: 1,
      },
    ];
    const timeline = buildTimeline(past, () => true, NOW);
    expect(timeline.start).toBeLessThanOrEqual(NOW);
    expect(timeline.end).toBeGreaterThanOrEqual(NOW);
  });

  it('produces ticks inside the window', () => {
    const timeline = buildTimeline(groups, () => false, NOW);
    expect(timeline.ticks.length).toBeGreaterThan(0);
    for (const tick of timeline.ticks) {
      expect(tick.at).toBeGreaterThanOrEqual(timeline.start);
      expect(tick.at).toBeLessThanOrEqual(timeline.end);
    }
  });

  it('survives an empty roadmap', () => {
    const timeline = buildTimeline([], () => false, NOW);
    expect(timeline.epics).toEqual([]);
    expect(timeline.end).toBeGreaterThan(timeline.start);
  });
});

describe('placement', () => {
  const timeline = buildTimeline(
    [
      {
        epic: bead({ id: 'e', issue_type: 'epic' }),
        children: [bead({ id: 'c', created_at: iso(-DAY), due_at: iso(DAY) })],
        doneCount: 0,
        totalCount: 1,
      },
    ],
    () => false,
    NOW,
  );

  it('places a bar inside 0–100%', () => {
    const { left, width } = placement({ start: NOW - DAY, end: NOW + DAY }, timeline);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(100);
  });

  it('gives an instantaneous bar a visible minimum width', () => {
    expect(placement({ start: NOW, end: NOW }, timeline).width).toBeGreaterThan(0);
  });
});

describe('formatDuration', () => {
  it.each([
    [undefined, ''],
    [0, ''],
    [45, '45m'],
    [60, '1h'],
    [150, '2h 30m'],
    [480, '1d'],
    [960, '2d'],
  ])('formats %s as %s', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});
