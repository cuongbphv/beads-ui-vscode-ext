/**
 * The Gantt's date axis and its gridline layer.
 *
 * Both are positioned from the same `--gantt-gutter` custom property the shell
 * sets, so a resized gutter cannot leave the header and the rows disagreeing
 * about where the track begins. The actual placement arithmetic lives in
 * `../../lib/gantt-axis-layout`, tested without a DOM — this file only renders
 * what that module decides.
 */
import type { ReactNode } from 'react';

import type { Timeline } from '../../../shared/schedule';
import { axisTicks, todayMarker, windowLabel } from '../../lib/gantt-axis-layout';
import { cn } from '../../lib/utils';

/** Every element that must line up with the label gutter uses this. */
export const GUTTER_CLASS = 'w-[var(--gantt-gutter)] shrink-0';

export function GanttAxis({ timeline }: { timeline: Timeline }): ReactNode {
  return (
    <div className="bg-bg border-border sticky top-0 z-20 flex items-end border-b pb-1">
      {/* The corner outranks both sticky axes, or a scrolled row shows through it. */}
      <div className={cn(GUTTER_CLASS, 'bg-bg sticky left-0 z-30 px-2 text-xs text-fg-muted')}>
        {windowLabel(timeline)}
      </div>
      <div className="relative h-6 min-w-0 flex-1">
        {axisTicks(timeline).map((tick) => (
          <span
            key={tick.at}
            className={cn(
              'absolute bottom-0 -translate-x-1/2 text-[10px] whitespace-nowrap',
              tick.major ? 'text-fg font-medium' : 'text-fg-muted',
            )}
            style={{ left: `${tick.left}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Gridlines and the today marker, behind every row. */
export function GanttGrid({ timeline }: { timeline: Timeline }): ReactNode {
  const now = todayMarker(timeline);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
      <div className={GUTTER_CLASS} />
      <div className="relative min-w-0 flex-1">
        {axisTicks(timeline).map((tick) => (
          <span
            key={tick.at}
            // Gridlines are scaffolding: day boundaries a little firmer than
            // the rest, but never louder than the bars or the today marker.
            className={cn(
              'absolute inset-y-0 w-px',
              tick.major ? 'bg-border-strong/35' : 'bg-border/40',
            )}
            style={{ left: `${tick.left}%` }}
          />
        ))}
        <span className="bg-danger absolute inset-y-0 w-0.5" style={{ left: `${now.left}%` }} />
      </div>
    </div>
  );
}
