/**
 * The postMessage contract between the webview and the extension host.
 *
 * The webview never builds a `bd` argv; it calls one of the typed methods
 * below and the host translates. Framework-free: no `vscode`, no `react`.
 */
import type { FleetSnapshot, TranscriptBackfill, TranscriptBlock, TranscriptEvent, TranscriptPage } from './fleet';
import type { HistoryEvent } from './history-diff';
import type { MolDetail, MolSnapshot } from './mol';
import type {
  Bead,
  BeadComment,
  BeadFilters,
  DashboardSnapshot,
  HealthReport,
  Priority,
  SyncStatus,
} from './types';

/**
 * The text-shaped fields `bd update` can set with a single dedicated flag
 * (`--title`, `--description`, `--design`, `--acceptance`, `--notes`).
 * Hardcoded here deliberately: unlike status/type/priority this is not
 * beads' user-extensible vocabulary, it is CLI shape — the fixed set of
 * flags `bd update` exposes for whole-field text replacement.
 */
export type TextField = 'title' | 'description' | 'design' | 'acceptance' | 'notes';

/**
 * The dependency-edge kinds `bd dep add --type` accepts. Like `TextField`,
 * this is CLI shape, not beads' user-extensible vocabulary — the fixed enum
 * one dedicated flag exposes — so it is hardcoded here rather than loaded at
 * runtime. bd's own default when `--type` is omitted is `blocks`.
 */
export type DepType =
  | 'blocks'
  | 'tracks'
  | 'related'
  | 'parent-child'
  | 'discovered-from'
  | 'until'
  | 'caused-by'
  | 'validates'
  | 'relates-to'
  | 'supersedes';

/**
 * The runtime allowlist mirroring {@link DepType}, one value per member.
 *
 * Lives here rather than in `src/extension/panel/param-validation.ts` (which
 * imports it) because the webview's dependency-kind selector
 * (`bead-detail.tsx`'s Add-link control) needs the same list and must not
 * import from `src/extension/**` — the two bundles stay separate, and this
 * file is the one place both already draw shared, framework-free types
 * from. `param-validation.ts`'s `requireDepType` is still the router-side
 * enforcement point; this is the single array both it and the UI read.
 */
export const DEP_TYPES: readonly DepType[] = [
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

/**
 * Params for `createBead`, shared by the router's narrowing helper and
 * `BdMutations.create` so the narrowed shape and the argv builder cannot
 * drift apart.
 *
 * `type`, `priority` and `status` are plain strings, not enums: beads
 * vocabulary is user-extensible and loaded at runtime, so the CLI — not this
 * file — is the authority on which values exist.
 */
export interface CreateBeadParams {
  /** Required; the router rejects a blank title before any argv is built. */
  title: string;
  type?: string;
  priority?: string;
  parent?: string;
  labels?: string[];
  /** `YYYY-MM-DD`, same format `setDue` uses. */
  due?: string;
  /** Minutes, as bd stores them; must be a positive finite number. */
  estimate?: number;
  description?: string;
  design?: string;
  acceptance?: string;
  /**
   * `bd create` has no `--status` flag, so a requested status lands via a
   * follow-up `bd update <id> --status` after the create succeeds.
   */
  status?: string;
}

/** Every request the webview may send. Keys are the method names on the wire. */
export interface RpcMethods {
  /** One round trip that fills the whole dashboard. */
  getSnapshot: {
    params: { limit?: number } | undefined;
    result: DashboardSnapshot;
  };
  /** Issue list with filters, for drill-downs the snapshot does not cover. */
  listBeads: {
    params: BeadFilters;
    result: Bead[];
  };
  /** A single issue with optional comments; `bd show --json` returns an array. */
  showBead: {
    params: { id: string; includeComments?: boolean };
    result: { bead: Bead | null; comments: BeadComment[] };
  };
  /** Direct children of an epic, closed ones included. */
  listChildren: {
    params: { parentId: string };
    result: Bead[];
  };
  /**
   * Field-change events for one issue, derived host-side from `bd history`
   * snapshots (see `shared/history-diff.ts`) — never the raw snapshots
   * themselves. `limit` caps how many `bd history` commits are considered;
   * bd itself defaults to 50.
   */
  getHistory: {
    params: { id: string; limit?: number };
    result: HistoryEvent[];
  };
  setStatus: {
    params: { id: string; status: string; observedStatus: string };
    result: { ok: true };
  };
  setPriority: {
    params: { id: string; priority: Priority };
    result: { ok: true };
  };
  setAssignee: {
    params: { id: string; assignee: string; observedAssignee: string };
    result: { ok: true };
  };
  /** Atomic Beads ownership change (`bd update <id> --claim`). */
  claimBead: {
    params: { id: string };
    result: { ok: true };
  };
  closeBead: {
    params: { id: string; reason?: string };
    result: { ok: true };
  };
  /** Right-edge bar drag on an issue that carries a due date. `date` is YYYY-MM-DD. */
  setDue: {
    params: { id: string; date: string };
    result: { ok: true };
  };
  /** Right-edge bar drag on an issue with no due date. Minutes, as bd stores them. */
  setEstimate: {
    params: { id: string; minutes: number };
    result: { ok: true };
  };
  /** Reveal an issue in the sidebar tree / focus it in the editor. */
  revealBead: {
    params: { id: string };
    result: { ok: true };
  };
  /** Copy text to the clipboard via the host (the webview has no clipboard access). */
  copyText: {
    params: { text: string };
    result: { ok: true };
  };
  /** Post a comment (`bd comment id text`). `text` must be non-blank. */
  addComment: {
    params: { id: string; text: string };
    result: { ok: true };
  };
  /** Append to notes (`bd update id --append-notes text`), newline-joined by bd. */
  appendNotes: {
    params: { id: string; text: string };
    result: { ok: true };
  };
  /**
   * Replace one text-shaped field wholesale (`bd update <id> --<field> <text>`).
   * `title` rejects an empty `text` — an empty title is nonsensical and bd
   * itself will not accept one; the other four fields accept `''`, which is
   * bd's documented way to clear them.
   */
  updateText: {
    params: { id: string; field: TextField; text: string };
    result: { ok: true };
  };
  /** Create an issue (`bd create <title> --silent`); resolves with the new id. */
  createBead: {
    params: CreateBeadParams;
    result: { id: string };
  };
  /**
   * Add a dependency edge (`bd dep add <id> <dependsOn> --type <type>`).
   * The router rejects a self-edge (`id === dependsOn`) and a `type` outside
   * `DEP_TYPES` before any argv is built. `type` defaults to `'blocks'`, same
   * as bd itself. A cycle bd refuses to create surfaces as a normal
   * `RpcError` toast — no special-casing needed for that case.
   */
  addDependency: {
    params: { id: string; dependsOn: string; type?: DepType };
    result: { ok: true };
  };
  /**
   * Remove a dependency edge (`bd dep remove <id> <dependsOn>`). `bd dep
   * remove` takes no `--type` flag — measured against the live CLI in
   * `src/test/bd-live.test.ts`, it removes every edge kind between the pair,
   * not only the default `blocks` kind — so this method has no `type` param.
   */
  removeDependency: {
    params: { id: string; dependsOn: string };
    result: { ok: true };
  };
  /**
   * Add a label (`bd update <id> --add-label <label>`, confirmed against
   * `bd update --help` on the installed CLI). Labels are user-defined and
   * unbounded — like `assignee`, `label` is a plain string with no allowlist
   * to check it against; the router only rejects a blank one before any
   * argv is built.
   */
  addLabel: {
    params: { id: string; label: string };
    result: { ok: true };
  };
  /**
   * Remove a label (`bd update <id> --remove-label <label>`, confirmed
   * against `bd update --help` on the installed CLI).
   */
  removeLabel: {
    params: { id: string; label: string };
    result: { ok: true };
  };
  /**
   * Defer an issue (`bd defer <id> --until <until> --reason <reason>`),
   * confirmed against `bd defer --help` on the installed CLI. `until` is
   * NOT a `YYYY-MM-DD` date like `setDue`'s `date` — bd's `--until` takes a
   * free-form relative expression (`tomorrow`, `+1h`, `next monday`), so the
   * router only checks it is a non-blank string when present and leaves the
   * CLI as the authority on whether the expression parses. Both flags are
   * omitted from the argv, not passed blank, when absent.
   */
  deferBead: {
    params: { id: string; until?: string; reason?: string };
    result: { ok: true };
  };
  /**
   * Undefer an issue (`bd undefer <id>`). `bd undefer --help` confirms this
   * command takes no flags beyond the globals — no `--reason`.
   */
  undeferBead: {
    params: { id: string };
    result: { ok: true };
  };
  /**
   * Reopen a closed issue (`bd reopen <id> --reason <reason>`). `-r`/
   * `--reason` confirmed against `bd reopen --help` on the installed CLI.
   */
  reopenBead: {
    params: { id: string; reason?: string };
    result: { ok: true };
  };
  /** Start receiving `fleetChanged` events. Non-mutating: it observes the fleet, it does not run one. */
  subscribeFleet: {
    params: undefined;
    result: { ok: true };
  };
  /** Stop receiving `fleetChanged` events for this webview session. */
  unsubscribeFleet: {
    params: undefined;
    result: { ok: true };
  };
  /**
   * Start following one agent or session transcript. Returns the backfill —
   * everything already on disk — and the host follows up with
   * `transcriptAppend` events for anything written after.
   */
  subscribeTranscript: {
    params: { targetId: string };
    result: TranscriptBackfill;
  };
  /** Read one bounded page before the initial backfill or a previous page. */
  getTranscriptPage: {
    params: { targetId: string; beforeOffset: number };
    result: TranscriptPage;
  };
  /** Fetch one full source block when its bounded preview was truncated. */
  getTranscriptBlock: {
    params: { targetId: string; sourceKey: string; blockIndex: number };
    result: TranscriptBlock;
  };
  /** Stop receiving `transcriptAppend` events for this target. */
  unsubscribeTranscript: {
    params: { targetId: string };
    result: { ok: true };
  };
  /**
   * One round trip that fills the Molecules tab. Read-only, like
   * `getHistory` — it never appears in `MUTATING_METHODS`.
   */
  getMolSnapshot: {
    params: undefined;
    result: MolSnapshot;
  };
  /**
   * One molecule's step list for the Molecules tab's detail view: `bd mol
   * show <id> --parallel` plus best-effort gate badging and progress,
   * composed by `BdQueries.showMolecule`. Read-only — stays out of
   * {@link MUTATING_METHODS} — and fetched only while a molecule is
   * expanded in the Molecules tab.
   */
  showMolecule: {
    params: { id: string };
    result: MolDetail;
  };
  /**
   * Resolve a human gate (`bd gate resolve <id> [--reason <reason>]`),
   * delegating to the existing `BdMutations.resolveGate` (already used by
   * the `beadsDashboard.resolveGate` command). Mutating — see
   * {@link MUTATING_METHODS} — so the host refetches and broadcasts,
   * repainting the gate card list and every other view for free. The
   * webview only ever calls this for `await_type === 'human'` gates: bd's
   * own `bd gate create --help` documents `human` as the one type that
   * "requires manual bd gate resolve" — timer/gh:run/gh:pr/bead gates clear
   * themselves (a timeout elapses, a workflow finishes, a PR merges, a bead
   * closes). `bd gate resolve` itself does not refuse a non-human gate id
   * (it is "equivalent to bd close", per `bd gate resolve --help`), so this
   * is a UI-level policy choice, not a CLI-enforced one — never widen this
   * to non-human gates without re-reading that comment.
   */
  resolveGate: {
    params: { id: string; reason?: string };
    result: { ok: true };
  };
  /**
   * Read-only Dolt sync/engine status (`bd dolt status --json`), for the
   * header's sync chip. Fetched on demand — piggybacked on the manual
   * Refresh button, never on a poll tick — and never runs `bd dolt push` or
   * `bd dolt pull`; this method only reports, and stays out of
   * {@link MUTATING_METHODS} on purpose.
   */
  getSyncStatus: {
    // No fields, not "any value" — `{}` trips `no-empty-object-type` (it
    // would accept `0`/`""`/anything non-nullish); this is the empty-object
    // shape the doc comment above actually means.
    params: Record<string, never>;
    result: SyncStatus;
  };
  /**
   * On-demand project-health scorecard (`bd stale`/`bd orphans`/`bd
   * lint`/`bd dep cycles`, fanned out via `Promise.allSettled`; see
   * `BdQueries.healthReport`). Read-only — stays out of
   * {@link MUTATING_METHODS} — and fetched only when the webview's "Run
   * checks" button is pressed, never on the poll tick or on mount.
   *
   * `bd preflight` and `bd doctor` are deliberately excluded from this
   * report; see the doc comment on {@link HealthReport} in `shared/types.ts`
   * for why, before adding either here.
   */
  getHealthReport: {
    params: { staleDays?: number } | undefined;
    result: HealthReport;
  };
  /**
   * Server-side search fallback for a truncated workspace
   * (beads-ui-vscode-ext-72m.4): `bd search <text> --status all --limit
   * <limit> --json`, run only once the client-side filter bar can no
   * longer see the whole project. `limit` defaults to 50 — bd's own
   * default — when omitted. Read-only — stays out of
   * {@link MUTATING_METHODS} — and fetched only by `useServerSearch`, never
   * on the poll tick.
   */
  searchBeads: {
    params: { text: string; limit?: number };
    result: Bead[];
  };
}

export type RpcMethodName = keyof RpcMethods;
export type RpcParams<M extends RpcMethodName> = RpcMethods[M]['params'];
export type RpcResult<M extends RpcMethodName> = RpcMethods[M]['result'];

/** Which methods mutate state. The host refetches and broadcasts after these. */
export const MUTATING_METHODS: ReadonlySet<RpcMethodName> = new Set<RpcMethodName>([
  'setStatus',
  'setPriority',
  'setAssignee',
  'claimBead',
  'setDue',
  'setEstimate',
  'closeBead',
  'addComment',
  'appendNotes',
  'updateText',
  'createBead',
  'addDependency',
  'removeDependency',
  'addLabel',
  'removeLabel',
  'deferBead',
  'undeferBead',
  'reopenBead',
  'resolveGate',
]);

export interface RpcRequest<M extends RpcMethodName = RpcMethodName> {
  kind: 'request';
  /** Correlates the response; unique per webview session. */
  id: number;
  method: M;
  params: RpcParams<M>;
}

export interface RpcSuccess<M extends RpcMethodName = RpcMethodName> {
  kind: 'response';
  id: number;
  ok: true;
  data: RpcResult<M>;
}

export interface RpcFailure {
  kind: 'response';
  id: number;
  ok: false;
  error: RpcError;
}

export type RpcResponse<M extends RpcMethodName = RpcMethodName> = RpcSuccess<M> | RpcFailure;

/** A `bd` failure, normalised so the webview can render one readable message. */
export interface RpcError {
  /** Message safe to show in a toast. */
  message: string;
  /** bd's own error code when it emitted structured JSON on stderr. */
  code?: string;
  /** Process exit code, when the failure came from a non-zero exit. */
  exitCode?: number;
  /** Which of the known failure shapes this is — drives the empty-state UI. */
  kind: RpcErrorKind;
  /** Raw stderr, for the output channel. Never rendered verbatim in the UI. */
  detail?: string;
}

export type RpcErrorKind =
  /** `bd` is not installed or not on PATH. */
  | 'bd-not-found'
  /** No `.beads` directory — the user has not run `bd init`. */
  | 'no-workspace'
  /** bd ran and refused: bad status name, unknown id, routing misconfig. */
  | 'bd-error'
  /** A Beads compare-and-set guard found that another actor changed the issue. */
  | 'conflict'
  /** We could not parse what bd printed. */
  | 'bad-output'
  /** Anything else. */
  | 'unknown';

/**
 * The subset of `beadsDashboard.*` the webview needs.
 *
 * The webview cannot read settings — it has no `vscode` — so the host pushes
 * them on connect and whenever they change. They are *defaults*: once the user
 * has touched the matching control, their own choice is what persists.
 */
export interface DashboardSettings {
  /** `beadsDashboard.showClosed`: whether the board starts with closed issues in it. */
  showClosed: boolean;
}

/** Host-initiated messages the webview subscribes to. */
export type HostEvent =
  | { kind: 'event'; name: 'issuesChanged'; snapshot: DashboardSnapshot }
  | { kind: 'event'; name: 'focusBead'; id: string }
  | { kind: 'event'; name: 'setTab'; tab: DashboardTab }
  | { kind: 'event'; name: 'settings'; settings: DashboardSettings }
  | { kind: 'event'; name: 'error'; error: RpcError }
  | { kind: 'event'; name: 'fleetChanged'; fleet: FleetSnapshot }
  | { kind: 'event'; name: 'fleetError'; message: string | null }
  | {
      kind: 'event';
      name: 'transcriptAppend';
      targetId: string;
      events: TranscriptEvent[];
      totalBytes: number;
      /** See `TranscriptBackfill.degraded` — the same schema-drift signal, for a later batch. */
      degraded?: boolean;
    };

export type DashboardTab = 'overview' | 'roadmap' | 'board' | 'fleet' | 'molecules';

export const DASHBOARD_TABS: DashboardTab[] = ['overview', 'roadmap', 'board', 'fleet', 'molecules'];

/**
 * `beadsDashboard.defaultTab` is user-authored config that outlives the
 * extension version that wrote it. Graph was folded into Roadmap as a shape
 * rather than a tab, so a saved `'graph'` — or any other value this build no
 * longer recognises — must resolve to something renderable instead of
 * reaching the webview unchecked, where it would match no tab at all.
 */
export function resolveDashboardTab(value: string): DashboardTab {
  return (DASHBOARD_TABS as string[]).includes(value) ? (value as DashboardTab) : 'roadmap';
}

/** Anything the webview may post to the host. */
export type WebviewMessage = RpcRequest | { kind: 'ready' };

/** Anything the host may post to the webview. */
export type HostMessage = RpcResponse | HostEvent;

export function isRpcRequest(value: unknown): value is RpcRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as RpcRequest).kind === 'request' &&
    typeof (value as RpcRequest).id === 'number' &&
    typeof (value as RpcRequest).method === 'string'
  );
}
