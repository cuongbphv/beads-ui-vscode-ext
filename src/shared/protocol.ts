/**
 * The postMessage contract between the webview and the extension host.
 *
 * The webview never builds a `bd` argv; it calls one of the typed methods
 * below and the host translates. Framework-free: no `vscode`, no `react`.
 */
import type { FleetSnapshot, TranscriptBackfill, TranscriptEvent } from './fleet';
import type {
  Bead,
  BeadComment,
  BeadFilters,
  DashboardSnapshot,
  Priority,
} from './types';

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
  setStatus: {
    params: { id: string; status: string };
    result: { ok: true };
  };
  setPriority: {
    params: { id: string; priority: Priority };
    result: { ok: true };
  };
  setAssignee: {
    params: { id: string; assignee: string };
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
  /** Stop receiving `transcriptAppend` events for this target. */
  unsubscribeTranscript: {
    params: { targetId: string };
    result: { ok: true };
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
  'setDue',
  'setEstimate',
  'closeBead',
  'addComment',
  'appendNotes',
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
  | {
      kind: 'event';
      name: 'transcriptAppend';
      targetId: string;
      events: TranscriptEvent[];
      totalBytes: number;
      /** See `TranscriptBackfill.degraded` — the same schema-drift signal, for a later batch. */
      degraded?: boolean;
    };

export type DashboardTab = 'overview' | 'roadmap' | 'board' | 'fleet';

export const DASHBOARD_TABS: DashboardTab[] = ['overview', 'roadmap', 'board', 'fleet'];

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
