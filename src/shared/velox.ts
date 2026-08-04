/**
 * Velox roadmap ↔ beads.
 *
 * A Velox roadmap is a markdown file of task tables; beads is the tracker the
 * agent actually works from. Keeping them in step by hand is the tedious part,
 * so this module does the two directions:
 *
 *   import — every roadmap row that has no bead yet becomes one
 *   export — every roadmap checkbox is flipped to match its bead's status
 *
 * Parsing follows Velox's own `roadmap_sync.py` contract, because a file this
 * writes must still be readable by the engine:
 *   · a table is recognised by a header row containing both `Task` and `Status`
 *   · the Task cell is a bare ID, no backticks
 *   · the Status cell is exactly `[ ]`, `[~]` or `[x]`
 *   · a flip rewrites *every* row with that ID, so IDs are unique per file
 *
 * Framework-free on purpose: the extension host reads the files, the webview
 * renders the preview, and both must agree on what a row means.
 */
import type { Bead } from './types';

/** The three states Velox's parser accepts, and nothing else. */
export type RoadmapMark = '[ ]' | '[~]' | '[x]';

export const MARK_TODO: RoadmapMark = '[ ]';
export const MARK_PARTIAL: RoadmapMark = '[~]';
export const MARK_DONE: RoadmapMark = '[x]';

export interface RoadmapTask {
  /** `T402` — unique within the file. */
  id: string;
  /** The "Endpoint / Feature" or "Page / Component" cell. */
  feature: string;
  /** The "Source Reference" cell, if the table has one. */
  sourceRef?: string;
  /** The "Notes" cell, if the table has one. */
  notes?: string;
  /** The "Type" cell (S*B tables carry one), if present. */
  kind?: string;
  mark: RoadmapMark;
  /** Milestone heading this row lives under, e.g. `M004 — Settings, Scale…`. */
  milestone: string;
  /** Slice heading, e.g. `S4A: extension-host (Backend)`. */
  slice?: string;
  /** 0-based line index in the source file — what a flip rewrites. */
  line: number;
  /** Index of the status cell within the row's split cells. */
  statusCell: number;
  /** Index of the notes cell, when the table has one. */
  notesCell?: number;
}

export interface Roadmap {
  /** Path as given, kept so a preview can name the file. */
  file: string;
  milestone: string;
  tasks: RoadmapTask[];
}

/** Split a markdown table row into its cells, dropping the outer pipes. */
function cellsOf(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  const parts = trimmed.split('|');
  // A well-formed row is `| a | b |`, so the first and last pieces are empty.
  return parts.slice(1, parts.length - 1).map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  const cells = cellsOf(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function headerIndex(cells: string[], ...names: string[]): number {
  return cells.findIndex((cell) => {
    const lower = cell.toLowerCase();
    return names.some((name) => lower === name || lower.startsWith(`${name} `));
  });
}

function asMark(cell: string): RoadmapMark | undefined {
  if (cell === MARK_TODO || cell === MARK_DONE || cell === MARK_PARTIAL) return cell;
  return undefined;
}

/** A bare task ID: `T402`, `T1101`. Anything else is a prose row, not a task. */
const TASK_ID = /^T\d{3,4}$/;

export function parseRoadmap(text: string, file: string): Roadmap {
  const lines = text.split(/\r?\n/);
  const tasks: RoadmapTask[] = [];

  let milestone = '';
  let slice: string | undefined;

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];

    const heading = /^#\s+Milestone\s+(.+)$/.exec(line);
    if (heading) {
      milestone = heading[1].trim();
      continue;
    }

    const sliceHeading = /^##\s+Slice\s+(.+)$/.exec(line);
    if (sliceHeading) {
      slice = sliceHeading[1].trim();
      continue;
    }

    // A table starts at a header row followed by a separator row.
    const header = cellsOf(line);
    if (header.length === 0 || cursor + 1 >= lines.length || !isSeparator(lines[cursor + 1])) {
      continue;
    }

    const taskCell = headerIndex(header, 'task');
    const statusCell = headerIndex(header, 'status');
    if (taskCell === -1 || statusCell === -1) continue;

    const featureCell = headerIndex(header, 'endpoint / feature', 'page / component', 'feature');
    const sourceCell = headerIndex(header, 'source reference', 'source');
    const notesCell = headerIndex(header, 'notes');
    const kindCell = headerIndex(header, 'type');

    for (let row = cursor + 2; row < lines.length; row += 1) {
      const cells = cellsOf(lines[row]);
      if (cells.length === 0) break; // the table ended

      const id = cells[taskCell] ?? '';
      const mark = asMark(cells[statusCell] ?? '');
      if (!TASK_ID.test(id) || !mark) continue;

      tasks.push({
        id,
        feature: featureCell >= 0 ? (cells[featureCell] ?? '') : '',
        sourceRef: sourceCell >= 0 ? cells[sourceCell] : undefined,
        notes: notesCell >= 0 ? cells[notesCell] : undefined,
        kind: kindCell >= 0 ? cells[kindCell] : undefined,
        mark,
        milestone,
        slice,
        line: row,
        statusCell,
        notesCell: notesCell >= 0 ? notesCell : undefined,
      });

      cursor = row; // don't re-scan rows as potential headers
    }
  }

  return { file, milestone, tasks };
}

/**
 * The task ID a bead stands for.
 *
 * `external_ref` wins when it is set (that is what it is for); otherwise the
 * seeding convention — a title of `T402 — Large-list handling` — is used.
 */
export function veloxIdOf(bead: Bead): string | undefined {
  const ref = /^velox:(T\d{3,4})$/.exec(bead.external_ref ?? '');
  if (ref) return ref[1];
  const fromTitle = /^(T\d{3,4})\b/.exec(bead.title);
  return fromTitle ? fromTitle[1] : undefined;
}

/** Index beads by the roadmap task they represent. Later duplicates lose. */
export function indexByVeloxId(beads: Bead[]): Map<string, Bead> {
  const byId = new Map<string, Bead>();
  for (const bead of beads) {
    const id = veloxIdOf(bead);
    if (id && !byId.has(id)) byId.set(id, bead);
  }
  return byId;
}

/**
 * What a bead's status means in roadmap terms.
 *
 * The mapping is by status *category*, never by status name, so a project with
 * a custom `in_review` status gets `[~]` because bd filed it under `wip`.
 */
export function markFor(category: string): RoadmapMark {
  if (category === 'done') return MARK_DONE;
  if (category === 'wip') return MARK_PARTIAL;
  return MARK_TODO;
}

export interface ExportFlip {
  task: RoadmapTask;
  bead: Bead;
  from: RoadmapMark;
  to: RoadmapMark;
}

export interface ExportPlan {
  file: string;
  flips: ExportFlip[];
  /** Roadmap rows with no bead — nothing can be said about them. */
  unmatched: RoadmapTask[];
}

/**
 * Which checkboxes disagree with beads.
 *
 * Only rows whose mark would actually change are returned, so a "no changes"
 * result is a real answer rather than a rewrite of the whole file.
 */
export function planExport(
  roadmap: Roadmap,
  beads: Bead[],
  categoryOf: (bead: Bead) => string,
): ExportPlan {
  const byId = indexByVeloxId(beads);
  const flips: ExportFlip[] = [];
  const unmatched: RoadmapTask[] = [];

  for (const task of roadmap.tasks) {
    const bead = byId.get(task.id);
    if (!bead) {
      unmatched.push(task);
      continue;
    }
    const to = markFor(categoryOf(bead));
    if (to !== task.mark) flips.push({ task, bead, from: task.mark, to });
  }

  return { file: roadmap.file, flips, unmatched };
}

/**
 * Apply flips to the file's text.
 *
 * Only the status cell is rewritten; every other cell keeps its exact original
 * text, including whatever spacing the author used. A note is appended to the
 * Notes cell when one is supplied and the cell exists — Velox does the same.
 */
export function applyFlips(text: string, flips: ExportFlip[], note?: string): string {
  const lines = text.split(/\r?\n/);

  for (const flip of flips) {
    const line = lines[flip.task.line];
    if (line === undefined) continue;

    const parts = line.split('|');
    // `cellsOf` dropped the leading empty piece, so cell N is part N+1.
    const statusPart = flip.task.statusCell + 1;
    if (parts[statusPart] === undefined) continue;
    if (asMark(parts[statusPart].trim()) !== flip.from) continue; // moved under us

    parts[statusPart] = ` ${flip.to} `;

    if (note && flip.task.notesCell !== undefined) {
      const notesPart = flip.task.notesCell + 1;
      const existing = parts[notesPart]?.trim() ?? '';
      parts[notesPart] = ` ${existing ? `${existing}; ${note}` : note} `;
    }

    lines[flip.task.line] = parts.join('|');
  }

  // Preserve the file's line ending, so the write is a content diff only.
  return lines.join(text.includes('\r\n') ? '\r\n' : '\n');
}

export interface ImportItem {
  task: RoadmapTask;
  title: string;
  description: string;
  labels: string[];
  priority: number;
  /** The bead that already covers this row, when there is one. */
  existing?: Bead;
}

export interface ImportPlan {
  file: string;
  /** Rows with no bead — these would be created. */
  create: ImportItem[];
  /** Rows already tracked — listed so the preview can show full coverage. */
  existing: ImportItem[];
}

/** `M004 — Settings…` → `m004`; used as the milestone label. */
function milestoneLabel(milestone: string): string | undefined {
  const code = /^(M\d{3})/.exec(milestone);
  return code ? code[1].toLowerCase() : undefined;
}

/** `S4A: extension-host (Backend)` → `s4a`. */
function sliceLabel(slice: string | undefined): string | undefined {
  const code = slice ? /^(S\d[A-Z])/.exec(slice) : null;
  return code ? code[1].toLowerCase() : undefined;
}

/**
 * A roadmap row's priority. Velox roadmaps list tasks in priority order within
 * a slice but carry no explicit field, so the milestone number is used: earlier
 * milestones are more urgent. Everything lands in P1–P3, never P0.
 */
function priorityFor(milestone: string): number {
  const code = /^M(\d{3})/.exec(milestone);
  const number = code ? Number(code[1]) : 3;
  return Math.min(3, Math.max(1, number));
}

export function planImport(roadmap: Roadmap, beads: Bead[]): ImportPlan {
  const byId = indexByVeloxId(beads);
  const create: ImportItem[] = [];
  const existing: ImportItem[] = [];

  for (const task of roadmap.tasks) {
    const labels = ['roadmap', milestoneLabel(task.milestone), sliceLabel(task.slice)].filter(
      (label): label is string => label !== undefined,
    );

    const description = [
      task.feature,
      task.milestone ? `Milestone: ${task.milestone}` : undefined,
      task.slice ? `Slice: ${task.slice}` : undefined,
      task.sourceRef ? `Source reference: ${task.sourceRef}` : undefined,
      `Roadmap: ${roadmap.file}`,
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n');

    const item: ImportItem = {
      task,
      title: `${task.id} — ${shortTitle(task.feature)}`,
      description,
      labels,
      priority: priorityFor(task.milestone),
      existing: byId.get(task.id),
    };

    if (item.existing) existing.push(item);
    else create.push(item);
  }

  return { file: roadmap.file, create, existing };
}

/**
 * A roadmap feature cell is a paragraph; a bead title is a line. Cut at the
 * first colon or sentence break, and never mid-word.
 */
export function shortTitle(feature: string): string {
  const head = feature.split(/[:.]\s/)[0].trim();
  if (head.length <= 72) return head || feature.slice(0, 72);
  const cut = head.slice(0, 72);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`;
}
