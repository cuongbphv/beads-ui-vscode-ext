/**
 * Pure zoom arithmetic for the Gantt's frozen grid.
 *
 * `gantt-chart.tsx` measures the viewport and decides how the date axis and
 * bars should scale, but the decisions themselves — how many pixels a day is
 * worth at a given zoom, and how wide the scrollable track needs to be — are
 * ordinary arithmetic that has no business needing a DOM to test. Extracted
 * here the same way `gantt-axis-layout.ts` and `gantt-bar-layout.ts` carry the
 * axis and bar math for the components that render them.
 */
import { DAY } from '../../shared/schedule';

export type RoadmapZoom = 'fit' | 'day' | 'week' | 'month';

export const ROADMAP_ZOOMS: readonly RoadmapZoom[] = ['fit', 'day', 'week', 'month'];

/** How wide one day is at each fixed zoom. `fit` has no fixed value — see `pxPerDayFor`. */
const ZOOM_PX_PER_DAY: Record<Exclude<RoadmapZoom, 'fit'>, number> = {
  day: 48,
  week: 12,
  month: 4,
};

/**
 * How wide one day is on screen at `zoom`. A fixed zoom always answers the
 * same density; `fit` instead divides the measured track by the window's
 * length so the whole plan lines up with no horizontal scrollbar.
 */
export function pxPerDayFor(zoom: RoadmapZoom, trackPx: number, windowMs: number): number {
  if (zoom !== 'fit') return ZOOM_PX_PER_DAY[zoom];
  const days = Math.max(windowMs / DAY, 1);
  return trackPx > 0 ? trackPx / days : 0;
}

/**
 * How wide the scrollable track itself must be.
 *
 * At `fit` the track is exactly the viewport, so no horizontal scrollbar
 * appears; at a fixed zoom it is at least as wide as the viewport, but grows
 * to hold every day at that zoom's density once the window is long enough to
 * overflow the pane.
 */
export function trackPxFor(zoom: RoadmapZoom, viewportPx: number, windowMs: number): number {
  if (zoom === 'fit') return viewportPx;
  const days = Math.max(windowMs / DAY, 1);
  return Math.max(viewportPx, ZOOM_PX_PER_DAY[zoom] * days);
}
