/**
 * Translates RPC requests from the webview into `bd` calls.
 *
 * This is the only place that maps a method name onto queries/mutations; the
 * webview never sees an argv, and the host never trusts a method it does not
 * recognise.
 */
import * as vscode from 'vscode';

import {
  MUTATING_METHODS,
  type RpcMethodName,
  type RpcRequest,
  type RpcResponse,
} from '../../shared/protocol';
import { toPriority } from '../../shared/types';
import type { BeadsStore } from '../store';
import { toRpcError } from '../store';
import { requireDueDate } from './param-validation';

export interface RouterHost {
  /** Called after a mutation so every view can repaint. */
  revealBead(id: string): void;
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
