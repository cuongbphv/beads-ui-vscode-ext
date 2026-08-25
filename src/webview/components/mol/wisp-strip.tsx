/**
 * A compact horizontal strip of live wisps on the Molecules tab, sourced from
 * `snapshot.wisps` — `MolSnapshot.wisps` is already fetched by the single
 * `getMolSnapshot` round trip `useMolecules` makes (see `shared/mol.ts`'s
 * `MolSnapshot`), so this component costs zero new reads, exactly like
 * `GatesSection` costs zero new reads from `snapshot.gates`.
 *
 * The TTL countdown shown here is a client-side HEURISTIC, not bd-reported
 * data — see `WISP_TTL_MS`'s doc comment in `shared/mol.ts` for exactly why
 * (bd 1.2.2 emits no `wisp_type`/TTL field of any kind) and where the numbers
 * come from. A wisp whose type has no entry in that map, or whose heuristic
 * TTL has already elapsed, degrades to a plain badge — never a crash, never
 * a negative or garbage duration.
 */
import { Clock, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatDurationMs } from '../../../shared/lease';
import { wispTtlState, type MolWisp } from '../../../shared/mol';

export function WispChip({ wisp, now = Date.now() }: { wisp: MolWisp; now?: number }): ReactNode {
  const ttl = wispTtlState(wisp, now);

  return (
    <article
      aria-label={`${wisp.id}: ${wisp.title}`}
      className="border-border bg-surface flex min-w-0 shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5"
    >
      <Sparkles aria-hidden="true" className="text-fg-muted size-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-fg-strong max-w-40 truncate text-xs leading-snug">{wisp.title}</p>
        <p className="text-fg-muted flex items-center gap-1 text-[11px]">
          <span className="truncate font-mono opacity-70">{wisp.type}</span>
          {ttl.kind === 'active' ? (
            <span className="inline-flex items-center gap-0.5" title="Heuristic countdown — bd reports no wisp TTL">
              <Clock aria-hidden="true" className="size-3" />
              {formatDurationMs(ttl.remainingMs)} left
            </span>
          ) : null}
          {ttl.kind === 'expired' ? (
            <span className="text-warning inline-flex items-center gap-0.5" title="Past its heuristic TTL — not a bd status">
              <Clock aria-hidden="true" className="size-3" />
              stale
            </span>
          ) : null}
          {ttl.kind === 'unknown' ? <span title="No heuristic TTL for this wisp's type">TTL unknown</span> : null}
        </p>
      </div>
    </article>
  );
}

export function WispStrip({ wisps, now = Date.now() }: { wisps: MolWisp[]; now?: number }): ReactNode {
  if (wisps.length === 0) return null;

  return (
    <section aria-label={`Wisps (${wisps.length})`} className="mb-3">
      <p className="text-fg-muted mb-1.5 text-[11px] font-medium uppercase tracking-wide">Wisps ({wisps.length})</p>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {wisps.map((wisp) => (
          <li key={wisp.id} className="shrink-0">
            <WispChip wisp={wisp} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
