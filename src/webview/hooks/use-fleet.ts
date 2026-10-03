/**
 * The Fleet tab's data: one snapshot, pushed by the host while this hook is
 * mounted.
 *
 * Subscribing and unsubscribing are tied to the component's lifetime — mount
 * calls `subscribeFleet`, unmount calls `unsubscribeFleet` — so the extension
 * host's discovery loop (`FleetService`) runs only while the Fleet tab is
 * actually on screen; switching to another tab unmounts this hook and stops
 * it. Same shape as `use-beads.ts`, except the host is never asked to poll —
 * there is no `refresh()` here, only whatever `fleetChanged` last delivered.
 */
import { useEffect, useState } from 'react';

import type { FleetSnapshot } from '../../shared/fleet';
import type { RpcError } from '../../shared/protocol';
import { asRpcError, call, onHostEvent } from '../bridge/rpc';

export interface FleetState {
  snapshot: FleetSnapshot | undefined;
  /** True until the current `subscribeFleet` attempt settles. */
  loading: boolean;
  error: RpcError | undefined;
  retry: () => void;
}

export function useFleet(): FleetState {
  const [snapshot, setSnapshot] = useState<FleetSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RpcError>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const unsubscribeEvents = onHostEvent((event) => {
      if (event.name === 'fleetChanged') {
        setSnapshot(event.fleet);
        setError(undefined);
        setLoading(false);
      }
    });

    let live = true;
    void call('subscribeFleet', undefined)
      .catch((cause: unknown) => {
        if (live) setError(asRpcError(cause));
      })
      .finally(() => {
        // The first `fleetChanged` may already have landed by the time this
        // settles; either way there is nothing more to wait on.
        if (live) setLoading(false);
      });

    return () => {
      live = false;
      unsubscribeEvents();
      void call('unsubscribeFleet', undefined).catch(() => {
        // Nothing to recover: the panel is going away (or the tab changed)
        // regardless of whether the host heard the goodbye.
      });
    };
  }, [attempt]);

  const retry = (): void => {
    setError(undefined);
    setLoading(true);
    setAttempt((previous) => previous + 1);
  };

  return { snapshot, loading, error, retry };
}
