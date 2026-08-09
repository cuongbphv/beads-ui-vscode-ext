/**
 * The Gantt as a frozen grid.
 *
 * One scroll container on both axes, with the date axis pinned to the top and
 * the label gutter pinned to the left. The container carries no padding: a
 * padded scroller lets `sticky top-0` pin below the padding, and exactly that
 * much scrolled content then shows above the header — which is the sliver this
 * layout was rewritten to remove.
 */
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { StatusIndex } from '../../../shared/model';
import type { Span, Timeline } from '../../../shared/schedule';
import type { Bead } from '../../../shared/types';
import type { BarEdit } from '../../lib/bar-drag';
import { trackPxFor, type RoadmapZoom } from '../../lib/gantt-zoom';
import { GanttAxis, GanttGrid } from './gantt-axis';
import { EpicRow, TaskRow } from './gantt-rows';

export { pxPerDayFor, ROADMAP_ZOOMS, type RoadmapZoom } from '../../lib/gantt-zoom';

export function GanttChart({
  timeline,
  index,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
  blockedIds,
  gutter,
  zoom,
  onTrackWidth,
  onCommit,
  pendingIds,
}: {
  timeline: Timeline;
  index: StatusIndex;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
  /** Label-gutter width in px, owned by RoadmapView. */
  gutter: number;
  zoom: RoadmapZoom;
  /** Reports the measured track width so the caller can pick tick density. */
  onTrackWidth: (px: number) => void;
  /** Omitted (not a no-op) means "not editable yet" — see `GanttBar`. */
  onCommit?: (span: Span, edit: BarEdit) => void;
  pendingIds: ReadonlySet<string>;
}): ReactNode {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportPx, setViewportPx] = useState(0);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setViewportPx(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const trackViewportPx = Math.max(viewportPx - gutter, 0);
  const trackPx = trackPxFor(zoom, trackViewportPx, timeline.end - timeline.start);

  useEffect(() => onTrackWidth(trackPx), [onTrackWidth, trackPx]);

  return (
    <div
      ref={viewportRef}
      className="min-h-0 flex-1 overflow-auto"
      style={{ '--gantt-gutter': `${gutter}px` } as CSSProperties}
    >
      <div style={{ minWidth: `${gutter + trackPx}px` }}>
        <GanttAxis timeline={timeline} />

        <div className="relative">
          <GanttGrid timeline={timeline} />

          <ul className="relative grid">
            {timeline.epics.map((epic) => (
              <Fragment key={epic.group.epic.id}>
                <EpicRow
                  epic={epic}
                  timeline={timeline}
                  collapsed={collapsed.has(epic.group.epic.id)}
                  onToggle={() => onToggle(epic.group.epic.id)}
                  onSelect={onSelect}
                  selectedId={selectedId}
                />
                {!collapsed.has(epic.group.epic.id)
                  ? epic.children.map((span) => (
                      <TaskRow
                        key={span.bead.id}
                        span={span}
                        timeline={timeline}
                        index={index}
                        onSelect={onSelect}
                        selected={span.bead.id === selectedId}
                        blocked={blockedIds.has(span.bead.id)}
                        onCommit={onCommit}
                        pending={pendingIds.has(span.bead.id)}
                      />
                    ))
                  : null}
              </Fragment>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** True when nothing in the set carries a real date — worth telling the user. */
export function hasNoScheduleData(beads: Bead[]): boolean {
  return !beads.some((bead) => bead.due_at || bead.estimated_minutes || bead.started_at);
}
