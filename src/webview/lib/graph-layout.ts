/**
 * Sugiyama-lite layout for the dependency graph: layered DAG, longest-path
 * layering, alternating barycenter ordering, and measured node widths.
 *
 * Pure — no React, no DOM — so the whole algorithm is unit-testable without a
 * browser. `GraphView` only turns the numbers this produces into SVG.
 *
 * Data source is exactly the same `dependencies` array already inlined on
 * every bead in the snapshot (see `edgeTargetId` / `edgeKind` in
 * `shared/types.ts`) — no extra `bd`/RPC call.
 */
import { compareBeads } from '../../shared/model';
import { edgeKind, edgeTargetId, type Bead } from '../../shared/types';

/** Horizontal distance between layers (blocker → blocked, epic → child). */
export const COL_W = 340;
/** Vertical distance between siblings ordered within the same layer. */
export const ROW_H = 104;
/** Node box limits leave room for a readable two-line title and long issue IDs. */
export const NODE_W = 200;
export const NODE_MAX_W = 280;
export const NODE_H = 84;

export function nodeWidth(bead: Bead): number {
  const estimatedTextWidth = Math.max(bead.id.length * 6.2, bead.title.length * 3.5);
  return Math.min(NODE_MAX_W, Math.max(NODE_W, Math.ceil(estimatedTextWidth + 20)));
}

/** Wrap without splitting words where possible; clip only after two visible lines. */
export function nodeTitleLines(title: string, width: number): string[] {
  const maxChars = Math.max(12, Math.floor((width - 20) / 6.4));
  const words = title.trim().split(/\s+/).flatMap((word) => {
    const pieces: string[] = [];
    for (let start = 0; start < word.length; start += maxChars) pieces.push(word.slice(start, start + maxChars));
    return pieces;
  });
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!word) continue;
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(' ');
  return [lines[0].slice(0, maxChars), `${second.slice(0, maxChars - 1).trimEnd()}…`];
}

/** Edge kinds the v1 graph draws. `related` / `discovered-from` are a later toggle. */
const RENDERED_KINDS = new Set(['blocks', 'parent-child']);

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  bead: Bead;
  width: number;
}

/** Keyboard nudge step for a node without Shift held (see `arrowNudge`). */
export const NUDGE_PX = 8;

export interface GraphEdgePoint {
  x: number;
  y: number;
}

/**
 * Where an edge attaches to its two endpoint boxes, given *any* two
 * positions — not only the ones `buildGraphLayout` assigned.
 *
 * Pulled out of the layout pass so `GraphView` can recompute an edge's route
 * live while a node is being dragged, without re-running the whole
 * Sugiyama-lite algorithm: the edge always leaves the right-center of `from`
 * and arrives at the left-center of `to`, mirroring the fixed formula this
 * replaced (previously inlined at layout-build time only).
 */
export function edgeEndpoints(from: GraphEdgePoint, to: GraphEdgePoint, fromWidth = NODE_W): GraphEdgePoint[] {
  return [
    { x: from.x + fromWidth, y: from.y + NODE_H / 2 },
    { x: to.x, y: to.y + NODE_H / 2 },
  ];
}

/**
 * Keyboard equivalent of dragging a node: arrow keys nudge by `NUDGE_PX`,
 * Shift+arrow jumps a full grid cell (`COL_W`/`ROW_H`) — the mandatory
 * non-pointer path for repositioning a node, per this project's rule that no
 * interaction is mouse/touch-only. Returns `undefined` for any other key so
 * the caller knows not to `preventDefault()` it (Enter/Space selection, Tab
 * focus movement, etc. must pass through untouched).
 */
export function arrowNudge(key: string, shift: boolean): { dx: number; dy: number } | undefined {
  switch (key) {
    case 'ArrowRight':
      return { dx: shift ? COL_W : NUDGE_PX, dy: 0 };
    case 'ArrowLeft':
      return { dx: shift ? -COL_W : -NUDGE_PX, dy: 0 };
    case 'ArrowDown':
      return { dx: 0, dy: shift ? ROW_H : NUDGE_PX };
    case 'ArrowUp':
      return { dx: 0, dy: shift ? -ROW_H : -NUDGE_PX };
    default:
      return undefined;
  }
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  points: GraphEdgePoint[];
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

interface RawEdge {
  /** The edge's direction of "comes before": blocker → blocked, epic → child. */
  from: string;
  to: string;
  kind: string;
}

/**
 * Every edge worth drawing, in a single direction-normalised shape.
 *
 * `blocks` on a bead's `dependencies` entry means "I am blocked by this", so
 * bd's edge (issue → depends_on) is reversed here to (blocker → blocked) —
 * that is the order the graph draws arrows in and the order layering walks.
 * `parent-child` on a child's entry already points at its parent, so it is
 * reversed the same way to read (parent → child).
 *
 * Dangling edges — either end missing from `beads`, self-loops, or a kind
 * outside `RENDERED_KINDS` — are dropped here and never seen again, so they
 * cannot produce a ghost node downstream.
 */
function collectEdges(beads: Bead[]): RawEdge[] {
  const known = new Set(beads.map((bead) => bead.id));
  const edges: RawEdge[] = [];

  for (const bead of beads) {
    for (const dependency of bead.dependencies ?? []) {
      const kind = edgeKind(dependency);
      const targetId = edgeTargetId(dependency);
      if (!kind || !targetId) continue;
      if (!RENDERED_KINDS.has(kind)) continue;
      if (!known.has(targetId) || !known.has(bead.id)) continue;
      if (targetId === bead.id) continue; // self-loop: nothing to draw
      edges.push({ from: targetId, to: bead.id, kind });
    }
  }

  return edges;
}

/**
 * Longest-path layer of every node that has at least one edge, with cycles
 * broken by tracking the DFS recursion stack: an edge back into a node still
 * on the stack is a back-edge and is simply not followed, so a cyclic board
 * still terminates in O(V+E) instead of recursing forever.
 */
function computeLayers(nodeIds: string[], edges: RawEdge[]): Map<string, number> {
  const forwardEdgesTo = new Map<string, string[]>();
  for (const edge of edges) {
    const list = forwardEdgesTo.get(edge.to);
    if (list) list.push(edge.from);
    else forwardEdgesTo.set(edge.to, [edge.from]);
  }

  const layer = new Map<string, number>();
  const onStack = new Set<string>();

  function layerOf(id: string): number {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;

    onStack.add(id);
    let best = 0;
    for (const predecessor of forwardEdgesTo.get(id) ?? []) {
      if (onStack.has(predecessor)) continue; // back-edge: cycle, do not recurse
      best = Math.max(best, layerOf(predecessor) + 1);
    }
    onStack.delete(id);

    layer.set(id, best);
    return best;
  }

  for (const id of nodeIds) layerOf(id);
  return layer;
}

/**
 * Alternating forward/backward sweeps let shared successors influence earlier
 * layers too. Stable ties preserve the previous order, so every sweep is
 * deterministic and disconnected groups do not jump around.
 */
function orderLayers(
  layersOf: Map<string, number>,
  byId: Map<string, Bead>,
  edges: RawEdge[],
): Map<string, number> {
  const maxLayer = Math.max(0, ...layersOf.values());
  const layerBuckets: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const [id, layer] of layersOf) layerBuckets[layer].push(id);

  const order = new Map<string, number>();
  for (const bucket of layerBuckets) {
    bucket.sort((a, b) => compareBeads(byId.get(a)!, byId.get(b)!) || a.localeCompare(b));
    bucket.forEach((id, index) => order.set(id, index));
  }

  const predecessorsOf = new Map<string, string[]>();
  const successorsOf = new Map<string, string[]>();
  for (const edge of edges) {
    const predecessors = predecessorsOf.get(edge.to) ?? [];
    predecessors.push(edge.from);
    predecessorsOf.set(edge.to, predecessors);
    const successors = successorsOf.get(edge.from) ?? [];
    successors.push(edge.to);
    successorsOf.set(edge.from, successors);
  }

  function sweep(layer: number, neighboursOf: Map<string, string[]>): void {
    const bucket = layerBuckets[layer];
    const barycenterOf = new Map<string, number>();
    for (const id of bucket) {
      const neighbours = (neighboursOf.get(id) ?? []).filter((other) => layersOf.get(other) !== layer);
      barycenterOf.set(id, neighbours.length
        ? neighbours.reduce((sum, other) => sum + (order.get(other) ?? 0), 0) / neighbours.length
        : order.get(id) ?? 0);
    }

    bucket.sort((a, b) => {
      const ba = barycenterOf.get(a) ?? 0;
      const bb = barycenterOf.get(b) ?? 0;
      if (ba !== bb) return ba - bb;
      return (order.get(a) ?? 0) - (order.get(b) ?? 0);
    });
    bucket.forEach((id, index) => order.set(id, index));
  }

  for (let pass = 0; pass < 4; pass++) {
    for (let layer = 1; layer <= maxLayer; layer++) sweep(layer, predecessorsOf);
    for (let layer = maxLayer - 1; layer >= 0; layer--) sweep(layer, successorsOf);
  }

  return order;
}

/** Every bead that has at least one edge worth drawing, both ends included. */
function visibleIds(edges: RawEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    ids.add(edge.from);
    ids.add(edge.to);
  }
  return ids;
}

export function buildGraphLayout(beads: Bead[]): GraphLayout {
  const edges = collectEdges(beads);
  const visible = visibleIds(edges);

  if (visible.size === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const byId = new Map(beads.map((bead) => [bead.id, bead]));
  const nodeIds = [...visible];
  const layers = computeLayers(nodeIds, edges);
  const order = orderLayers(layers, byId, edges);
  const layerCounts = new Map<number, number>();
  for (const layer of layers.values()) layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
  const maxRows = Math.max(...layerCounts.values());

  const nodes: GraphNode[] = nodeIds
    .map((id) => {
      const layer = layers.get(id) ?? 0;
      const position = order.get(id) ?? 0;
      const bead = byId.get(id)!;
      // Center compact diagrams, but start tall graphs at the top so their
      // roots remain visible when the viewport initially opens at scroll 0.
      const centeredOffset = maxRows <= 6
        ? ((maxRows - (layerCounts.get(layer) ?? 0)) * ROW_H) / 2
        : 0;
      return { id, x: layer * COL_W, y: position * ROW_H + centeredOffset, bead, width: nodeWidth(bead) };
    })
    // Deterministic output order regardless of Set iteration order.
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const graphEdges: GraphEdge[] = edges.map((edge) => {
    const from = nodeById.get(edge.from)!;
    const to = nodeById.get(edge.to)!;
    return {
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      points: edgeEndpoints(from, to, from.width),
    };
  });

  const maxLayer = Math.max(...nodes.map((n) => n.x / COL_W));
  return {
    nodes,
    edges: graphEdges,
    width: (maxLayer + 1) * COL_W,
    height: maxRows * ROW_H,
  };
}
