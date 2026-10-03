/**
 * The claim-liveness chip (beads-ui-vscode-ext-ayq.1), shared by `BeadCard`
 * and the Fleet worker list.
 *
 * All judgement lives in `shared/lease.ts`; this component only phrases the
 * verdict. Two rules it exists to uphold:
 *
 * - Colour is never the only signal (MASTER.md): every state pairs a
 *   `--vscode-*`-backed hue with visible text AND an icon, and the tooltip
 *   carries the numbers behind the verdict.
 * - `none` renders nothing. The common issue has no lease, and a card must
 *   not grow a chip that says so.
 */
import { HeartOff, HeartPulse, TimerOff } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

import {
  formatDurationMs,
  leaseState,
  type LeaseFields,
  type LeaseInfo,
  type LeaseState,
} from '../../shared/lease';
import { cn } from '../lib/utils';

/**
 * One presentation per non-none state — `Record` over the exact union, so a
 * new `LeaseState` refuses to compile until it gets a face here.
 */
const BADGE: Record<
  Exclude<LeaseState, 'none'>,
  { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>; className: string; label: string }
> = {
  live: { icon: HeartPulse, className: 'text-success', label: 'leased' },
  'stale-heartbeat': { icon: HeartOff, className: 'text-warning', label: 'stale heartbeat' },
  expired: { icon: TimerOff, className: 'text-danger', label: 'lease expired' },
};

// Cards and Fleet rows share one clock. Pausing while the webview is hidden
// avoids timers for tabs the user cannot see; visibility restores a fresh tick.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  for (const listener of listeners) listener();
}

function stopClock(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

function syncClock(): void {
  if (document.hidden || listeners.size === 0) {
    stopClock();
    return;
  }
  tick();
  if (timer === undefined) timer = setInterval(tick, 1_000);
}

function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', syncClock);
    if (!document.hidden) timer = setInterval(tick, 1_000);
  }
  // Catch the subscriber up without re-rendering every mounted card.
  if (!document.hidden) listener();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', syncClock);
      stopClock();
    }
  };
}

function useVisibleClock(enabled: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    return subscribeClock(() => setNow(Date.now()));
  }, [enabled]);
  return now;
}

/** The sentence behind the chip: what happened, when, held by whom, where. */
function describeLease(info: LeaseInfo): string {
  const suffix =
    (info.holder ? ` · held by ${info.holder}` : '') + (info.node ? ` · node ${info.node}` : '');

  switch (info.state) {
    case 'expired':
      // `expired` only ever arises from a parsed expiry, so the ms are present.
      return `Lease expired ${formatDurationMs(info.expiresInMs ?? 0)} ago${suffix}`;
    case 'stale-heartbeat':
      return `No heartbeat for ${formatDurationMs(info.heartbeatAgeMs ?? 0)} — check worker status${suffix}`;
    case 'live':
      return info.expiresInMs !== undefined
        ? `Lease live — expires in ${formatDurationMs(info.expiresInMs)}${suffix}`
        : `Lease live — heartbeat ${formatDurationMs(info.heartbeatAgeMs ?? 0)} ago${suffix}`;
    case 'none':
      return '';
  }
}

export function LeaseBadge({
  bead,
  nowMs,
  className,
}: {
  /** Anything carrying the lease fields — a full `Bead` qualifies. */
  bead: LeaseFields;
  /** Fixed clock for static renders and tests; otherwise use the shared visible clock. */
  nowMs?: number;
  className?: string;
}): ReactNode {
  const hasTimestamp = [bead.lease_expires_at, bead.heartbeat_at]
    .some((value) => value !== undefined && Number.isFinite(Date.parse(value)));
  const liveNow = useVisibleClock(nowMs === undefined && hasTimestamp);
  const info = leaseState(bead, nowMs ?? liveNow);
  if (info.state === 'none') return null;

  const meta = BADGE[info.state];
  const Icon = meta.icon;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-0.5 text-[11px]', meta.className, className)}
      title={describeLease(info)}
    >
      <Icon aria-hidden="true" className="size-3" />
      {meta.label}
    </span>
  );
}
