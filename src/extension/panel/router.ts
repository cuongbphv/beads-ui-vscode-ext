/**
 * Translates RPC requests from the webview into `bd` calls.
 *
 * This is the only place that maps a method name onto queries/mutations; the
 * webview never sees an argv, and the host never trusts a method it does not
 * recognise.
 */
import * as vscode from 'vscode';

import type { TranscriptBackfill } from '../../shared/fleet';
import {
  MUTATING_METHODS,
  type RpcMethodName,
  type RpcRequest,
  type RpcResponse,
} from '../../shared/protocol';
import { toPriority } from '../../shared/types';
import type { BeadsStore } from '../store';
import { toRpcError } from '../store';
import {
  narrowAddDependencyParams,
  narrowCreateParams,
  narrowDependencyParams,
  narrowLabelParams,
  narrowUpdateTextParams,
  requireDueDate,
  requireTargetId,
} from './param-validation';

export interface RouterHost {
  /** Called after a mutation so every view can repaint. */
  revealBead(id: string): void;
  /** Start forwarding `fleetChanged` to this webview session (`subscribeFleet`). */
  fleetSubscribe(): void;
  /** Stop forwarding `fleetChanged` to this webview session (`unsubscribeFleet`). */
  fleetUnsubscribe(): void;
  /**
   * Start following one transcript target (`subscribeTranscript`). Resolves
   * with the initial backfill; rejects (e.g. an unknown target, or the
   * containment guard refusing a resolved path) surface as a normal
   * `RpcError` to the webview.
   */
  transcriptSubscribe(targetId: string): Promise<TranscriptBackfill>;
  /** Stop following a transcript target (`unsubscribeTranscript`). */
  transcriptUnsubscribe(targetId: string): void;
}

export async function handleRequest(
  store: BeadsStore,
  host: RouterHost,
  request: RpcRequest,
): Promise<RpcResponse> {
  try {
    const data = await dispatch(store, host, request);
    return { kind: 'response', id: request.id, ok: true, data } as RpcResponse;
  } catch (error) {
    return { kind: 'response', id: request.id, ok: false, error: toRpcError(error) };
  }
}

/** True when the method changed data and the store should refetch. */
export function isMutation(method: string): boolean {
  return MUTATING_METHODS.has(method as RpcMethodName);
}

async function dispatch(store: BeadsStore, host: RouterHost, request: RpcRequest): Promise<unknown> {
  const { queries, mutations } = store;
  // The webview is our own code, but it is still a separate trust boundary:
  // every param is narrowed before it reaches an argv.
  const params = (request.params ?? {}) as Record<string, unknown>;
  const id = () => requireString(params.id, 'id');

  switch (request.method) {
    case 'getSnapshot': {
      const state = await store.refresh();
      if (!state.snapshot) throw new Error(state.error?.message ?? 'No snapshot available.');
      return state.snapshot;
    }

    case 'listBeads':
      return queries.list(params);

    case 'showBead':
      return queries.show(id(), params.includeComments === true);

    case 'listChildren':
      return queries.children(requireString(params.parentId, 'parentId'));

    case 'getHistory': {
      const rawLimit = params.limit;
      const limit =
        typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.floor(rawLimit)
          : undefined;
      return limit === undefined ? queries.history(id()) : queries.history(id(), limit);
    }

    case 'setStatus':
      await mutations.setStatus(id(), requireString(params.status, 'status'));
      return { ok: true };

    case 'setPriority':
      await mutations.setPriority(id(), toPriority(Number(params.priority)));
      return { ok: true };

    case 'setAssignee':
      await mutations.setAssignee(id(), String(params.assignee ?? ''));
      return { ok: true };

    case 'closeBead':
      await mutations.close(id(), typeof params.reason === 'string' ? params.reason : undefined);
      return { ok: true };

    case 'setDue':
      // An empty string is meaningful here — it clears the due date — so this
      // deliberately does not go through requireString. requireDueDate still
      // narrows the value: only YYYY-MM-DD or '' reaches the bd argv.
      await mutations.setDue(id(), requireDueDate(params.date, 'date'));
      return { ok: true };

    case 'setEstimate': {
      const minutes = Number(params.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error('Missing required parameter "minutes".');
      }
      await mutations.setEstimate(id(), minutes);
      return { ok: true };
    }

    case 'revealBead':
      host.revealBead(id());
      return { ok: true };

    case 'copyText':
      await vscode.env.clipboard.writeText(String(params.text ?? ''));
      return { ok: true };

    case 'addComment':
      await mutations.comment(id(), requireString(params.text, 'text'));
      return { ok: true };

    case 'appendNotes':
      await mutations.appendNotes(id(), requireString(params.text, 'text'));
      return { ok: true };

    case 'updateText': {
      // narrowUpdateTextParams throws before any argv is built when the
      // field is outside the allowlist, the id is blank, or an empty text
      // reaches the one field (title) that must not accept one.
      const narrowed = narrowUpdateTextParams(params);
      await mutations.updateText(narrowed.id, narrowed.field, narrowed.text);
      return { ok: true };
    }

    case 'createBead':
      // narrowCreateParams throws before any argv is built when the shape is
      // wrong; vocabulary values (type/priority/status) pass through and the
      // bd CLI stays the authority on whether they exist.
      return mutations.create(narrowCreateParams(params));

    case 'addDependency': {
      // narrowAddDependencyParams throws before any argv is built when id or
      // dependsOn is blank, they are equal (a self-edge), or type is outside
      // DEP_TYPES. A cycle bd itself refuses to create is not special-cased
      // here — it surfaces as a normal RpcError toast.
      const narrowed = narrowAddDependencyParams(params);
      await mutations.addDependency(narrowed.id, narrowed.dependsOn, narrowed.type);
      return { ok: true };
    }

    case 'removeDependency': {
      // Same self-edge guard as addDependency; bd dep remove takes no --type
      // flag, so there is nothing else to narrow here.
      const narrowed = narrowDependencyParams(params);
      await mutations.removeDependency(narrowed.id, narrowed.dependsOn);
      return { ok: true };
    }

    case 'addLabel': {
      // narrowLabelParams throws before any argv is built when id or label
      // is blank. Labels are user-defined, so there is no allowlist to check
      // label against.
      const narrowed = narrowLabelParams(params);
      await mutations.addLabel(narrowed.id, narrowed.label);
      return { ok: true };
    }

    case 'removeLabel': {
      // Same narrowing as addLabel.
      const narrowed = narrowLabelParams(params);
      await mutations.removeLabel(narrowed.id, narrowed.label);
      return { ok: true };
    }

    case 'subscribeFleet':
      host.fleetSubscribe();
      return { ok: true };

    case 'unsubscribeFleet':
      host.fleetUnsubscribe();
      return { ok: true };

    case 'subscribeTranscript':
      return host.transcriptSubscribe(requireTargetId(params.targetId, 'targetId'));

    case 'unsubscribeTranscript':
      host.transcriptUnsubscribe(requireTargetId(params.targetId, 'targetId'));
      return { ok: true };

    case 'getMolSnapshot':
      return queries.molSnapshot();

    case 'getSyncStatus':
      // Read-only: reports what `bd dolt status` says and nothing more. Never
      // runs `bd dolt push`/`bd dolt pull` — see queries.doltStatus.
      return queries.doltStatus();

    case 'getHealthReport': {
      // Read-only fan-out (stale/orphans/lint/dep cycles) — see
      // queries.healthReport for why `bd preflight`/`bd doctor` are excluded.
      // Only a positive finite staleDays reaches the argv; anything else
      // falls back to BdQueries' own default.
      const rawStaleDays = params.staleDays;
      const staleDays =
        typeof rawStaleDays === 'number' && Number.isFinite(rawStaleDays) && rawStaleDays > 0
          ? Math.floor(rawStaleDays)
          : undefined;
      return staleDays === undefined ? queries.healthReport() : queries.healthReport(staleDays);
    }

    case 'searchBeads': {
      // Read-only fallback for a truncated workspace — see queries.search.
      // Only a positive finite limit reaches the argv; anything else falls
      // back to BdQueries' own default (50, matching bd's own default).
      const rawLimit = params.limit;
      const limit =
        typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.floor(rawLimit)
          : undefined;
      const text = requireString(params.text, 'text');
      return limit === undefined ? queries.search(text) : queries.search(text, limit);
    }

    default:
      throw new Error(`Unknown RPC method: ${String(request.method)}`);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required parameter "${field}".`);
  }
  return value;
}
