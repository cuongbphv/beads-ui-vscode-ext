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
import type { ComponentType, ReactNode } from 'react';

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

/** The sentence behind the chip: what happened, when, held by whom, where. */
function describeLease(info: LeaseInfo): string {
  const suffix =
    (info.holder ? ` · held by ${info.holder}` : '') + (info.node ? ` · node ${info.node}` : '');

  switch (info.state) {
    case 'expired':
      // `expired` only ever arises from a parsed expiry, so the ms are present.
      return `Lease expired ${formatDurationMs(info.expiresInMs ?? 0)} ago${suffix}`;
    case 'stale-heartbeat':
      return `No heartbeat for ${formatDurationMs(info.heartbeatAgeMs ?? 0)} — the worker may be gone${suffix}`;
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
  /** Injectable clock for tests; the live UI reads the wall clock per render. */
  nowMs?: number;
  className?: string;
}): ReactNode {
  const info = leaseState(bead, nowMs ?? Date.now());
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
