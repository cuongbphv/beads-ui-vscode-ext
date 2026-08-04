/**
 * Full detail for one issue.
 *
 * The snapshot's list rows carry only what `bd list` returns, so design notes,
 * acceptance criteria, due date, estimate, owner and comments are all missing
 * until `bd show --long` is asked for them. This hook does that fetch, keeping
 * the list row on screen in the meantime so the pane never flashes empty.
 */
import { useEffect, useState } from 'react';

import type { Bead, BeadComment } from '../../shared/types';
import type { RpcError } from '../../shared/protocol';
import { asRpcError, call } from '../bridge/rpc';

export interface BeadDetailState {
  /** The list row, replaced by the full record once it arrives. */
  bead: Bead;
  comments: BeadComment[];
  loading: boolean;
  error: RpcError | undefined;
}

export function useBeadDetail(summary: Bead, refreshKey: unknown): BeadDetailState {
  const [full, setFull] = useState<Bead>();
  const [comments, setComments] = useState<BeadComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RpcError>();

  useEffect(() => {
    // A late reply for a previously selected issue must not overwrite the
    // pane the user is looking at now.
    let current = true;

    setLoading(true);
    setError(undefined);
    call('showBead', { id: summary.id, includeComments: true })
      .then((result) => {
        if (!current) return;
        if (result.bead) setFull(result.bead);
        setComments(result.comments);
      })
      .catch((cause: unknown) => current && setError(asRpcError(cause)))
      .finally(() => current && setLoading(false));

    return () => {
      current = false;
    };
  }, [summary.id, refreshKey]);

  // Merge rather than replace: `bd show` omits the list-only rollups
  // (blocked_by, dependent_count) that the summary already has.
  const bead = full && full.id === summary.id ? { ...summary, ...full } : summary;

  return { bead, comments, loading, error };
}
