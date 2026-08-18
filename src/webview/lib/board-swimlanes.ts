/**
 * Swimlanes: group board columns by the label taxonomy a review pipeline
 * assigns (`auto-ok` / `auto-partial` / `needs-human`), plus an `unlabeled`
 * lane for anything the pipeline has not touched yet.
 *
 * Lives in `lib/` on the same footing as `board-columns.ts` — pure grouping
 * logic, no React, so it is unit-testable without mounting the board and the
 * view stays presentational.
 */
import type { StatusIndex } from '../../shared/model';
import { buildColumns } from '../../shared/model';
import type { Bead, BoardColumn, StatusCategory } from '../../shared/types';

/** Fixed lane order, most-conservative last so it reads left-to-right as "safer → needs attention". */
export const TAXONOMY_LANES = ['auto-ok', 'auto-partial', 'needs-human'] as const;
export type TaxonomyLane = (typeof TAXONOMY_LANES)[number];

/** A bead carrying none of the taxonomy labels lands here instead of vanishing. */
export const UNLABELED = 'unlabeled';

export type Lane = TaxonomyLane | typeof UNLABELED;

export interface Swimlane {
  lane: Lane;
  /** True only for the `unlabeled` lane — the one that needs a human's attention. */
  warning: boolean;
  columns: BoardColumn[];
}

/**
 * Which lane a bead belongs to.
 *
 * A bead can legitimately carry more than one taxonomy label (e.g. a partial
 * auto-fix that a human then flagged) — it must still appear exactly once, so
 * this picks the single most conservative label rather than the first one
 * seen: `needs-human` > `auto-partial` > `auto-ok`. Missing all three falls
 * back to `unlabeled` rather than being silently dropped from every lane.
 */
export function laneOf(bead: Bead): Lane {
  const labels = new Set(bead.labels ?? []);
  if (labels.has('needs-human')) return 'needs-human';
  if (labels.has('auto-partial')) return 'auto-partial';
  if (labels.has('auto-ok')) return 'auto-ok';
  return UNLABELED;
}

/**
 * Board columns, grouped into taxonomy lanes.
 *
 * The three taxonomy lanes always emit, even empty, so they stay valid drop
 * targets (dragging a card onto `needs-human` is how it gets labelled in the
 * first place, conceptually — today it only moves status, see BoardView).
 * `unlabeled` only emits when it actually has beads, so a fully-triaged board
 * does not carry a permanent empty warning lane.
 */
export function buildSwimlanes(beads: Bead[], index: StatusIndex): Swimlane[] {
  const buckets = new Map<TaxonomyLane, Bead[]>(TAXONOMY_LANES.map((lane) => [lane, []]));
  const unlabeled: Bead[] = [];

  for (const bead of beads) {
    const lane = laneOf(bead);
    if (lane === UNLABELED) unlabeled.push(bead);
    else buckets.get(lane)?.push(bead);
  }

  const lanes: Swimlane[] = TAXONOMY_LANES.map((lane) => ({
    lane,
    warning: false,
    columns: buildColumns(buckets.get(lane) ?? [], index),
  }));

  if (unlabeled.length > 0) {
    lanes.push({ lane: UNLABELED, warning: true, columns: buildColumns(unlabeled, index) });
  }

  return lanes;
}

/** Separator between lane and category in a composite droppable id. Never appears in a `StatusCategory`. */
const LANE_DROP_SEPARATOR = '::';

/** A droppable id that identifies both the lane and the column within it. */
export function laneDropId(lane: Lane, category: StatusCategory): string {
  return `${lane}${LANE_DROP_SEPARATOR}${category}`;
}

/**
 * The inverse of `laneDropId`.
 *
 * Returns `undefined` for a bare category id (no separator) rather than
 * throwing — that is exactly the shape a droppable uses when swimlanes are
 * off, so callers can try this first and fall back to treating the id as a
 * plain category.
 */
export function parseLaneDropId(id: string): { lane: string; category: string } | undefined {
  const at = id.indexOf(LANE_DROP_SEPARATOR);
  if (at === -1) return undefined;
  return { lane: id.slice(0, at), category: id.slice(at + LANE_DROP_SEPARATOR.length) };
}
