/**
 * Derivations over the bead list: hierarchy, board columns, progress, search.
 *
 * Lives in `shared/` on purpose — the sidebar tree (extension host) and the
 * dashboard (webview) must agree on what "an epic's progress" means, and the
 * only way to guarantee that is one implementation.
 */
import { isSameActor, normalizeActor } from './actor';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  PARENT_CHILD,
  edgeKind,
  edgeTargetId,
  isPlanType,
  toCategory,
  type Bead,
  type BdGate,
  type BeadDependency,
  type BoardColumn,
  type EpicGroup,
  type StatusCategory,
  type StatusDef,
} from './types';

/** Fast lookups over the runtime status vocabulary. Never hardcode a status. */
export class StatusIndex {
  private readonly byName = new Map<string, StatusDef>();

  constructor(readonly statuses: StatusDef[]) {
    for (const status of statuses) this.byName.set(status.name, status);
  }

  category(statusName: string | undefined): StatusCategory {
    if (!statusName) return 'unspecified';
    return toCategory(this.byName.get(statusName)?.category);
  }

  def(statusName: string): StatusDef | undefined {
    return this.byName.get(statusName);
  }

  isDone(statusName: string | undefined): boolean {
    return this.category(statusName) === 'done';
  }

  /** Status names in a category, in the order bd reported them. */
  namesIn(category: StatusCategory): string[] {
    return this.statuses.filter((s) => toCategory(s.category) === category).map((s) => s.name);
  }

  /** Categories actually present in the vocabulary, in board order. */
  categoriesPresent(): StatusCategory[] {
    const present = new Set(this.statuses.map((s) => toCategory(s.category)));
    return CATEGORY_ORDER.filter((category) => present.has(category));
  }
}

/**
 * Resolve an issue's parent. bd inlines `parent` on list rows, but `bd show`
 * output only carries the raw edge list, so fall back to that.
 */
export function parentIdOf(bead: Bead): string | undefined {
  if (bead.parent) return bead.parent;
  const edge = bead.dependencies?.find((candidate) => edgeKind(candidate) === PARENT_CHILD);
  return edge ? edgeTargetId(edge) : undefined;
}

/** Every edge of a given kind, normalised to `{id, kind}` regardless of shape. */
export function edgesOfKind(
  bead: Bead,
  kind: string,
): Array<{ id: string; edge: BeadDependency }> {
  return (bead.dependencies ?? [])
    .filter((edge) => edgeKind(edge) === kind)
    .map((edge) => ({ id: edgeTargetId(edge) ?? '', edge }))
    .filter((entry) => entry.id !== '');
}

/**
 * Group issues under their epic.
 *
 * Anything whose parent is missing from the list — an orphan, or a child whose
 * epic was filtered out — lands in a synthetic "No epic" group rather than
 * disappearing, which is the failure mode that makes other beads UIs untrustworthy.
 * The group is about *parentage*, not ownership; unowned work is a separate
 * question answered by `buildSidebarSections`.
 */
export function groupByEpic(beads: Bead[], index: StatusIndex): EpicGroup[] {
  const byId = new Map(beads.map((bead) => [bead.id, bead]));
  const childrenOf = new Map<string, Bead[]>();
  const loose: Bead[] = [];

  for (const bead of beads) {
    if (bead.issue_type === 'epic') continue;
    const parentId = parentIdOf(bead);
    if (parentId && byId.has(parentId)) {
      const bucket = childrenOf.get(parentId);
      if (bucket) bucket.push(bead);
      else childrenOf.set(parentId, [bead]);
    } else {
      loose.push(bead);
    }
  }

  const groups: EpicGroup[] = beads
    .filter((bead) => bead.issue_type === 'epic')
    .map((epic) => toGroup(epic, childrenOf.get(epic.id) ?? [], index));

  // Non-epic parents happen (a task can parent a subtask); surface them too.
  for (const [parentId, children] of childrenOf) {
    const parent = byId.get(parentId);
    if (parent && parent.issue_type !== 'epic') groups.push(toGroup(parent, children, index));
  }

  groups.sort(compareBeadsBy((group: EpicGroup) => group.epic));

  if (loose.length > 0) {
    groups.push({
      epic: {
        id: '__unassigned__',
        title: 'No epic',
        status: 'open',
        priority: 4,
        issue_type: 'epic',
      },
      children: [...loose].sort(compareBeads),
      doneCount: loose.filter((bead) => index.isDone(bead.status)).length,
      totalCount: loose.length,
    });
  }

  return groups;
}

function toGroup(epic: Bead, children: Bead[], index: StatusIndex): EpicGroup {
  const sorted = [...children].sort(compareBeads);
  return {
    epic,
    children: sorted,
    doneCount: sorted.filter((bead) => index.isDone(bead.status)).length,
    totalCount: sorted.length,
  };
}

/**
 * Kanban columns, derived from status *categories* at runtime.
 *
 * A project with a custom `in_review` status gets it folded into whichever
 * category bd assigned it — the board never needs to know the name exists.
 */
export function buildColumns(beads: Bead[], index: StatusIndex): BoardColumn[] {
  const categories = index.categoriesPresent();
  const buckets = new Map<StatusCategory, Bead[]>(categories.map((c) => [c, []]));

  for (const bead of beads) {
    const category = index.category(bead.status);
    const bucket = buckets.get(category);
    if (bucket) bucket.push(bead);
    else buckets.set(category, [bead]); // status bd never declared — still show it
  }

  return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    statuses: index.namesIn(category),
    beads: (buckets.get(category) ?? []).sort(compareBeads),
  }));
}

/** Priority first, then most-recently-updated — the order a reviewer scans in. */
export function compareBeads(a: Bead, b: Bead): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const left = a.updated_at ?? a.created_at ?? '';
  const right = b.updated_at ?? b.created_at ?? '';
  if (left !== right) return right.localeCompare(left);
  return a.id.localeCompare(b.id);
}

function compareBeadsBy<T>(select: (item: T) => Bead): (a: T, b: T) => number {
  return (a, b) => compareBeads(select(a), select(b));
}

export interface BeadQuery {
  text?: string;
  types?: string[];
  assignees?: string[];
  epicId?: string;
  priorityMax?: number;
  includeClosed?: boolean;
}

/** Client-side filtering for the quick-filter bar. bd is not re-queried per keystroke. */
export function filterBeads(beads: Bead[], query: BeadQuery, index: StatusIndex): Bead[] {
  const needle = query.text?.trim().toLowerCase();

  return beads.filter((bead) => {
    if (!query.includeClosed && index.isDone(bead.status)) return false;
    if (query.types?.length && !query.types.includes(bead.issue_type)) return false;
    if (query.assignees?.length && !query.assignees.includes(bead.assignee ?? '')) return false;
    if (query.epicId && parentIdOf(bead) !== query.epicId && bead.id !== query.epicId) return false;
    if (typeof query.priorityMax === 'number' && bead.priority > query.priorityMax) return false;

    if (needle) {
      const haystack = `${bead.id} ${bead.title} ${bead.labels?.join(' ') ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Percentage of an epic's children that are done. Returns 0 for an empty epic. */
export function progressOf(group: EpicGroup): number {
  if (group.totalCount === 0) return 0;
  return Math.round((group.doneCount / group.totalCount) * 100);
}

/** Every distinct assignee present, for the filter dropdown. */
export function assigneesOf(beads: Bead[]): string[] {
  const seen = new Set<string>();
  for (const bead of beads) if (bead.assignee) seen.add(bead.assignee);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Gates actionable from the sidebar: only `human` ones. Timer and CI
 * (`gh:run` / `gh:pr` / `bead`) gates clear themselves, so surfacing them in
 * "Needs You" would be noise nobody can act on.
 *
 * Pulled out as a pure function — rather than inlined in the tree provider —
 * so it is unit-testable without the `vscode` module the provider requires.
 */
export function humanGates(gates: BdGate[]): BdGate[] {
  return gates.filter((gate) => gate.await_type === 'human');
}

/**
 * The three questions the sidebar answers.
 *
 * They are lenses, not a partition: an issue assigned to you and parented to an
 * epic is in both `mine` and `plan`, exactly as it is in real life. `plan` is
 * the one that covers everything — nothing can fall out of the tree by being
 * filtered out of the other two.
 */
export interface SidebarSections {
  /** What you are the PIC of and it is not finished. */
  mine: Bead[];
  /** The Epic → Task hierarchy, plus a "No epic" bucket for orphans. */
  plan: EpicGroup[];
  /** Open work nobody owns — the triage queue. */
  unassigned: Bead[];
}

export interface SidebarOptions {
  /** Who "you" are; without it the `mine` section cannot be computed. */
  me?: string;
  /** Whether finished work stays in the plan tree. */
  showClosed?: boolean;
  /** Ids from `bd ready`, used to float startable work to the top of `mine`. */
  readyIds?: readonly string[];
}

export function buildSidebarSections(
  beads: Bead[],
  index: StatusIndex,
  options: SidebarOptions = {},
): SidebarSections {
  // "Needs you" and "nobody owns this" are both about work still to do, so
  // closed issues leave them regardless of the showClosed setting — that
  // setting is about how much of the *plan* you want to see.
  const open = beads.filter((bead) => !index.isDone(bead.status));
  const ready = new Set(options.readyIds ?? []);

  const mine = options.me
    ? open
        .filter((bead) => isSameActor(bead.assignee, options.me))
        .sort((a, b) => {
          // Startable first: within your own queue, blocked work is noise.
          const byReady = Number(ready.has(b.id)) - Number(ready.has(a.id));
          return byReady !== 0 ? byReady : compareBeads(a, b);
        })
    : [];

  const unassigned = open
    .filter((bead) => !normalizeActor(bead.assignee) && !isPlanType(bead.issue_type))
    .sort(compareBeads);

  const plan = groupByEpic(options.showClosed ? beads : open, index);

  return { mine, plan, unassigned };
}

/** Every distinct issue type present, so the filter only offers types in use. */
export function typesOf(beads: Bead[]): string[] {
  const seen = new Set<string>();
  for (const bead of beads) if (bead.issue_type) seen.add(bead.issue_type);
  return [...seen].sort((a, b) => a.localeCompare(b));
}
