import { describe, expect, it } from 'vitest';

import type { BarEdit } from '../webview/lib/bar-drag';
import { planScheduleRequest } from '../webview/lib/schedule-request';
import { shortDate } from '../webview/lib/utils';
import { DAY, formatDuration, type Span } from '../shared/schedule';
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

describe('planScheduleRequest', () => {
  it('returns null for a no-op edit, regardless of reason', () => {
    const s = span({ bead: bead({ id: 'a' }) });
    expect(planScheduleRequest(s, { field: 'none', reason: 'closed' })).toBeNull();
    expect(planScheduleRequest(s, { field: 'none', reason: 'unchanged' })).toBeNull();
  });

  it('plans setDue with a YYYY-MM-DD param and the before/after summary', () => {
    const due = new Date(2026, 7, 8).getTime();
    const newDue = new Date(2026, 7, 12).getTime();
    const s = span({ bead: bead({ id: 'bd-1', due_at: new Date(due).toISOString() }), end: due, kind: 'due' });
    const edit: BarEdit = { field: 'due', at: newDue };

    const plan = planScheduleRequest(s, edit);

    expect(plan).toEqual({
      method: 'setDue',
      params: { id: 'bd-1', date: '2026-08-12' },
      summary: `bd-1 · due ${shortDate(due)} → ${shortDate(newDue)}`,
    });
  });

  it('plans setEstimate with a minutes param and the before/after summary', () => {
    const s = span({
      bead: bead({ id: 'bd-2', estimated_minutes: 60 }),
      end: NOW + 60 * 60_000,
      kind: 'estimated',
    });
    const edit: BarEdit = { field: 'estimate', minutes: 180 };

    const plan = planScheduleRequest(s, edit);

    expect(plan).toEqual({
      method: 'setEstimate',
      params: { id: 'bd-2', minutes: 180 },
      summary: `bd-2 · est ${formatDuration(60)} → ${formatDuration(180)}`,
    });
  });

  it('summarises a prior-estimate-less issue as "none" before the arrow', () => {
    const s = span({ bead: bead({ id: 'bd-3' }), kind: 'nominal' });
    const edit: BarEdit = { field: 'estimate', minutes: 15 };

    const plan = planScheduleRequest(s, edit);

    expect(plan?.summary).toBe(`bd-3 · est none → ${formatDuration(15)}`);
  });
});
