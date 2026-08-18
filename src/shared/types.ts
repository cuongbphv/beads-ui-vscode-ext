/**
 * Framework-free data model shared by the extension host and the webview.
 *
 * Field names mirror the JSON that `bd --json` emits (verified against
 * bd 1.1.2). Nothing here may import `vscode` or `react`.
 */

/** A beads status category. Kanban columns are grouped by this, never by name. */
export type StatusCategory = 'active' | 'wip' | 'done' | 'frozen' | 'unspecified';

/**
 * A status as reported by `bd statuses --json`. Statuses are user-extensible in
 * beads, so this list is loaded at runtime and never hardcoded.
 */
export interface StatusDef {
  name: string;
  category: StatusCategory;
  description?: string;
  /** Single-character glyph bd suggests for the status (e.g. "○", "◐", "✓"). */
  icon?: string;
  /** True when the status is user-defined rather than built into bd. */
  custom?: boolean;
}

/** An issue type as reported by `bd types --json`. Also user-extensible. */
export interface IssueTypeDef {
  name: string;
  description?: string;
  custom?: boolean;
}

/** Priority is an int 0..4 where 0 is most urgent. 0 is meaningful, never "unset". */
export type Priority = 0 | 1 | 2 | 3 | 4;

/**
 * One entry of a bead's `dependencies` array.
 *
 * bd reports this two different ways and both have to be understood:
 *
 *   `bd list --json`  → the raw edge: `{issue_id, depends_on_id, type}`
 *   `bd show --long`  → the *resolved* issue, with the edge kind moved onto it
 *                       as `dependency_type` and the id in `id`
 *
 * Reading the wrong one silently loses the whole Epic → Task hierarchy, so
 * `edgeTargetId` / `edgeKind` below are the only supported way to read it.
 */
export interface BeadDependency {
  /** Edge form: the issue the edge belongs to. */
  issue_id?: string;
  /** Edge form: the issue depended upon. */
  depends_on_id?: string;
  /** Edge form: `blocks` | `parent-child` | `related` | `discovered-from`. */
  type?: string;
  /** Resolved form: the depended-upon issue's id. */
  id?: string;
  /** Resolved form: its title, already fetched. */
  title?: string;
  /** Resolved form: the edge kind. */
  dependency_type?: string;
  status?: string;
  issue_type?: string;
  priority?: number;
  created_at?: string;
  created_by?: string;
  metadata?: string;
}

/** The id this edge points at, whichever shape bd used. */
export function edgeTargetId(edge: BeadDependency): string | undefined {
  return edge.depends_on_id ?? edge.id;
}

/** The kind of this edge, whichever shape bd used. */
export function edgeKind(edge: BeadDependency): string | undefined {
  return edge.type ?? edge.dependency_type;
}

/** The edge type beads uses to model the Epic → Task hierarchy. */
export const PARENT_CHILD = 'parent-child';

/**
 * The two core types that describe *plan* rather than work: an epic spans many
 * issues, a milestone marks a set of them complete and "contains no work
 * itself" (bd's own wording). Both belong in the plan section of the sidebar and
 * neither belongs in a triage list of unowned work.
 */
export const PLAN_TYPES = ['epic', 'milestone'] as const;

export function isPlanType(issueType: string | undefined): boolean {
  return (PLAN_TYPES as readonly string[]).includes(issueType ?? '');
}

/**
 * One issue, as returned by `bd list --json` / `bd show --json`.
 *
 * Field names and optionality mirror `internal/types/types.go` in the beads
 * source. List rows carry a subset; `bd show --long` fills in the rest.
 */
export interface Bead {
  id: string;
  title: string;
  description?: string;
  /** Implementation notes captured at planning time (`bd update --design`). */
  design?: string;
  /** Definition of done (`bd update --acceptance`). */
  acceptance_criteria?: string;
  /** Free-form running notes (`bd update --notes`). */
  notes?: string;
  /** Link to a specification document. */
  spec_id?: string;
  status: string;
  priority: number;
  issue_type: string;
  /** Person in charge — who is working on it now. */
  assignee?: string;
  /** Human owner for attribution; beads stores the git author email. */
  owner?: string;
  created_by?: string;
  labels?: string[];
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  closed_at?: string;
  close_reason?: string;
  closed_by_session?: string;
  /** When the work should be finished. Drives the timeline and the overdue flag. */
  due_at?: string;
  /** Hidden from `bd ready` until this moment. */
  defer_until?: string;
  /** Effort estimate in minutes. The timeline falls back to it when there is no due date. */
  estimated_minutes?: number;
  /** External tracker reference, e.g. "gh-9" or "jira-ABC". */
  external_ref?: string;
  /** Adapter that created the issue, when it was federated in. */
  source_system?: string;
  /** Arbitrary project metadata, as raw JSON. */
  metadata?: unknown;
  /** Persistent context marker rather than a work item. */
  pinned?: boolean;
  /** Not synced via git. */
  ephemeral?: boolean;
  /**
   * Id of the epic this issue hangs off. bd derives it from the `parent-child`
   * edge and inlines it on list rows, so the hierarchy costs no extra calls.
   */
  parent?: string;
  /** Every edge touching this issue, inlined by `bd list` / `bd ready`. */
  dependencies?: BeadDependency[];
  /** Present on rows returned by `bd show --children`. */
  dependency_type?: string;
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  /** Present on `bd blocked --json` rows. */
  blocked_by_count?: number;
  blocked_by?: string[];
  /** Present on `bd show --include-comments`. */
  comments?: BeadComment[];
}

/** What a gate is blocked on. `human` is the only kind the sidebar surfaces. */
export type GateAwaitType = 'human' | 'timer' | 'gh:run' | 'gh:pr' | 'bead';

/**
 * A gate, as returned by `bd gate list --json` (verified against bd 1.2.2).
 *
 * A gate is a real issue rather than a separate collection — `issue_type` is
 * always `'gate'` — so it carries the same core fields as `Bead`. The field
 * that names what it is waiting on is `await_type`, not `type`.
 */
export interface BdGate {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  issue_type: 'gate';
  owner?: string;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  await_type: GateAwaitType;
}

/** A comment attached to an issue (`bd show --include-comments`). */
export interface BeadComment {
  id?: string | number;
  issue_id?: string;
  author?: string;
  text?: string;
  created_at?: string;
}

/** Type display metadata: one icon and one hue per issue type. */
export interface TypeStyle {
  /** Tailwind text colour class for the icon and the type chip. */
  className: string;
  /** CSS colour for chart series and timeline bars. */
  color: string;
}

/**
 * A distinct hue per built-in issue type, so a board column can be scanned by
 * shape *and* colour. Custom types fall back to the neutral entry.
 */
export const TYPE_STYLES: Record<string, TypeStyle> = {
  epic: { className: 'text-type-epic', color: 'var(--color-type-epic)' },
  milestone: { className: 'text-type-milestone', color: 'var(--color-type-milestone)' },
  feature: { className: 'text-type-feature', color: 'var(--color-type-feature)' },
  bug: { className: 'text-type-bug', color: 'var(--color-type-bug)' },
  task: { className: 'text-type-task', color: 'var(--color-type-task)' },
  chore: { className: 'text-type-chore', color: 'var(--color-type-chore)' },
  decision: { className: 'text-type-decision', color: 'var(--color-type-decision)' },
  spike: { className: 'text-type-spike', color: 'var(--color-type-spike)' },
  story: { className: 'text-type-story', color: 'var(--color-type-story)' },
};

export const DEFAULT_TYPE_STYLE: TypeStyle = {
  className: 'text-fg-muted',
  color: 'var(--color-fg-muted)',
};

export function typeStyle(type: string | undefined): TypeStyle {
  return (type && TYPE_STYLES[type]) || DEFAULT_TYPE_STYLE;
}

/** Chart colour per priority, matching the dot on the cards. */
export const PRIORITY_COLORS: Record<number, string> = {
  0: 'var(--color-p0)',
  1: 'var(--color-p1)',
  2: 'var(--color-p2)',
  3: 'var(--color-p3)',
  4: 'var(--color-p4)',
};

/** Workspace facts from `bd context --json` — the cheapest bootstrap call. */
export interface BdContext {
  bd_version: string;
  beads_dir: string;
  repo_root: string;
  database?: string;
  backend?: string;
  dolt_mode?: string;
  project_id?: string;
  role?: string;
  is_worktree?: boolean;
  is_redirected?: boolean;
  sync_remote?: string;
}

/** Counters from `bd stats --json` (the `summary` object). */
export interface BdStats {
  total_issues: number;
  open_issues: number;
  in_progress_issues: number;
  blocked_issues: number;
  closed_issues: number;
  deferred_issues: number;
  pinned_issues: number;
  ready_issues: number;
  epics_eligible_for_closure?: number;
  average_lead_time_hours?: number;
}

/** The runtime vocabulary, cached per session after the first load. */
export interface BdVocabulary {
  statuses: StatusDef[];
  types: IssueTypeDef[];
}

/** Filters accepted by the issue list query. Mirrors the `bd list` flags we use. */
export interface BeadFilters {
  status?: string[];
  type?: string[];
  priority?: number;
  label?: string[];
  parent?: string;
  ready?: boolean;
  /** Include closed issues. `bd list` hides them unless `--all` is passed. */
  all?: boolean;
  limit?: number;
  sort?: string;
}

/** An epic plus its children and a done/total rollup, built in the webview. */
export interface EpicGroup {
  epic: Bead;
  children: Bead[];
  doneCount: number;
  totalCount: number;
}

/** A kanban column derived from a status category, never from a status name. */
export interface BoardColumn {
  category: StatusCategory;
  label: string;
  /** Every status name that maps into this column. */
  statuses: string[];
  beads: Bead[];
}

/** Everything the dashboard needs for a first paint, fetched in one round trip. */
export interface DashboardSnapshot {
  context: BdContext;
  vocabulary: BdVocabulary;
  stats: BdStats;
  beads: Bead[];
  readyIds: string[];
  blockedIds: string[];
  /** Open gates from `bd gate list --json`. Empty on a project with none. */
  gates: BdGate[];
  /** True when `beadsDashboard.issueLimit` truncated the list. */
  truncated: boolean;
  fetchedAt: string;
}

/** Priority display metadata. Colour alone never conveys priority — see MASTER.md. */
export const PRIORITY_LABELS: Record<number, string> = {
  0: 'P0 · Critical',
  1: 'P1 · High',
  2: 'P2 · Normal',
  3: 'P3 · Low',
  4: 'P4 · Trivial',
};

/** Human label for each status category, used as the board column heading. */
export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  // "Open", not "Ready": an issue blocked by a dependency still has an active
  // status, so this column is not the same set as `bd ready`.
  active: 'Open',
  wip: 'In Progress',
  done: 'Done',
  frozen: 'On Hold',
  unspecified: 'Other',
};

/** Column order on the board, left to right. */
export const CATEGORY_ORDER: StatusCategory[] = ['active', 'wip', 'frozen', 'done', 'unspecified'];

/** Normalise anything bd hands us into a known category. */
export function toCategory(value: string | undefined): StatusCategory {
  switch (value) {
    case 'active':
    case 'wip':
    case 'done':
    case 'frozen':
      return value;
    default:
      return 'unspecified';
  }
}

/** Clamp an arbitrary number into the 0..4 priority range. */
export function toPriority(value: number | undefined): Priority {
  if (typeof value !== 'number' || Number.isNaN(value)) return 2;
  const clamped = Math.min(4, Math.max(0, Math.round(value)));
  return clamped as Priority;
}
