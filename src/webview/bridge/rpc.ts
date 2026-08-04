/**
 * The webview's only door to the extension host.
 *
 * `acquireVsCodeApi()` may be called exactly once per webview, and it is called
 * here. Nothing else in `src/webview/` may import it — components ask for data
 * through `call()` and never learn that `bd` exists.
 */
import type {
  HostEvent,
  HostMessage,
  RpcError,
  RpcMethodName,
  RpcParams,
  RpcResult,
} from '../../shared/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode: VsCodeApi = acquireVsCodeApi();

let nextId = 1;
const pending = new Map<number, { resolve: (value: never) => void; reject: (error: RpcError) => void }>();
const listeners = new Set<(event: HostEvent) => void>();

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.kind === 'event') {
    for (const listener of listeners) listener(message);
    return;
  }

  if (message.kind === 'response') {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.data as never);
    else entry.reject(message.error);
  }
});

/** Send a typed request and await the host's reply. Rejects with an RpcError. */
export function call<M extends RpcMethodName>(
  method: M,
  params: RpcParams<M>,
): Promise<RpcResult<M>> {
  const id = nextId++;
  return new Promise<RpcResult<M>>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: never) => void,
      reject,
    });
    vscode.postMessage({ kind: 'request', id, method, params });
  });
}

/** Subscribe to host-initiated events. Returns an unsubscribe function. */
export function onHostEvent(listener: (event: HostEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tell the host the React tree is mounted and wants its first snapshot. */
export function signalReady(): void {
  vscode.postMessage({ kind: 'ready' });
}

/**
 * Panel state survives the editor being closed and reopened, so the user comes
 * back to the tab and filters they left on.
 */
export function persist<T>(state: T): void {
  vscode.setState(state);
}

export function restore<T>(): T | undefined {
  return vscode.getState<T>();
}

/** Anything thrown across the bridge arrives as an RpcError; normalise the rest. */
export function asRpcError(error: unknown): RpcError {
  if (error && typeof error === 'object' && 'kind' in error && 'message' in error) {
    return error as RpcError;
  }
  return { kind: 'unknown', message: error instanceof Error ? error.message : String(error) };
}
