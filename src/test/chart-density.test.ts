import { describe, expect, it } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead } from '../shared/types';
import {
  BURNUP_MIN_DAYS,
  WORKLOAD_MIN_ASSIGNEES,
  burnUpDensity,
  burnUpSeries,
  workloadDensity,
} from '../webview/lib/chart-density';

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'closed', category: 'done' },
]);

const DAY = 86_400_000;

/** Local midnight `daysAgo` days back, as bd would report `closed_at`. */
function daysAgo(count: number): string {
  const day = new Date(Date.now() - count * DAY);
  day.setHours(9, 0, 0, 0);
  return day.toISOString();
}

function bead(overrides: Partial<Bead> & { id: string }): Bead {
  return {
    title: overrides.id,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  };
}

function closedOn(id: string, count: number): Bead {
  return bead({ id, status: 'closed', closed_at: daysAgo(count) });
}

/**
 * bd stores `closed_at` in UTC but the series buckets by *local* midnight — the
 * user's calendar is the one that matters. Fixtures are therefore built from
 * local wall-clock time, or the suite would pass or fail by timezone.
 */
function localAt(year: number, month: number, day: number, hour = 9): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe('burnUpDensity', () => {
  it('reports empty when nothing has been closed', () => {
    const density = burnUpDensity([bead({ id: 'a' }), bead({ id: 'b' })], index);
    expect(density).toEqual({ mode: 'empty', spanDays: 0, closed: 0, total: 2 });
  });

  it('counts a single day of closes as one day, not zero', () => {
    const density = burnUpDensity([closedOn('a', 0), closedOn('b', 0)], index);
    expect(density.spanDays).toBe(1);
    expect(density.mode).toBe('sparkline');
    expect(density.closed).toBe(2);
  });

  it('degrades to a sparkline just below the threshold', () => {
    const density = burnUpDensity(
      [closedOn('a', BURNUP_MIN_DAYS - 2), closedOn('b', 0)],
      index,
    );
    expect(density.spanDays).toBe(BURNUP_MIN_DAYS - 1);
    expect(density.mode).toBe('sparkline');
  });

  it('draws the full chart at the threshold', () => {
    const density = burnUpDensity(
      [closedOn('a', BURNUP_MIN_DAYS - 1), closedOn('b', 0)],
      index,
    );
    expect(density.spanDays).toBe(BURNUP_MIN_DAYS);
    expect(density.mode).toBe('full');
  });

  it('ignores a done issue with no closed_at and an unparseable date', () => {
    const density = burnUpDensity(
      [
        bead({ id: 'a', status: 'closed' }),
        bead({ id: 'b', status: 'closed', closed_at: 'not a date' }),
        closedOn('c', 0),
      ],
      index,
    );
    expect(density.mode).toBe('sparkline');
    // `closed` counts issues carrying a closed_at, plottable or not.
    expect(density.closed).toBe(2);
    expect(density.total).toBe(3);
  });
});

describe('burnUpSeries', () => {
  it('is empty when nothing has been closed', () => {
    expect(burnUpSeries([bead({ id: 'a' })], index)).toEqual([]);
  });

  it('anchors a single close with a zero the day before so it draws a line', () => {
    const now = new Date(2026, 2, 10, 12).getTime();
    const series = burnUpSeries(
      [bead({ id: 'a', status: 'closed', closed_at: localAt(2026, 3, 10) })],
      index,
      now,
    );
    expect(series).toHaveLength(2);
    expect(series[0].closed).toBe(0);
    expect(series[1].closed).toBe(1);
    expect(series[1].day - series[0].day).toBe(DAY);
  });

  it('accumulates across days and carries the last value to today', () => {
    const now = new Date(2026, 2, 20, 12).getTime();
    const series = burnUpSeries(
      [
        bead({ id: 'a', status: 'closed', closed_at: localAt(2026, 3, 10, 9) }),
        bead({ id: 'b', status: 'closed', closed_at: localAt(2026, 3, 10, 18) }),
        bead({ id: 'c', status: 'closed', closed_at: localAt(2026, 3, 12) }),
      ],
      index,
      now,
    );
    expect(series.map((point) => point.closed)).toEqual([0, 2, 3, 3]);
    expect(series[series.length - 1].day).toBe(new Date(now).setHours(0, 0, 0, 0));
  });

  it('does not append a carry point when the last close was today', () => {
    const now = new Date(2026, 2, 12, 23).getTime();
    const series = burnUpSeries(
      [bead({ id: 'a', status: 'closed', closed_at: localAt(2026, 3, 12) })],
      index,
      now,
    );
    expect(series.map((point) => point.closed)).toEqual([0, 1]);
  });
});

describe('workloadDensity', () => {
  it('is idle when nothing is open', () => {
    const density = workloadDensity([closedOn('a', 1)], index);
    expect(density.mode).toBe('idle');
    expect(density.open).toBe(0);
  });

  it('is unowned when open work has no PIC', () => {
    const density = workloadDensity([bead({ id: 'a' }), bead({ id: 'b', assignee: '  ' })], index);
    expect(density.mode).toBe('unowned');
    expect(density.unassigned).toBe(2);
    expect(density.assignees).toEqual([]);
  });

  it('is solo when one person carries everything', () => {
    const density = workloadDensity(
      [bead({ id: 'a', assignee: 'cuong' }), bead({ id: 'b' })],
      index,
    );
    expect(density.mode).toBe('solo');
    expect(density.assignees).toEqual(['cuong']);
    expect(density.unassigned).toBe(1);
    expect(density.open).toBe(2);
  });

  it('draws the chart once the work is split across people', () => {
    const density = workloadDensity(
      [
        bead({ id: 'a', assignee: 'cuong' }),
        bead({ id: 'b', assignee: 'mai', status: 'in_progress' }),
      ],
      index,
    );
    expect(density.mode).toBe('chart');
    expect(density.assignees).toHaveLength(WORKLOAD_MIN_ASSIGNEES);
    expect(density.assignees).toEqual(['cuong', 'mai']);
  });

  it('counts people, not issues — closed work never brings an assignee back', () => {
    const density = workloadDensity(
      [
        bead({ id: 'a', assignee: 'cuong' }),
        bead({ id: 'b', assignee: 'cuong' }),
        bead({ id: 'c', assignee: 'mai', status: 'closed', closed_at: daysAgo(1) }),
      ],
      index,
    );
    expect(density.mode).toBe('solo');
    expect(density.assignees).toEqual(['cuong']);
  });
});
