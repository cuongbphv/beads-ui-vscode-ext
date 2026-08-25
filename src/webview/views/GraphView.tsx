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
import { Link2, RotateCcw, ZoomIn, ZoomOut, Waypoints } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import type { DepType } from '../../shared/protocol';
import { typeStyle, type Bead } from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';
import { EmptyState, Button } from '../components/primitives';
import { useToast } from '../components/toast';
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

/**
 * `bd dep add --type`'s allowlist, mirrored from `DEP_TYPES` in
 * `src/extension/panel/param-validation.ts` — CLI shape, not beads'
 * user-extensible vocabulary (same rationale as `DepType` itself being a
 * hardcoded union in `shared/protocol.ts`), so it is safe to repeat here
 * rather than reach across the extension/webview boundary for it.
 */
const DEP_KINDS: readonly DepType[] = [
  'blocks',
  'tracks',
  'related',
  'parent-child',
  'discovered-from',
  'until',
  'caused-by',
  'validates',
  'relates-to',
  'supersedes',
];

/** Kept clear of the viewport edge so the popover is never clipped off-screen. */
const PICKER_WIDTH = 180;
const PICKER_MAX_HEIGHT = 320;
const PICKER_MARGIN = 8;

/** Anchor point plus the target node, for the kind-picker popover. */
interface KindPickerState {
  targetId: string;
  x: number;
  y: number;
}

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
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined);

  const { notify } = useToast();

  // Link mode: armed by the toolbar toggle, disarmed by the same toggle or
  // Escape. `linkSource` is the first node clicked while armed; `kindPicker`
  // appears once a second, different node is clicked, and carries the
  // viewport anchor the popover renders at. All three are pure additive
  // session state — nothing here touches `overrides`/`graph-layout.ts`.
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | undefined>(undefined);
  const [kindPicker, setKindPicker] = useState<KindPickerState | undefined>(undefined);
  const kindPickerId = useId();

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

  // Same disappearing-node hazard as the `overrides` cleanup above: a link
  // source or pending target that scrolls out of the visible (edge-bearing)
  // set must not be left selected forever with nothing on screen to show it.
  useEffect(() => {
    setLinkSource((prev) => (prev && !nodeIds.has(prev) ? undefined : prev));
    setKindPicker((prev) => (prev && !nodeIds.has(prev.targetId) ? undefined : prev));
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

  /** Clears every piece of link-mode state in one call — the "disarm" the bead asks for. */
  const disarmLink = (): void => {
    setLinkMode(false);
    setLinkSource(undefined);
    setKindPicker(undefined);
  };

  const toggleLinkMode = (): void => {
    if (linkMode) {
      disarmLink();
      return;
    }
    setLinkMode(true);
    setLinkSource(undefined);
    setKindPicker(undefined);
  };

  // Escape disarms link mode from anywhere on the page — a node mid-selection
  // or a popover left open — while armed. Registered on `document`, same as
  // `Popover`'s own dismiss listener, since focus while linking may be on any
  // node, not a fixed trigger element.
  useEffect(() => {
    if (!linkMode) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      disarmLink();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [linkMode]);

  /**
   * Click or Enter/Space on a node. Outside link mode this is unchanged
   * (select the node). Armed, it drives the two-click flow: first activation
   * arms the source (ring highlight), a second activation on a *different*
   * node opens the kind picker anchored at `anchor`'s own position, and
   * re-activating the source itself deselects it. A pending picker eats
   * further activations until it is resolved or Escape closes it.
   */
  const activateNode = (id: string, anchor: SVGGElement): void => {
    if (!linkMode) {
      onSelect(id);
      return;
    }
    if (kindPicker) return;
    if (!linkSource) {
      setLinkSource(id);
      return;
    }
    if (id === linkSource) {
      setLinkSource(undefined);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const x = Math.max(PICKER_MARGIN, Math.min(rect.right + PICKER_MARGIN, window.innerWidth - PICKER_WIDTH - PICKER_MARGIN));
    const y = Math.max(PICKER_MARGIN, Math.min(rect.top, window.innerHeight - PICKER_MAX_HEIGHT - PICKER_MARGIN));
    setKindPicker({ targetId: id, x, y });
  };

  /** Fired by the kind picker: sends the edge, then always closes the picker. */
  const pickKind = async (kind: DepType): Promise<void> => {
    if (!kindPicker || !linkSource) return;
    const source = linkSource;
    const target = kindPicker.targetId;
    setKindPicker(undefined);
    setLinkSource(undefined);
    try {
      // New edge shows up via the normal post-mutation broadcast/refetch,
      // same as every other mutating RPC — no local graph-layout patch here.
      await call('addDependency', { id: source, dependsOn: target, type: kind });
      notify(`${source} → ${target} (${kind})`);
    } catch (error) {
      // A cycle bd refuses to create arrives here as an ordinary RpcError.
      notify(asRpcError(error).message, 'error');
    }
  };

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

  // Activation lives here, off `pointerup`, rather than off the native
  // `click` event React's `onClick` would otherwise wire up. `pointerup`
  // fires for every pointer device — including a CDP/Playwright-driven
  // synthetic mouse, which reliably delivers `pointerdown`/`pointerup` but
  // never the follow-on `click` a real browser synthesizes (the gap behind
  // beads-ui-vscode-ext-9e9.10). By the time `endDrag` runs it already knows
  // `drag.moved`, so it can tell a genuine click from a drag release just as
  // well as `onClick` could — and doing it here removes the dependency on
  // `click` firing at all, for every pointer device, not only real mice.
  // `pointercancel` (an aborted gesture — OS chrome, a stolen capture) must
  // not activate, so this only fires for an actual `pointerup`.
  const endDrag = (event: ReactPointerEvent<SVGGElement>, id: string): void => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved && event.type === 'pointerup' && event.button === 0) {
      activateNode(id, event.currentTarget);
    }
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

  const onNodeKeyDown = (event: ReactKeyboardEvent<SVGGElement>, id: string): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateNode(id, event.currentTarget);
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
        {linkMode ? (
          <span className="text-accent">
            {linkSource ? `Pick the issue to link ${linkSource} to, or Esc to cancel` : 'Click an issue to link from, or Esc to cancel'}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title={linkMode ? 'Cancel linking issues' : 'Link two issues'}
            aria-pressed={linkMode}
            onClick={toggleLinkMode}
            className={cn(
              'surface-interactive inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm',
              linkMode
                ? 'bg-surface-active text-fg-strong'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            <Link2 aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{linkMode ? 'Cancel linking issues' : 'Link two issues'}</span>
          </button>
          <span aria-hidden="true" className="border-border mx-1 h-4 border-l" />
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
                const isLinkSource = node.id === linkSource;
                const pos = positions.get(node.id) ?? { x: node.x, y: node.y };
                const title =
                  node.bead.title.length > 22 ? `${node.bead.title.slice(0, 21)}…` : node.bead.title;

                return (
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.id}: ${node.bead.title}${blocked ? ' (blocked)' : ''}${isLinkSource ? ' (link source)' : ''}`}
                    aria-current={selected ? 'true' : undefined}
                    aria-pressed={linkMode ? isLinkSource : undefined}
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
                    onKeyDown={(event) => onNodeKeyDown(event, node.id)}
                  >
                    {isLinkSource ? (
                      <rect
                        x={-4}
                        y={-4}
                        width={NODE_W + 8}
                        height={NODE_H + 8}
                        rx={11}
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                      />
                    ) : null}
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

      {kindPicker && linkSource ? (
        <LinkKindPicker
          id={kindPickerId}
          x={kindPicker.x}
          y={kindPicker.y}
          sourceId={linkSource}
          targetId={kindPicker.targetId}
          onPick={pickKind}
          onDismiss={() => setKindPicker(undefined)}
        />
      ) : null}
    </div>
  );
}

/**
 * The kind-picker popover for link mode's second click. Rendered outside the
 * SVG (as a fixed-position HTML overlay, not a `<foreignObject>`) so it can
 * use ordinary buttons and text, anchored at the target node's own
 * `getBoundingClientRect()` rather than a document-flow trigger — the one
 * respect in which this cannot be the shared `Popover` from
 * `components/popover.tsx`, which anchors to its own trigger button.
 *
 * Mirrors that component's keyboard/pointer contract regardless: focus moves
 * to the first option on open, and a pointerdown outside the panel dismisses
 * it. Escape is handled one level up, by `GraphView`'s own listener, since
 * Escape here must disarm the whole link mode, not just close this panel.
 */
function LinkKindPicker({
  id,
  x,
  y,
  sourceId,
  targetId,
  onPick,
  onDismiss,
}: {
  id: string;
  x: number;
  y: number;
  sourceId: string;
  targetId: string;
  onPick: (kind: DepType) => void;
  onDismiss: () => void;
}): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // pointerdown, not click: the panel must be gone before the press lands
    // on whatever is underneath it, same rationale as `Popover`.
    const onPointerDown = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onDismiss]);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  return (
    <div
      ref={rootRef}
      id={id}
      role="dialog"
      aria-label={`Choose how ${sourceId} links to ${targetId}`}
      style={{ position: 'fixed', left: x, top: y, width: PICKER_WIDTH, maxHeight: PICKER_MAX_HEIGHT }}
      className="bg-surface border-border z-50 flex flex-col gap-0.5 overflow-auto rounded-md border p-1 text-xs shadow-lg"
    >
      {DEP_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onPick(kind)}
          className="hover:bg-surface-hover w-full rounded px-2 py-1 text-left capitalize"
        >
          {kind}
        </button>
      ))}
    </div>
  );
}
