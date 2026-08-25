/**
 * The Molecules tab's data: one `getMolSnapshot` round trip, fetched while
 * this hook is mounted (i.e. while the Molecules tab is on screen — no other
 * caller ever mounts it, mirroring `useFleet`'s "charged to whoever is
 * looking" contract for `FleetService.observe`).
 *
 * Unlike `useFleet` there is no host push channel for molecules: the host
 * never learns a webview cares until the tab is selected. So this hook
 * fetches once on mount and again on every `issuesChanged` host event —
 * molecule steps are ordinary issues, so an agent claiming/closing one
 * already moves the watermark and fires that event without any new event
 * type. A fetch already in flight is never duplicated; a second trigger
 * while one is outstanding just waits for it, matching the "coalesced to one
 * in-flight call" contract from the design plan.
 */
import { useEffect, useState } from 'react';

import type { MolSnapshot } from '../../shared/mol';
import type { RpcError } from '../../shared/protocol';
import { asRpcError, call, onHostEvent } from '../bridge/rpc';

export interface MoleculesState {
  snapshot: MolSnapshot | undefined;
  /** True only until the *first* `getMolSnapshot` round trip settles. */
  loading: boolean;
  error: RpcError | undefined;
}

export function useMolecules(): MoleculesState {
  const [snapshot, setSnapshot] = useState<MolSnapshot>();
  const [error, setError] = useState<RpcError>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    // Coalescing flag, scoped to *this* effect instance only — never a ref.
    // A ref would survive React StrictMode's dev-mode double-invoke of this
    // effect (mount -> cleanup -> remount): the first (aborted) instance's
    // in-flight call would still hold a shared ref's flag `true` while its
    // own `live` closure goes `false` on cleanup, so the second (real, live)
    // instance's own `fetchSnapshot` would see "already in flight" and no-op
    // — stuck until some *unrelated* later `issuesChanged` event happens to
    // arrive after the abandoned call's `.finally` clears the ref (see
    // `useMolDetail`'s identical bug and full write-up, bead 9e9.5). Scoping
    // the flag per-instance means each effect run only ever coalesces
    // against its own in-flight call, never a different (possibly
    // abandoned) one.
    let inFlight = false;

    const fetchSnapshot = (): void => {
      // Coalesce: a refetch requested while one is already outstanding is a
      // no-op — the in-flight call will land with data at least as fresh.
      if (inFlight) return;
      inFlight = true;
      call('getMolSnapshot', undefined)
        .then((next) => {
          if (!live) return;
          setSnapshot(next);
          setError(undefined);
        })
        .catch((cause: unknown) => {
          if (!live) return;
          setError(asRpcError(cause));
        })
        .finally(() => {
          inFlight = false;
          if (live) setLoading(false);
        });
    };

    fetchSnapshot();
    const unsubscribe = onHostEvent((event) => {
      if (event.name === 'issuesChanged') fetchSnapshot();
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return { snapshot, loading, error };
}
