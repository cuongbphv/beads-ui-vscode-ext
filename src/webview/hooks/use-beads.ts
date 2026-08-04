/**
 * The webview's single source of truth: one snapshot, pushed by the host.
 *
 * The webview never polls. It renders whatever the host last sent, and asks for
 * a refresh only when the user presses refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { StatusIndex } from '../../shared/model';
import type { DashboardSnapshot } from '../../shared/types';
import type { RpcError } from '../../shared/protocol';
import { asRpcError, call, onHostEvent, signalReady } from '../bridge/rpc';

export interface BeadsState {
  snapshot: DashboardSnapshot | undefined;
  index: StatusIndex;
  error: RpcError | undefined;
  loading: boolean;
  focusedId: string | undefined;
  setFocusedId: (id: string | undefined) => void;
  refresh: () => void;
}

const EMPTY_INDEX = new StatusIndex([]);

export function useBeads(): BeadsState {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>();
  const [error, setError] = useState<RpcError>();
  const [loading, setLoading] = useState(true);
  const [focusedId, setFocusedId] = useState<string>();

  useEffect(() => {
    const unsubscribe = onHostEvent((event) => {
      switch (event.name) {
        case 'issuesChanged':
          setSnapshot(event.snapshot);
          setError(undefined);
          setLoading(false);
          break;
        case 'error':
          setError(event.error);
          setLoading(false);
          break;
        case 'focusBead':
          setFocusedId(event.id);
          break;
      }
    });

    signalReady();
    return unsubscribe;
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    call('getSnapshot', undefined)
      .then((next) => {
        setSnapshot(next);
        setError(undefined);
      })
      .catch((cause: unknown) => setError(asRpcError(cause)))
      .finally(() => setLoading(false));
  }, []);

  // Rebuilding the index on every render would invalidate every memo below it.
  const index = useMemo(
    () => (snapshot ? new StatusIndex(snapshot.vocabulary.statuses) : EMPTY_INDEX),
    [snapshot],
  );

  return { snapshot, index, error, loading, focusedId, setFocusedId, refresh };
}
