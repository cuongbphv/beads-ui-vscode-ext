/**
 * Server-side search fallback for a truncated workspace
 * (beads-ui-vscode-ext-72m.4).
 *
 * `bd list` caps out at `beadsDashboard.issueLimit`, so once a project is
 * truncated the client-side filter in `shared/model.ts` (`filterBeads`) can
 * only ever see the rows already loaded — a match that lives past the cap
 * is invisible no matter what the user types. This hook is the one
 * deliberate exception to "no re-query per keystroke": it fires
 * `searchBeads` against the *whole* project, but only once the query is
 * long enough to be worth a round trip and only after it has stopped
 * changing for 300ms.
 *
 * Inactive (not truncated, or the query is under the minimum length), it
 * fetches nothing and reports an empty result — the common case for most
 * projects and most keystrokes within a search.
 */
import { useEffect, useState } from 'react';

import type { RpcError } from '../../shared/protocol';
import type { Bead } from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';

/** Below this, a query is not worth a round trip to bd. */
const MIN_QUERY_LENGTH = 2;

/** How long the query has to sit still before it is actually sent. */
const DEBOUNCE_MS = 300;

export interface UseServerSearchState {
  /** Search hits, empty unless the search is active and has an answer. */
  extraBeads: Bead[];
  /** True while a debounced call is pending or in flight. */
  loading: boolean;
  error: RpcError | undefined;
}

/**
 * @param text The filter bar's current search text (untrimmed).
 * @param truncated `snapshot.truncated` — the whole reason this hook exists.
 */
export function useServerSearch(text: string, truncated: boolean): UseServerSearchState {
  const [extraBeads, setExtraBeads] = useState<Bead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RpcError>();

  const trimmed = text.trim();
  const active = truncated && trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!active) {
      // Covers both "not truncated" and "too short to search" — neither is
      // an error, so any previous answer (for a longer query the user has
      // since deleted back down) is cleared rather than left stale on screen.
      setExtraBeads([]);
      setLoading(false);
      setError(undefined);
      return;
    }

    // Guards against a reply for a query the user has since changed: the
    // debounce timer below is cancelled by the cleanup on every keystroke,
    // but a call already in flight when the next keystroke lands is not —
    // this flag is what keeps that stale reply from ever reaching state.
    let current = true;
    setLoading(true);

    const timer = setTimeout(() => {
      call('searchBeads', { text: trimmed })
        .then((results) => {
          if (!current) return;
          setExtraBeads(results);
          setError(undefined);
        })
        .catch((cause: unknown) => {
          if (!current) return;
          setError(asRpcError(cause));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, trimmed]);

  return { extraBeads, loading, error };
}
