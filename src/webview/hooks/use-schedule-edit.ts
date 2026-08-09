/**
 * Commits a bar drag to bd.
 *
 * Mutate, toast, and mark the bar busy until bd answers — the same contract the
 * detail pane uses. Nothing is written optimistically: if bd refuses, the bar
 * must snap back rather than keep showing a date that was never stored.
 */
import { useCallback, useRef, useState } from 'react';

import type { Span } from '../../shared/schedule';
import { asRpcError, call } from '../bridge/rpc';
import { useToast } from '../components/toast';
import type { BarEdit } from '../lib/bar-drag';
import { planScheduleRequest, type ScheduleWrite } from '../lib/schedule-request';

/** A write, and the write that takes it back — `null` when none can be expressed. */
type Send = (write: ScheduleWrite, undo: ScheduleWrite | null) => void;

export interface ScheduleEditApi {
  /** Ids with a write in flight. Cleared when bd answers, not when it refreshes. */
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
  // The tail of each bead's write queue. Two edits to one bead sent at once
  // race inside bd, and the answer that arrives last is not necessarily the
  // edit the user made last — the bead would settle on a date they had already
  // moved away from. Chaining per id keeps writes to one bead in the order they
  // were made while leaving different beads free to run together.
  const queues = useRef(new Map<string, Promise<void>>());

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

  // Annotated rather than inferred: the success toast's Undo button calls
  // `send` again, and TypeScript will not infer a type that refers to itself.
  const send: Send = useCallback<Send>(
    (write, undo) => {
      const id = write.params.id;
      acquire(id);

      // Every link already ends in `catch`, so a refusal settles the chain
      // rather than stranding the edits queued behind it.
      const queued: Promise<void> = (queues.current.get(id) ?? Promise.resolve())
        .then(() => call(write.method, write.params))
        .then(() =>
          // The undo write carries no undo of its own: a Redo button would put
          // the user in a loop with no record of which way round they are.
          notify(write.summary, 'info', undo ? { label: 'Undo', run: () => send(undo, null) } : undefined),
        )
        .catch((error: unknown) => notify(asRpcError(error).message, 'error'))
        .finally(() => {
          // Only the last edit clears the queue; an earlier one finishing must
          // not let a later one jump ahead of the edit behind it.
          if (queues.current.get(id) === queued) queues.current.delete(id);
          release(id);
        });

      queues.current.set(id, queued);
    },
    [acquire, notify, release],
  );

  const commit = useCallback(
    (span: Span, edit: BarEdit) => {
      const plan = planScheduleRequest(span, edit);
      if (!plan) return;
      send(plan, plan.undo);
    },
    [send],
  );

  return { pending, commit };
}
