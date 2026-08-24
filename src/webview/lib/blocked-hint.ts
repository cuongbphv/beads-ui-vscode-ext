/**
 * Compact "why is this blocked" hint for an Overview Blocked-list row.
 *
 * Overview already flags every blocked bead (`BeadCard`'s lock icon); this
 * adds only the *direct* (depth-1) blocker's title next to it — never the
 * full transitive chain, which stays exclusive to the detail pane's
 * "Why blocked" section (bead 72m.5).
 *
 * Per-row cost is O(direct edges), not O(graph): reuse a `BlockerChain`
 * already computed for this bead elsewhere in the same render when the
 * caller has one (its depth-1 rows are the same regardless of how deep that
 * walk went), otherwise walk depth-1 only via
 * `buildBlockerChain(..., { maxDepth: 1 })`. The unbounded, multi-hop walk
 * never runs on this path.
 */
import { buildBlockerChain, type BlockerChain } from '../../shared/blocker-chain';
import type { StatusIndex } from '../../shared/model';
import type { Bead } from '../../shared/types';

export interface BlockedHint {
  /** The direct blocker's title, or its id when that bead is not loaded. */
  title: string;
  /** Additional direct blockers beyond the first; 0 when there is exactly one. */
  extra: number;
}

/**
 * `undefined` when the bead has no open direct blocker right now — e.g. a
 * stale poll tick still lists it as blocked after its last blocker closed.
 * Callers must leave the row unchanged in that case, not render an empty hint.
 */
export function directBlockerHint(
  bead: Bead,
  beads: Bead[],
  index: StatusIndex,
  precomputed?: BlockerChain,
): BlockedHint | undefined {
  const chain = precomputed ?? buildBlockerChain(bead, beads, index, { maxDepth: 1 });
  const direct = chain.nodes.filter((node) => node.depth === 1);
  if (direct.length === 0) return undefined;

  return { title: direct[0].bead?.title ?? direct[0].id, extra: direct.length - 1 };
}
