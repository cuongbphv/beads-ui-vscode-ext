/**
 * Swimlanes: group board columns by the label taxonomy a review pipeline
 * assigns (`auto-ok` / `auto-partial` / `needs-human`), plus an `unlabeled`
 * lane for anything the pipeline has not touched yet.
 *
 * Lives in `lib/` on the same footing as `board-columns.ts` — pure grouping
 * logic, no React, so it is unit-testable without mounting the board and the
 * view stays presentational.
 *
 * It also owns the *encoding* of board droppable ids (`laneDropId`,
 * `narrowDropId`, `parseDropId`), so that string shape is written and read in
 * exactly one place rather than being rebuilt by every caller.
 */
import type { StatusIndex } from '../../shared/model';
import { buildColumns } from '../../shared/model';
import { isPlanType } from '../../shared/types';
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
 *
 * Plan-type beads (epics, milestones) never enter the unlabeled lane: the
 * review pipeline labels work, not plans, so an unlabeled epic is the normal
 * state of an epic — not a triage gap worth a warning. One that a human
 * explicitly labelled still lands in its taxonomy lane.
 */
export function buildSwimlanes(beads: Bead[], index: StatusIndex): Swimlane[] {
  const buckets = new Map<TaxonomyLane, Bead[]>(TAXONOMY_LANES.map((lane) => [lane, []]));
  const unlabeled: Bead[] = [];

  for (const bead of beads) {
    const lane = laneOf(bead);
    if (lane === UNLABELED) {
      if (!isPlanType(bead.issue_type)) unlabeled.push(bead);
    } else {
      buckets.get(lane)?.push(bead);
    }
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

/** Separator between the parts of a composite droppable id. Never appears in a `StatusCategory` or a lane name. */
const DROP_SEPARATOR = '::';

/**
 * Marks a droppable as the *narrow* layout's copy of a column.
 *
 * The board mounts its narrow layout and its wide layout at the same time and
 * lets a container query hide one of them — so without this marker both copies
 * of a column would ask dnd-kit for the same droppable id. dnd-kit's registry
 * is a `Map` keyed by that id: the second registration silently replaces the
 * first, and which copy survives is decided by React effect order, not by which
 * one is on screen. The hidden copy would then be the only one dnd-kit knows
 * about, and a hidden element measures 0x0, so it wins nothing and the visible
 * column stops being a drop target at all.
 *
 * Marking one copy keeps both addressable. The hidden one still measures 0x0,
 * which is exactly how it loses: `rectIntersection` needs a non-zero overlap,
 * and `board-keyboard` skips zero-area targets.
 *
 * Never spoken aloud — see `dropTargetName`, which names the column, not the
 * breakpoint.
 */
const NARROW_MARKER = `narrow${DROP_SEPARATOR}`;

/** A droppable id that identifies both the lane and the column within it. */
export function laneDropId(lane: Lane, category: StatusCategory): string {
  return `${lane}${DROP_SEPARATOR}${category}`;
}

/** The narrow layout's own id for a column the wide layout also renders. */
export function narrowDropId(dropId: string): string {
  return `${NARROW_MARKER}${dropId}`;
}

/** What a board droppable id means. Every id parses; nothing here is optional guesswork. */
export interface BoardDropTarget {
  /** True for the narrow layout's copy of a column, false for the wide one. */
  narrow: boolean;
  /** The swimlane this column sits in, or `undefined` on the flat board. */
  lane?: string;
  /** The status category the column stands for — the only part a drop acts on. */
  category: string;
}

/**
 * The inverse of `laneDropId` / `narrowDropId`.
 *
 * Total rather than partial: a bare category (the flat wide board's own id
 * shape) parses to `{ narrow: false, category }` rather than `undefined`, so
 * callers never have to decide what a missing separator meant.
 */
export function parseDropId(id: string): BoardDropTarget {
  const narrow = id.startsWith(NARROW_MARKER);
  const rest = narrow ? id.slice(NARROW_MARKER.length) : id;

  const at = rest.indexOf(DROP_SEPARATOR);
  if (at === -1) return { narrow, category: rest };
  return {
    narrow,
    lane: rest.slice(0, at),
    category: rest.slice(at + DROP_SEPARATOR.length),
  };
}
