/**
 * On-demand project-health scorecard (bead beads-ui-vscode-ext-72m.2).
 *
 * Mirrors `useSyncStatus`: this hook fetches nothing on its own — no mount
 * effect, no subscription to `issuesChanged` (which also fires on the
 * host's poll tick). The only way to populate `report` is to call the
 * returned `run()`, which `HealthScorecard` wires to its "Run checks"
 * button so a poll tick can never trigger `bd stale`/`bd orphans`/`bd
 * lint`/`bd dep cycles`.
 */
import { useCallback, useState } from 'react';

import type { RpcError } from '../../shared/protocol';
import type { HealthReport } from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';

export interface UseHealthState {
  report: HealthReport | undefined;
  loading: boolean;
  error: RpcError | undefined;
  /** Fetch `getHealthReport` once. Call this from the "Run checks" button only. */
  run: (staleDays?: number) => void;
}

export function useHealth(): UseHealthState {
  const [report, setReport] = useState<HealthReport>();
  const [error, setError] = useState<RpcError>();
  const [loading, setLoading] = useState(false);

  const run = useCallback((staleDays?: number) => {
    setLoading(true);
    call('getHealthReport', staleDays === undefined ? undefined : { staleDays })
      .then((next) => {
        setReport(next);
        setError(undefined);
      })
      .catch((cause: unknown) => setError(asRpcError(cause)))
      .finally(() => setLoading(false));
  }, []);

  return { report, loading, error, run };
}
