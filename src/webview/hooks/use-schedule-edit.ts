/**
 * Commits a bar drag to bd.
 *
 * Mutate, toast, and wait for the host's snapshot — the same contract the detail
 * pane uses. Nothing is written optimistically: if bd refuses, the bar must snap
 * back rather than keep showing a date that was never stored.
 */
import { useCallback, useRef, useState } from 'react';

import type { Span } from '../../shared/schedule';
import { asRpcError, call } from '../bridge/rpc';
import { useToast } from '../components/toast';
import type { BarEdit } from '../lib/bar-drag';
import { planScheduleRequest } from '../lib/schedule-request';

export interface ScheduleEditApi {
  /** Ids awaiting a fresh snapshot. */
  pending: ReadonlySet<string>;
  commit: (span: Span, edit: BarEdit) => void;
}

export function useScheduleEdit(): ScheduleEditApi {
  const { notify } = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // Ref-counted per id: two overlapping edits on the same bead must both
  // settle before the bar stops reading as pending, so the second request's
  // outcome — success or failure — always reaches the screen truthfully.
  const inFlight = useRef(new Map<string, number>());

  const acquire = useCallback((id: string) => {
    const count = (inFlight.current.get(id) ?? 0) + 1;
    inFlight.current.set(id, count);
    setPending((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);

  const release = useCallback((id: string) => {
    const count = (inFlight.current.get(id) ?? 1) - 1;
    if (count > 0) {
      inFlight.current.set(id, count);
      return;
    }
    inFlight.current.delete(id);
    setPending((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(
    (span: Span, edit: BarEdit) => {
      const plan = planScheduleRequest(span, edit);
      if (!plan) return;
      const id = span.bead.id;
      acquire(id);

      call(plan.method, plan.params)
        .then(() => notify(plan.summary))
        .catch((error: unknown) => notify(asRpcError(error).message, 'error'))
        .finally(() => release(id));
    },
    [acquire, notify, release],
  );

  return { pending, commit };
}
