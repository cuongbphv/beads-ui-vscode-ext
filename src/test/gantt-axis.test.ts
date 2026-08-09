import { describe, expect, it } from 'vitest';

import type { Timeline } from '../shared/schedule';
import { shortDate } from '../webview/lib/utils';
import { axisTicks, todayMarker, windowLabel } from '../webview/lib/gantt-axis-layout';

/** A Timeline with hand-picked bounds — precise enough to pin exact percentages. */
function timeline(overrides: Partial<Timeline>): Timeline {
  return {
    epics: [],
    start: 0,
    end: 1000,
    now: 500,
    ticks: [],
    ...overrides,
  };
}

describe('axisTicks', () => {
  it('positions ticks proportionally within a normal window', () => {
    const t = timeline({
      ticks: [
        { at: 0, label: 'start', major: true },
        { at: 250, label: 'quarter', major: false },
        { at: 500, label: 'mid', major: false },
        { at: 1000, label: 'end', major: true },
      ],
    });

    expect(axisTicks(t).map((tick) => tick.left)).toEqual([0, 25, 50, 100]);
  });

  it('carries the label and major flag through unchanged', () => {
    const t = timeline({
      ticks: [
        { at: 100, label: 'Aug 4', major: true },
        { at: 200, label: '06:00', major: false },
      ],
    });

    const ticks = axisTicks(t);
    expect(ticks[0]).toMatchObject({ label: 'Aug 4', major: true });
    expect(ticks[1]).toMatchObject({ label: '06:00', major: false });
  });

  it('places the first and last tick exactly at the window edges', () => {
    const t = timeline({
      start: 2000,
      end: 6000,
      ticks: [
        { at: 2000, label: 'first', major: true },
        { at: 4000, label: 'mid', major: false },
        { at: 6000, label: 'last', major: true },
      ],
    });

    const ticks = axisTicks(t);
    expect(ticks[0].left).toBe(0);
    expect(ticks[ticks.length - 1].left).toBe(100);
  });
});

describe('todayMarker', () => {
  it('lands in the middle of the track when "now" is the window\'s midpoint', () => {
    const t = timeline({ start: 0, end: 1000, now: 500 });
    expect(todayMarker(t)).toEqual({ left: 50, withinWindow: true });
  });

  it('reports out-of-window when "now" is before the start', () => {
    const t = timeline({ start: 0, end: 1000, now: -500 });
    const marker = todayMarker(t);
    // `placement` floors left at 0, so the marker still has a plottable position.
    expect(marker.left).toBe(0);
    expect(marker.withinWindow).toBe(false);
  });

  it('reports out-of-window when "now" is after the end', () => {
    const t = timeline({ start: 0, end: 1000, now: 1500 });
    const marker = todayMarker(t);
    expect(marker.left).toBe(150);
    expect(marker.withinWindow).toBe(false);
  });

  it('is within the window at either edge, inclusive', () => {
    expect(todayMarker(timeline({ start: 0, end: 1000, now: 0 })).withinWindow).toBe(true);
    expect(todayMarker(timeline({ start: 0, end: 1000, now: 1000 })).withinWindow).toBe(true);
  });
});

describe('windowLabel', () => {
  it('joins the window\'s start and end dates, start first', () => {
    const start = Date.parse('2026-08-01T00:00:00Z');
    const end = Date.parse('2026-08-10T00:00:00Z');
    const t = timeline({ start, end });

    expect(windowLabel(t)).toBe(`${shortDate(start)} → ${shortDate(end)}`);
  });
});
