/**
 * Turning a `BarEdit` into a bd write.
 *
 * Which RPC method a drag maps to, the params that method takes, the toast copy
 * that explains what changed, and the write that puts the bead back again are
 * all decided here, pure, so the hook that fires the request is left with
 * nothing to get wrong. Modeled on `planBarEdit` in `bar-drag.ts`, which keeps
 * the same kind of decision out of the component tree for the same reason.
 */
import type { RpcParams } from '../../shared/protocol';
import { formatDuration, type Span } from '../../shared/schedule';
import { currentDueAt, toDueDate, type BarEdit } from './bar-drag';
import { shortDate } from './utils';

/** One bd write: the method, its params, and the line that explains it. */
export type ScheduleWrite =
  | { method: 'setDue'; params: RpcParams<'setDue'>; summary: string }
  | { method: 'setEstimate'; params: RpcParams<'setEstimate'>; summary: string };

/**
 * A write, plus the write that puts the bead back where it was.
 *
 * `undo` is `null` when the previous state cannot be expressed as a bd call —
 * it is never a best-effort approximation, because an Undo that lands the issue
 * somewhere it has never been is worse than no Undo at all.
 */
export type ScheduleRequestPlan = ScheduleWrite & { undo: ScheduleWrite | null };

/** `est <before> → <after>`, with bd's absent estimate spelled out. */
function estimateSummary(id: string, before: number | undefined, after: number | undefined): string {
  return `${id} · est ${formatDuration(before) || 'none'} → ${formatDuration(after) || 'none'}`;
}

/**
 * Decide what to send bd for this edit, or `null` for `{ field: 'none' }`,
 * which must never spawn a request.
 */
export function planScheduleRequest(span: Span, edit: BarEdit): ScheduleRequestPlan | null {
  const id = span.bead.id;

  if (edit.field === 'due') {
    // What bd holds, not the drawn end: `spanOf` redraws a due date earlier
    // than the bar's start as a stub, and undoing to the stub would move the
    // issue to a date it never carried.
    const before = currentDueAt(span);
    return {
      method: 'setDue',
      params: { id, date: toDueDate(edit.at) },
      summary: `${id} · due ${shortDate(before)} → ${shortDate(edit.at)}`,
      undo: {
        method: 'setDue',
        params: { id, date: toDueDate(before) },
        summary: `${id} · due ${shortDate(edit.at)} → ${shortDate(before)}`,
      },
    };
  }

  if (edit.field === 'estimate') {
    const before = span.bead.estimated_minutes;
    return {
      method: 'setEstimate',
      params: { id, minutes: edit.minutes },
      summary: estimateSummary(id, before, edit.minutes),
      // `bd update --estimate` takes a non-negative int and stores it, so the
      // nearest undo for an issue that had no estimate is a stored zero — a
      // different state, not the one the user came from. Offer nothing instead.
      undo:
        typeof before === 'number'
          ? {
              method: 'setEstimate',
              params: { id, minutes: before },
              summary: estimateSummary(id, edit.minutes, before),
            }
          : null,
    };
  }

  return null;
}
