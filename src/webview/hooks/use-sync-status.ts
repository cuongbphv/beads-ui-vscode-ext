/**
 * Read-only Dolt sync/engine status for the header's sync chip.
 *
 * Unlike `useBeads`, this hook fetches nothing on its own — no mount effect,
 * no subscription to `issuesChanged` (which also fires on the host's poll
 * tick). The only way to populate `status` is to call the returned
 * `refresh()`, which `App.tsx` piggybacks on the existing manual Refresh
 * button so a poll tick can never trigger a `bd dolt status` call.
 */
import { useCallback, useState } from 'react';

import type { SyncStatus } from '../../shared/types';
import type { RpcError } from '../../shared/protocol';
import { asRpcError, call } from '../bridge/rpc';

export interface UseSyncStatusState {
  status: SyncStatus | undefined;
  loading: boolean;
  error: RpcError | undefined;
  /** Fetch `getSyncStatus` once. Call this from the manual Refresh action only. */
  refresh: () => void;
}

export function useSyncStatus(): UseSyncStatusState {
  const [status, setStatus] = useState<SyncStatus>();
  const [error, setError] = useState<RpcError>();
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    call('getSyncStatus', {})
      .then((next) => {
        setStatus(next);
        setError(undefined);
      })
      .catch((cause: unknown) => setError(asRpcError(cause)))
      .finally(() => setLoading(false));
  }, []);

  return { status, loading, error, refresh };
}
