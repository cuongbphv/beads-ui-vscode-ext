/**
 * Re-exports so `../components/gantt` keeps resolving after the split.
 *
 * Row order lives in `shared/roadmap-sort.ts`, shared with the List shape.
 */
export {
  GanttChart,
  hasNoScheduleData,
  pxPerDayFor,
  ROADMAP_ZOOMS,
  type RoadmapZoom,
} from './gantt-chart';
export { GanttLegend } from './gantt-legend';
// `gantt-bar.tsx` only imports `barTitle` for its own JSX; the export lives
// where the arithmetic does, in `gantt-bar-layout.ts`.
export { barTitle } from '../../lib/gantt-bar-layout';
