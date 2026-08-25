/**
 * One molecule's expanded detail: `showMolecule` fetched only while a
 * molecule id is passed in (i.e. while it is expanded in the Molecules tab)
 * — mirrors `useMolecules`'s "charged to whoever is looking" contract, one
 * level deeper. Refetches on every `issuesChanged` host event while mounted
 * with a non-undefined id, same as `useMolecules`: a step is an ordinary
 * issue, so an agent claiming/closing one already moves the watermark.
 */
import { useEffect, useState } from 'react';

import type { MolDetail } from '../../shared/mol';
import type { RpcError } from '../../shared/protocol';
import { asRpcError, call, onHostEvent } from '../bridge/rpc';

export interface MolDetailState {
  detail: MolDetail | undefined;
  /** True only until the *first* `showMolecule` round trip settles for the current id. */
  loading: boolean;
  error: RpcError | undefined;
}

/** `id` of `undefined` means no molecule is expanded: the hook holds no data and calls nothing. */
export function useMolDetail(id: string | undefined): MolDetailState {
  const [detail, setDetail] = useState<MolDetail>();
  const [error, setError] = useState<RpcError>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setDetail(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }

    let live = true;
    // Coalescing flag, scoped to *this* effect instance only — never a ref.
    // A ref would survive React StrictMode's dev-mode double-invoke of this
    // effect (mount -> cleanup -> remount): the first (aborted) instance's
    // in-flight call would still hold a shared ref's flag `true` while its
    // own `live` closure goes `false` on cleanup, so the second (real, live)
    // instance's own `fetchDetail` would see "already in flight" and no-op
    // forever — the first call's `.then`/`.finally` would then drop the
    // result (correctly, since its `live` is `false`) without anything left
    // to ever call `setLoading(false)` for the live instance. Scoping the
    // flag per-instance means each effect run only ever coalesces against
    // its own in-flight call, never a different (possibly abandoned) one.
    let inFlight = false;
    setDetail(undefined);
    setError(undefined);
    setLoading(true);

    const fetchDetail = (): void => {
      // Coalesce: a refetch requested while one is already outstanding is a
      // no-op — the in-flight call will land with data at least as fresh.
      if (inFlight) return;
      inFlight = true;
      call('showMolecule', { id })
        .then((next) => {
          if (!live) return;
          setDetail(next);
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

    fetchDetail();
    const unsubscribe = onHostEvent((event) => {
      if (event.name === 'issuesChanged') fetchDetail();
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [id]);

  return { detail, loading, error };
}
