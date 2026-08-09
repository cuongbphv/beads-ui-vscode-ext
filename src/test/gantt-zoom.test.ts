import { describe, expect, it } from 'vitest';

import { DAY } from '../shared/schedule';
import { pxPerDayFor, trackPxFor } from '../webview/lib/gantt-zoom';

describe('pxPerDayFor', () => {
  it('returns the fixed density for a pinned zoom, ignoring the measured track', () => {
    // Catches swapping the zoom table's values, or fixed zooms silently
    // reading the `fit` branch.
    expect(pxPerDayFor('day', 100, 30 * DAY)).toBe(48);
    expect(pxPerDayFor('week', 100, 30 * DAY)).toBe(12);
    expect(pxPerDayFor('month', 100, 30 * DAY)).toBe(4);
  });

  it('divides the measured track by the window length at `fit`', () => {
    // Catches the division being inverted (days/trackPx instead of trackPx/days).
    expect(pxPerDayFor('fit', 900, 9 * DAY)).toBe(100);
  });

  it('floors the window at one day so a same-day plan does not blow up the density', () => {
    // Catches a missing `Math.max(days, 1)` clamp, which would make a window
    // under a day report an enormous or Infinity px-per-day.
    expect(pxPerDayFor('fit', 500, 1000)).toBe(500);
  });

  it('reports 0 before the track has been measured', () => {
    // At `trackPx` of 0 — the very first render, before `ResizeObserver` has
    // reported a width — plain division already gives 0 once `days` is
    // floored to at least 1, guard or no guard; the next test is the one that
    // actually exercises the `trackPx > 0` guard.
    expect(pxPerDayFor('fit', 0, 9 * DAY)).toBe(0);
  });

  it('clamps a negative track to 0 rather than a negative density', () => {
    // Genuinely catches removing the `trackPx > 0` guard: without it,
    // `-100 / days` divides straight through to a negative pxPerDay instead
    // of the 0 a not-yet-measured (or mismeasured) track should report.
    expect(pxPerDayFor('fit', -100, 9 * DAY)).toBe(0);
  });
});

describe('trackPxFor', () => {
  it('is exactly the viewport at `fit`, never widened', () => {
    // Catches the fixed-zoom multiplier leaking into the `fit` branch, which
    // would introduce a horizontal scrollbar `fit` is meant to avoid.
    expect(trackPxFor('fit', 640, 30 * DAY)).toBe(640);
  });

  it('grows past the viewport once a fixed zoom needs more room than it offers', () => {
    // Catches a wrong zoom constant or a missing multiplication by day count.
    expect(trackPxFor('day', 300, 10 * DAY)).toBe(480); // 48px/day * 10 days
  });

  it('never shrinks the track below the viewport, even for a short window', () => {
    // Catches a missing `Math.max(viewportPx, ...)` floor, which would leave
    // the grid narrower than the pane it scrolls inside.
    expect(trackPxFor('month', 800, 2 * DAY)).toBe(800);
  });
});
