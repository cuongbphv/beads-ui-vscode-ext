/**
 * Claim-liveness classification (beads-ui-vscode-ext-ayq.1).
 *
 * bd hydrates three lease fields onto an issue from its ephemeral, node-local
 * leases table (`internal/types/types.go`, migrations 0054/0055):
 * `lease_expires_at`, `heartbeat_at`, `lease_granted_node`. All three are
 * `omitempty` — an issue with no active lease on this node simply lacks them,
 * which is what every sampled issue on this machine looked like. Absence is
 * therefore the *common* case and must classify as `none`, never as an
 * epoch-zero "expired ages ago" lease.
 *
 * Pure and framework-free (`shared/` rule): the clock is injected, nothing
 * here imports `vscode` or `react`, and both bundles can share the verdict.
 */
import type { Bead } from './types';

/**
 * The four liveness verdicts, exhaustively:
 *
 * - `none`            — no measurable lease: neither timestamp is present
 *                       (or parseable). "Not measured", never "expired".
 * - `expired`         — `lease_expires_at` is strictly in the past.
 * - `stale-heartbeat` — the lease has not expired, but `heartbeat_at` is
 *                       older than {@link HEARTBEAT_FRESH_MS}: the worker has
 *                       gone quiet for at least one full lease window.
 * - `live`            — lease fields are present and neither red flag holds.
 */
export type LeaseState = 'none' | 'live' | 'stale-heartbeat' | 'expired';

/** The classifier's verdict plus the raw measurements a badge can phrase. */
export interface LeaseInfo {
  state: LeaseState;
  /** Who holds the claim — the issue's assignee — when a lease is measurable. */
  holder?: string;
  /** The replica that granted the lease (`lease_granted_node`). */
  node?: string;
  /**
   * Signed ms until expiry: positive while live, negative once past. Present
   * only when `lease_expires_at` parsed — undefined is "not reported", not 0.
   */
  expiresInMs?: number;
  /** Signed ms since the last heartbeat. Present only when `heartbeat_at` parsed. */
  heartbeatAgeMs?: number;
}

/**
 * How old a heartbeat may be before the claim is flagged stale.
 *
 * Chosen to equal bd's `DefaultLeaseTTL` (5 minutes,
 * `internal/storage/issueops/lease.go`): bd expects a worker to heartbeat
 * "well within" that window, so a heartbeat older than one full default lease
 * window means the worker has missed every expected beat since — a defensible
 * "something is wrong" line that never fires on a healthy cadence.
 */
export const HEARTBEAT_FRESH_MS = 5 * 60_000;

/** RFC3339 → epoch ms; unparseable or absent input stays absent, never NaN. */
function parseTime(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The subset of `Bead` the classifier reads, so tests need no full issue. */
export type LeaseFields = Pick<
  Bead,
  'lease_expires_at' | 'heartbeat_at' | 'lease_granted_node' | 'assignee'
>;

/**
 * Classify an issue's claim liveness at the injected instant `nowMs`.
 *
 * A bare `lease_granted_node` with no timestamp is still `none`: provenance
 * without a timestamp gives nothing to measure liveness against.
 */
export function leaseState(bead: LeaseFields, nowMs: number): LeaseInfo {
  const expiresAt = parseTime(bead.lease_expires_at);
  const heartbeatAt = parseTime(bead.heartbeat_at);

  if (expiresAt === undefined && heartbeatAt === undefined) return { state: 'none' };

  const expiresInMs = expiresAt === undefined ? undefined : expiresAt - nowMs;
  const heartbeatAgeMs = heartbeatAt === undefined ? undefined : nowMs - heartbeatAt;

  // Order is severity: a dead lease beats a quiet worker beats "all is well".
  // `live` is not a silent fallback — it is the spec's own "otherwise, when
  // lease fields are present", and the none-case above already left.
  const state: Exclude<LeaseState, 'none'> =
    expiresInMs !== undefined && expiresInMs < 0
      ? 'expired'
      : heartbeatAgeMs !== undefined && heartbeatAgeMs > HEARTBEAT_FRESH_MS
        ? 'stale-heartbeat'
        : 'live';

  return {
    state,
    holder: bead.assignee,
    node: bead.lease_granted_node,
    expiresInMs,
    heartbeatAgeMs,
  };
}

/**
 * A duration's magnitude as the shortest honest unit: "45s", "4m", "2h 5m".
 * Sign is dropped on purpose — the caller phrases "in 4m" vs "4m ago".
 */
export function formatDurationMs(ms: number): string {
  const total = Math.abs(ms);
  const minutes = Math.floor(total / 60_000);
  if (minutes < 1) return `${Math.floor(total / 1_000)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m`;
  return `${hours}h ${minutes % 60}m`;
}
