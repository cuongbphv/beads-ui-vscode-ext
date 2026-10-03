/**
 * One open gate on the Molecules tab, sourced from `snapshot.gates` —
 * `MolSnapshot.gates` mirrors `DashboardSnapshot.gates` (all open gates,
 * project-wide; bd has no "gates blocking a molecule" filter), so this
 * component costs zero new reads beyond the `getMolSnapshot` round trip
 * `useMolecules` already made.
 *
 * Resolve is offered only for `await_type === 'human'`. `bd gate create
 * --help` documents `human` as the one type that "requires manual bd gate
 * resolve" — timer/gh:run/gh:pr/bead gates clear themselves (a timeout
 * elapses, a workflow finishes, a PR merges, a bead closes). `bd gate
 * resolve --help` itself does not refuse a non-human gate id (it says it is
 * "equivalent to bd close"), so hiding the button for the other four types
 * is a UI-level policy choice mirroring bd's own documented intent, not a
 * CLI-enforced restriction — do not add the button for other types without
 * re-reading `RpcMethods.resolveGate`'s doc comment in `shared/protocol.ts`.
 */
import { CheckCircle2, Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { formatGateAwait } from '../../../shared/mol';
import type { BdGate } from '../../../shared/types';
import { asRpcError, call } from '../../bridge/rpc';
import { Button } from '../primitives';
import { useToast } from '../toast';

export function GateCard({ gate }: { gate: BdGate }): ReactNode {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  async function resolve(): Promise<void> {
    setBusy(true);
    try {
      // `resolveGate` is in MUTATING_METHODS, so the host refetches and
      // broadcasts `issuesChanged` on success — `useMolecules` picks that up
      // and this card simply disappears from the next snapshot; no local
      // optimistic removal is needed here.
      await call('resolveGate', { id: gate.id });
      notify(`${gate.id} resolved`);
    } catch (error) {
      notify(asRpcError(error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      aria-label={`${gate.id}: ${gate.title}`}
      className="border-warning/40 bg-surface rounded-md border p-3"
    >
      <div className="text-fg-muted flex items-center gap-1.5 text-xs">
        <Lock aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate font-mono opacity-70">{gate.id}</span>
      </div>
      <p className="text-fg-strong mt-1 line-clamp-2 text-sm leading-snug">{gate.title}</p>
      <p className="text-warning mt-1.5 text-xs">{formatGateAwait(gate)}</p>
      <p className="text-fg-muted mt-1 text-xs">
        {gate.status}{gate.owner ? ` · Owner: ${gate.owner}` : ' · Unassigned'}
      </p>
      {gate.await_type === 'human' ? (
        <Button variant="secondary" disabled={busy} className="mt-2" onClick={() => void resolve()}>
          <CheckCircle2 aria-hidden="true" className="size-3.5" />
          Resolve
        </Button>
      ) : null}
    </article>
  );
}

export function GatesSection({ gates }: { gates: BdGate[] }): ReactNode {
  if (gates.length === 0) return null;

  return (
    <section aria-label={`Gates (${gates.length})`} className="mb-3">
      <p className="text-fg-muted mb-1.5 text-[11px] font-medium uppercase tracking-wide">Gates ({gates.length})</p>
      <ul className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {gates.map((gate) => (
          <li key={gate.id}>
            <GateCard gate={gate} />
          </li>
        ))}
      </ul>
    </section>
  );
}
