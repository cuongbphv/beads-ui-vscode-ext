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
import { RotateCcw, ZoomIn, ZoomOut, Waypoints } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { typeStyle, type Bead } from '../../shared/types';
import { EmptyState, Button } from '../components/primitives';
import { pastDragThreshold } from '../lib/bar-drag';
import { shouldActOnPointerMove } from '../lib/drag-resize';
import {
  arrowNudge,
  buildGraphLayout,
  edgeEndpoints,
  NODE_H,
  NODE_W,
  type GraphEdgePoint,
} from '../lib/graph-layout';
import { cn } from '../lib/utils';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;

/** A node's current position: its auto-layout coordinate, or a drag/nudge override. */
type Overrides = Record<string, GraphEdgePoint>;

/** In-flight pointer drag, tracked outside React state so a move handler never lags a render. */
interface DragState {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  moved: boolean;
}

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

  // Manual repositioning, by drag or arrow-key nudge. Deliberately session-only
  // state — never written back to `beads` or persisted — so reopening the
  // webview (or the board changing under it) always starts from a clean
  // auto-layout again; this is a scope decision, not an oversight.
  const [overrides, setOverrides] = useState<Overrides>({});
  // One in-flight drag at a time, kept in a ref rather than state: a pointer
  // handler reads it synchronously on every move, and state would either lag
  // a frame behind the render that set it or force a wasted extra render per
  // pixel dragged.
  const dragRef = useRef<DragState | null>(null);
  // Set on pointerdown, cleared on release/cancel — a click immediately after
  // a drag that crossed the threshold must not also select the node.
  const suppressNextClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined);

  const nodeIds = useMemo(() => new Set(layout.nodes.map((node) => node.id)), [layout]);

  // A bead disappearing from the board (closed, filtered, deleted) must not
  // leave its dragged position sitting in state forever — that would both
  // leak memory over a long-lived webview and falsely keep "Reset" enabled
  // for a node nobody can see any more.
  useEffect(() => {
    setOverrides((prev) => {
      let changed = false;
      const next: Overrides = {};
      for (const [id, position] of Object.entries(prev)) {
        if (nodeIds.has(id)) next[id] = position;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [nodeIds]);

  const positions = useMemo(() => {
    const map = new Map<string, GraphEdgePoint>();
    for (const node of layout.nodes) {
      map.set(node.id, overrides[node.id] ?? { x: node.x, y: node.y });
    }
    return map;
  }, [layout, overrides]);

  // The auto-layout's own width/height is the floor; a dragged node is only
  // ever allowed to grow the canvas, never shrink it below what every other
  // node already needs.
  const bounds = useMemo(() => {
    let minX = 0;
    let minY = 0;
    let maxX = layout.width;
    let maxY = layout.height;
    for (const [id, position] of positions) {
      if (!(id in overrides)) continue;
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + NODE_W);
      maxY = Math.max(maxY, position.y + NODE_H);
    }
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }, [layout, positions, overrides]);

  const moveNode = (id: string, position: GraphEdgePoint): void =>
    setOverrides((prev) => ({ ...prev, [id]: position }));

  const resetLayout = (): void => setOverrides({});

  const onNodePointerDown = (event: ReactPointerEvent<SVGGElement>, id: string): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = positions.get(id) ?? { x: 0, y: 0 };
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: start.x,
      startY: start.y,
      moved: false,
    };
    setDraggingId(id);
  };

  const onNodePointerMove = (event: ReactPointerEvent<SVGGElement>, id: string): void => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    const captureStillHeld = event.currentTarget.hasPointerCapture(event.pointerId);
    if (!shouldActOnPointerMove(true, captureStillHeld)) return;

    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    drag.moved = pastDragThreshold(drag.moved, Math.hypot(deltaX, deltaY));
    if (!drag.moved) return;
    moveNode(id, { x: drag.startX + deltaX, y: drag.startY + deltaY });
  };

  const endDrag = (event: ReactPointerEvent<SVGGElement>, id: string): void => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) suppressNextClickRef.current = true;
    dragRef.current = null;
    setDraggingId(undefined);
  };

  // Capture can be lost with no `pointerup`/`pointercancel` at all — an OS
  // gesture, a window blur, another element stealing it. Without this the
  // node would stay glued to the last position the drag reached, unable to
  // be moved or released ever again.
  const onNodeLostPointerCapture = (id: string): void => {
    if (dragRef.current?.id === id) {
      dragRef.current = null;
      setDraggingId(undefined);
    }
  };

  const onNodeClick = (id: string): void => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onSelect(id);
  };

  const onNodeKeyDown = (event: ReactKeyboardEvent<SVGGElement>, id: string): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(id);
      return;
    }
    const nudge = arrowNudge(event.key, event.shiftKey);
    if (!nudge) return;
    event.preventDefault();
    const current = positions.get(id) ?? { x: 0, y: 0 };
    moveNode(id, { x: current.x + nudge.dx, y: current.y + nudge.dy });
  };

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
          <Button
            variant="ghost"
            title="Reset layout"
            onClick={resetLayout}
            disabled={Object.keys(overrides).length === 0}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Reset layout</span>
          </Button>
          <span aria-hidden="true" className="border-border mx-1 h-4 border-l" />
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
          width={bounds.width * zoom}
          height={bounds.height * zoom}
          viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
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
              // Recomputed from each end's *current* position (drag override
              // or original layout coordinate) rather than the fixed points
              // `buildGraphLayout` produced, so a dragged node's edges follow
              // it instead of staying pinned to where it started.
              const fromPos = positions.get(edge.from);
              const toPos = positions.get(edge.to);
              if (!fromPos || !toPos) return null;
              const [start, end] = edgeEndpoints(fromPos, toPos);
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
            {/* The node being dragged paints last (on top of its siblings) so
                it never visually disappears under a neighbour mid-drag. */}
            {[...layout.nodes]
              .sort((a, b) => Number(a.id === draggingId) - Number(b.id === draggingId))
              .map((node) => {
                const style = typeStyle(node.bead.issue_type);
                const selected = node.id === selectedId;
                const blocked = blockedIds.has(node.id);
                const dragging = node.id === draggingId;
                const pos = positions.get(node.id) ?? { x: node.x, y: node.y };
                const title =
                  node.bead.title.length > 22 ? `${node.bead.title.slice(0, 21)}…` : node.bead.title;

                return (
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.id}: ${node.bead.title}${blocked ? ' (blocked)' : ''}`}
                    aria-current={selected ? 'true' : undefined}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className={cn(
                      'cursor-grab touch-none focus:outline-none',
                      dragging && 'cursor-grabbing',
                      'group',
                    )}
                    style={dragging ? { filter: 'drop-shadow(0 4px 6px rgb(0 0 0 / 0.35))' } : undefined}
                    onPointerDown={(event) => onNodePointerDown(event, node.id)}
                    onPointerMove={(event) => onNodePointerMove(event, node.id)}
                    onPointerUp={(event) => endDrag(event, node.id)}
                    onPointerCancel={(event) => endDrag(event, node.id)}
                    onLostPointerCapture={() => onNodeLostPointerCapture(node.id)}
                    onClick={() => onNodeClick(node.id)}
                    onKeyDown={(event) => onNodeKeyDown(event, node.id)}
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
