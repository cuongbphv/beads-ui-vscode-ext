/**
 * Blocker-chain analysis: why is this bead blocked, transitively?
 *
 * Pure derivation over the already-loaded snapshot — a DFS along `blocks`
 * edges, no RPC, no bd subprocess. Lives in `shared/` because it is business
 * logic, not presentation, and must stay free of `vscode` and `react`.
 */
import { StatusIndex, edgesOfKind } from './model';
import type { Bead } from './types';

/** One row of the flattened chain, in DFS preorder. */
export interface BlockerNode {
  /** The blocker's issue id — always present, even when the bead is not loaded. */
  id: string;
  /** The blocker's record, when it is in the loaded collection. */
  bead?: Bead;
  /** 1 = blocks the inspected bead directly; 2 = blocks a direct blocker; … */
  depth: number;
  /** True when this edge closes a cycle back into the current chain. */
  cycle: boolean;
  /** True when the walk stopped here because `maxDepth` was reached. */
  truncated: boolean;
}

export interface BlockerChain {
  /** Preorder rows, ready to render as an indented list. Empty = not blocked. */
  nodes: BlockerNode[];
  /** True when any `blocks` edge loops back on itself — a data-entry bug worth surfacing. */
  hasCycle: boolean;
}

export interface BlockerChainOptions {
  /**
   * How deep the walk may go. Real dependency graphs are shallow; the cap only
   * exists so a pathological diamond lattice cannot make the pane unusable.
   */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 16;

/**
 * Walk `blocks` edges from `bead` to its OPEN blockers.
 *
 * - Closed blockers are excluded by status *category* (`StatusIndex.isDone`),
 *   never by status name — statuses are user-extensible in beads.
 * - Blockers missing from the loaded collection still get a row (their status
 *   is unknown, so hiding them would claim more than the data supports), but
 *   the walk cannot continue through them.
 * - Cycles are flagged via a visited-set over the *current path*: the closing
 *   edge is kept as a row with `cycle: true` and not expanded, so a diamond
 *   (the same blocker reached via two independent paths) is not a cycle.
 */
export function buildBlockerChain(
  bead: Bead,
  beads: Bead[],
  index: StatusIndex,
  options: BlockerChainOptions = {},
): BlockerChain {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const byId = new Map(beads.map((candidate) => [candidate.id, candidate]));
  const nodes: BlockerNode[] = [];
  let hasCycle = false;

  const walk = (current: Bead, depth: number, path: Set<string>): void => {
    const seenHere = new Set<string>();
    for (const { id } of edgesOfKind(current, 'blocks')) {
      if (seenHere.has(id)) continue; // duplicate edge to the same blocker
      seenHere.add(id);

      const target = byId.get(id);
      // A blocker that is done no longer blocks anything; drop its whole subtree.
      if (target && index.isDone(target.status)) continue;

      const cycle = path.has(id);
      const truncated = !cycle && target !== undefined && depth >= maxDepth;
      nodes.push({ id, bead: target, depth, cycle, truncated });

      if (cycle) {
        hasCycle = true;
        continue;
      }
      if (target && !truncated) {
        path.add(id);
        walk(target, depth + 1, path);
        path.delete(id);
      }
    }
  };

  walk(bead, 1, new Set([bead.id]));
  return { nodes, hasCycle };
}
