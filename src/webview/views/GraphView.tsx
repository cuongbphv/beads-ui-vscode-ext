/**
 * Graph: the board's dependency DAG, drawn as one scrollable, zoomable SVG.
 *
 * Layout is computed once per `beads` identity (`useMemo`) rather than on
 * every render — the Sugiyama-lite pass in `graph-layout.ts` walks every edge,
 * and there is no reason to redo that on an unrelated state change like the
 * zoom level. Only beads that carry at least one `blocks` / `parent-child`
 * edge are drawn at all, so a 2000-issue board stays a small SVG rather than
 * one node per issue.
 */
import { ZoomIn, ZoomOut, Waypoints } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { typeStyle, type Bead } from '../../shared/types';
import { EmptyState, Button } from '../components/primitives';
import { buildGraphLayout, NODE_H, NODE_W } from '../lib/graph-layout';
import { cn } from '../lib/utils';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;

export function GraphView({
  beads,
  onSelect,
  selectedId,
  blockedIds,
}: {
  beads: Bead[];
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
}): ReactNode {
  const [zoom, setZoom] = useState(1);
  // Recomputing the whole layered layout is O(nodes + edges) work that has
  // nothing to do with zoom or selection, so it is keyed on `beads` alone.
  const layout = useMemo(() => buildGraphLayout(beads), [beads]);

  if (layout.nodes.length === 0) {
    return (
      <div className="@container flex h-full min-h-0 flex-col">
        <EmptyState
          icon={<Waypoints className="size-10" />}
          title="No dependencies to show"
          hint="This board has no blocks or parent-child links yet. Add a dependency with bd dep add to see it here."
        />
      </div>
    );
  }

  const zoomIn = (): void => setZoom((z) => Math.min(ZOOM_MAX, Number((z + ZOOM_STEP).toFixed(2))));
  const zoomOut = (): void => setZoom((z) => Math.max(ZOOM_MIN, Number((z - ZOOM_STEP).toFixed(2))));

  const linkCount = layout.edges.length;
  const summary = `${layout.nodes.length} issue${layout.nodes.length === 1 ? '' : 's'}, ${linkCount} dependency link${linkCount === 1 ? '' : 's'}`;

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="border-border text-fg-muted flex items-center gap-1 border-b px-3 py-1.5 text-xs">
        <span className="text-fg-strong font-medium">Dependency graph</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" title="Zoom out" onClick={zoomOut} disabled={zoom <= ZOOM_MIN}>
            <ZoomOut aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Zoom out</span>
          </Button>
          <span aria-hidden="true" className="w-9 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" title="Zoom in" onClick={zoomIn} disabled={zoom >= ZOOM_MAX}>
            <ZoomIn aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Zoom in</span>
          </Button>
        </div>
      </div>

      {/* The SVG is a dense mesh of unlabelled shapes to assistive tech; this
          sentence is the accessible substitute, same precedent as the
          Overview's charts (`components/charts.tsx`). */}
      <p className="sr-only">{summary}</p>

      <div className="min-h-0 flex-1 overflow-auto">
        <svg
          width={layout.width * zoom}
          height={layout.height * zoom}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
        >
          <defs>
            <marker
              id="graph-arrow"
              markerWidth={8}
              markerHeight={8}
              refX={7}
              refY={4}
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--color-fg-muted)" />
            </marker>
            <marker
              id="graph-arrow-blocked"
              markerWidth={8}
              markerHeight={8}
              refX={7}
              refY={4}
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--color-warning)" />
            </marker>
          </defs>

          <g aria-hidden="true">
            {layout.edges.map((edge) => {
              const isBlocks = edge.kind === 'blocks';
              const isLive = isBlocks && blockedIds.has(edge.to);
              const [start, end] = edge.points;
              return (
                <path
                  key={`${edge.from}->${edge.to}:${edge.kind}`}
                  d={`M${start.x},${start.y} L${end.x},${end.y}`}
                  fill="none"
                  stroke={isLive ? 'var(--color-warning)' : 'var(--color-fg-muted)'}
                  strokeWidth={1.5}
                  strokeDasharray={isBlocks ? undefined : '4 3'}
                  markerEnd={isBlocks ? `url(#${isLive ? 'graph-arrow-blocked' : 'graph-arrow'})` : undefined}
                />
              );
            })}
          </g>

          <g>
            {layout.nodes.map((node) => {
              const style = typeStyle(node.bead.issue_type);
              const selected = node.id === selectedId;
              const blocked = blockedIds.has(node.id);
              const title =
                node.bead.title.length > 22 ? `${node.bead.title.slice(0, 21)}…` : node.bead.title;

              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.id}: ${node.bead.title}${blocked ? ' (blocked)' : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  transform={`translate(${node.x}, ${node.y})`}
                  className={cn('cursor-pointer focus:outline-none', 'group')}
                  onClick={() => onSelect(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(node.id);
                    }
                  }}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill={selected ? 'var(--color-surface-active)' : 'var(--color-surface)'}
                    stroke={style.color}
                    strokeWidth={selected ? 2.5 : 1.5}
                    className="group-focus-visible:outline-2 group-focus-visible:outline-offset-2"
                    style={{ outlineColor: 'var(--color-border-strong)' }}
                  />
                  <text x={8} y={18} fontSize={10} fill="var(--color-fg-muted)" fontFamily="monospace">
                    {node.id}
                  </text>
                  <text x={8} y={34} fontSize={12} fill="var(--color-fg-strong)">
                    {title}
                  </text>
                  {blocked ? (
                    <text x={8} y={48} fontSize={10} fill="var(--color-warning)">
                      Blocked
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
