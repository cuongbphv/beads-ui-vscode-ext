/**
 * Turning a `BarEdit` into a bd write.
 *
 * Which RPC method a drag maps to, the params that method takes, and the
 * toast copy that explains what changed are all decided here, pure, so the
 * hook that fires the request is left with nothing to get wrong. Modeled on
 * `planBarEdit` in `bar-drag.ts`, which keeps the same kind of decision out
 * of the component tree for the same reason.
 */
import type { RpcParams } from '../../shared/protocol';
import { formatDuration, type Span } from '../../shared/schedule';
import { toDueDate, type BarEdit } from './bar-drag';
import { shortDate } from './utils';

export type ScheduleRequestPlan =
  | { method: 'setDue'; params: RpcParams<'setDue'>; summary: string }
  | { method: 'setEstimate'; params: RpcParams<'setEstimate'>; summary: string };

/**
 * Decide what to send bd for this edit, or `null` for `{ field: 'none' }`,
 * which must never spawn a request.
 */
export function planScheduleRequest(span: Span, edit: BarEdit): ScheduleRequestPlan | null {
  const id = span.bead.id;

  if (edit.field === 'due') {
    return {
      method: 'setDue',
      params: { id, date: toDueDate(edit.at) },
      summary: `${id} · due ${shortDate(span.end)} → ${shortDate(edit.at)}`,
    };
  }

  if (edit.field === 'estimate') {
    return {
      method: 'setEstimate',
      params: { id, minutes: edit.minutes },
      summary: `${id} · est ${formatDuration(span.bead.estimated_minutes) || 'none'} → ${formatDuration(edit.minutes)}`,
    };
  }

  return null;
}
