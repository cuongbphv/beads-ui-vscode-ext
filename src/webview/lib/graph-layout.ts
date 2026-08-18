/**
 * Sugiyama-lite layout for the dependency graph: layered DAG, longest-path
 * layering, one barycenter ordering pass, fixed grid coordinates.
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
export const COL_W = 220;
/** Vertical distance between siblings ordered within the same layer. */
export const ROW_H = 72;
/** Node box size, used by `GraphView` for the `<rect>` and hit target. */
export const NODE_W = 160;
export const NODE_H = 56;

/** Edge kinds the v1 graph draws. `related` / `discovered-from` are a later toggle. */
const RENDERED_KINDS = new Set(['blocks', 'parent-child']);

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  bead: Bead;
}

export interface GraphEdgePoint {
  x: number;
  y: number;
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
 * One barycenter pass: within each layer, order nodes by the average layer
 * position of their predecessors (the nodes pointing into them), falling
 * back to `compareBeads` then id so two siblings with no shared neighbour —
 * or no neighbours at all — still land in a stable, deterministic order.
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
  // Seed layer 0 by the deterministic tie-break; every later layer's
  // barycenter is computed against the previous layer's *already assigned*
  // order, so this seed is what everything else is built on.
  layerBuckets[0].sort((a, b) => compareBeads(byId.get(a)!, byId.get(b)!) || a.localeCompare(b));
  layerBuckets[0].forEach((id, index) => order.set(id, index));

  const predecessorsOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = predecessorsOf.get(edge.to);
    if (list) list.push(edge.from);
    else predecessorsOf.set(edge.to, [edge.from]);
  }

  for (let layer = 1; layer <= maxLayer; layer++) {
    const bucket = layerBuckets[layer];
    const barycenterOf = new Map<string, number>();
    for (const id of bucket) {
      const predecessors = (predecessorsOf.get(id) ?? []).filter((p) => order.has(p));
      if (predecessors.length === 0) {
        barycenterOf.set(id, Number.POSITIVE_INFINITY);
      } else {
        const sum = predecessors.reduce((acc, p) => acc + (order.get(p) ?? 0), 0);
        barycenterOf.set(id, sum / predecessors.length);
      }
    }

    bucket.sort((a, b) => {
      const ba = barycenterOf.get(a) ?? Number.POSITIVE_INFINITY;
      const bb = barycenterOf.get(b) ?? Number.POSITIVE_INFINITY;
      if (ba !== bb) return ba - bb;
      return compareBeads(byId.get(a)!, byId.get(b)!) || a.localeCompare(b);
    });
    bucket.forEach((id, index) => order.set(id, index));
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

  const nodes: GraphNode[] = nodeIds
    .map((id) => {
      const layer = layers.get(id) ?? 0;
      const position = order.get(id) ?? 0;
      return { id, x: layer * COL_W, y: position * ROW_H, bead: byId.get(id)! };
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
      points: [
        { x: from.x + NODE_W, y: from.y + NODE_H / 2 },
        { x: to.x, y: to.y + NODE_H / 2 },
      ],
    };
  });

  const maxLayer = Math.max(...nodes.map((n) => n.x / COL_W));
  const maxOrder = Math.max(...nodes.map((n) => n.y / ROW_H));

  return {
    nodes,
    edges: graphEdges,
    width: (maxLayer + 1) * COL_W,
    height: (maxOrder + 1) * ROW_H,
  };
}
