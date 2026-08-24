/**
 * Change-history events for one issue.
 *
 * A `bd history` round trip is not something every detail-pane open should
 * pay for — the caller only enables this once the "History" section is
 * actually expanded (`open`), mirroring `useBeadDetail`'s stale-reply guard
 * so a late reply for a previously selected issue can never land in the
 * pane the user is looking at now.
 */
import { useEffect, useState } from 'react';

import type { HistoryEvent } from '../../shared/history-diff';
import type { RpcError } from '../../shared/protocol';
import { asRpcError, call } from '../bridge/rpc';

export interface UseHistoryState {
  events: HistoryEvent[];
  loading: boolean;
  error: RpcError | undefined;
}

export function useHistory(id: string, open: boolean, refreshKey: unknown): UseHistoryState {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RpcError>();

  useEffect(() => {
    // Collapsed: nothing to fetch, and any in-flight fetch from a previous
    // open no longer matters once this effect re-runs.
    if (!open) return;

    let current = true;
    setLoading(true);
    setError(undefined);
    call('getHistory', { id })
      .then((result) => {
        if (current) setEvents(result);
      })
      .catch((cause: unknown) => {
        if (current) setError(asRpcError(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [id, open, refreshKey]);

  return { events, loading, error };
}
