/**
 * The postMessage contract between the webview and the extension host.
 *
 * The webview never builds a `bd` argv; it calls one of the typed methods
 * below and the host translates. Framework-free: no `vscode`, no `react`.
 */
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
}

export type RpcMethodName = keyof RpcMethods;
export type RpcParams<M extends RpcMethodName> = RpcMethods[M]['params'];
export type RpcResult<M extends RpcMethodName> = RpcMethods[M]['result'];

/** Which methods mutate state. The host refetches and broadcasts after these. */
export const MUTATING_METHODS: ReadonlySet<RpcMethodName> = new Set<RpcMethodName>([
  'setStatus',
  'setPriority',
  'setAssignee',
  'closeBead',
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
  | { kind: 'event'; name: 'error'; error: RpcError };

export type DashboardTab = 'overview' | 'roadmap' | 'board';

export const DASHBOARD_TABS: DashboardTab[] = ['overview', 'roadmap', 'board'];

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
