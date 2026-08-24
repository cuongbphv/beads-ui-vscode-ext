/**
 * One molecule's expanded detail: `showMolecule` fetched only while a
 * molecule id is passed in (i.e. while it is expanded in the Molecules tab)
 * — mirrors `useMolecules`'s "charged to whoever is looking" contract, one
 * level deeper. Refetches on every `issuesChanged` host event while mounted
 * with a non-undefined id, same as `useMolecules`: a step is an ordinary
 * issue, so an agent claiming/closing one already moves the watermark.
 */
import { useEffect, useRef, useState } from 'react';

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
  const inFlight = useRef(false);

  useEffect(() => {
    if (!id) {
      setDetail(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }

    let live = true;
    setDetail(undefined);
    setError(undefined);
    setLoading(true);

    const fetchDetail = (): void => {
      // Coalesce: a refetch requested while one is already outstanding is a
      // no-op — the in-flight call will land with data at least as fresh.
      if (inFlight.current) return;
      inFlight.current = true;
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
          inFlight.current = false;
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
