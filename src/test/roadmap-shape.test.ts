import { describe, expect, it } from 'vitest';

import { StatusIndex } from '../shared/model';
import { DAY } from '../shared/schedule';
import type { Bead } from '../shared/types';
import {
  MIN_TIMELINE_DAYS,
  defaultShape,
  hiddenClosedCount,
  resolveShape,
} from '../webview/lib/roadmap-shape';

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'closed', category: 'done' },
]);

function bead(overrides: Partial<Bead> & { id: string }): Bead {
  return {
    title: overrides.id,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  };
}

const START = Date.parse('2026-03-01T00:00:00Z');
const window = (days: number): { start: number; end: number } => ({
  start: START,
  end: START + days * DAY,
});

describe('defaultShape', () => {
  it('opens as a list when every bar lands in the same few days', () => {
    expect(defaultShape(window(2))).toBe('list');
  });

  it('opens as a timeline once the plan is long enough to have a shape', () => {
    expect(defaultShape(window(MIN_TIMELINE_DAYS))).toBe('timeline');
    expect(defaultShape(window(90))).toBe('timeline');
  });

  it('puts the boundary exactly where the constant says', () => {
    expect(defaultShape(window(MIN_TIMELINE_DAYS - 0.01))).toBe('list');
  });
});

describe('resolveShape', () => {
  it('falls back to the window when nothing has been chosen', () => {
    expect(resolveShape(undefined, window(1))).toBe('list');
    expect(resolveShape(undefined, window(30))).toBe('timeline');
  });

  it('never overrides an explicit choice — the view must not switch underneath the user', () => {
    expect(resolveShape('timeline', window(1))).toBe('timeline');
    expect(resolveShape('list', window(365))).toBe('list');
  });

  it('keeps an explicit graph choice regardless of the window — it is never inferred', () => {
    expect(resolveShape('graph', window(1))).toBe('graph');
    expect(resolveShape('graph', window(365))).toBe('graph');
  });
});

describe('hiddenClosedCount', () => {
  const beads = [
    bead({ id: 'a' }),
    bead({ id: 'b', status: 'in_progress' }),
    bead({ id: 'c', status: 'closed' }),
    bead({ id: 'd', status: 'closed' }),
  ];

  it('counts what the default is keeping out of view', () => {
    expect(hiddenClosedCount(beads, { includeClosed: false }, index)).toBe(2);
  });

  it('is zero once closed work is shown', () => {
    expect(hiddenClosedCount(beads, { includeClosed: true }, index)).toBe(0);
  });

  it('counts only what the *other* filters would have let through', () => {
    // The text filter excludes one of the two closed issues, so only one of
    // them is being hidden by the closed rule.
    expect(hiddenClosedCount(beads, { includeClosed: false, text: 'c' }, index)).toBe(1);
  });

  it('is zero when nothing is closed', () => {
    expect(hiddenClosedCount([bead({ id: 'a' })], { includeClosed: false }, index)).toBe(0);
  });
});
