/**
 * One cached snapshot, shared by every view.
 *
 * The tree and the dashboard both want the same data at the same moment; going
 * through the store means one `bd` fan-out per refresh instead of two, and one
 * place that decides when a refresh is due.
 */
import * as vscode from 'vscode';

import type { DashboardSnapshot } from '../shared/types';
import type { RpcError } from '../shared/protocol';
import { BdService, BdError } from './bd/BdService';
import { BdQueries } from './bd/queries';
import { BdMutations } from './bd/mutations';

export interface StoreState {
  snapshot?: DashboardSnapshot;
  error?: RpcError;
  loading: boolean;
}

/** Normalise anything thrown below us into the shape the webview renders. */
export function toRpcError(error: unknown): RpcError {
  if (error instanceof BdError) return error.rpcError;
  return {
    kind: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  };
}

export class BeadsStore implements vscode.Disposable {
  readonly bd: BdService;
  readonly queries: BdQueries;
  readonly mutations: BdMutations;

  private state: StoreState = { loading: false };
  private pollTimer: NodeJS.Timeout | undefined;
  private pending: Promise<StoreState> | undefined;

  private readonly emitter = new vscode.EventEmitter<StoreState>();
  /** Fires on every state transition: loading, loaded, failed. */
  readonly onDidChange = this.emitter.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly output: vscode.OutputChannel,
  ) {
    this.bd = new BdService({
      cwd: workspaceFolder.uri.fsPath,
      bdPath: config().get<string>('bdPath'),
      log: (message) => this.output.appendLine(message),
    });
    this.queries = new BdQueries(this.bd);
    this.mutations = new BdMutations(this.bd);

    // Any write we make invalidates the cache immediately — this is the
    // "refresh after mutation" half of DEC-004 (there is no file watcher,
    // because the JSONL export does not reflect Dolt writes).
    this.disposables.push({ dispose: this.mutations.onChanged(() => void this.refresh()) });

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('beadsUi.pollIntervalSeconds')) this.restartPolling();
        if (event.affectsConfiguration('beadsUi.issueLimit')) void this.refresh();
      }),
    );

    this.restartPolling();
  }

  get current(): StoreState {
    return this.state;
  }

  /** Refresh, coalescing concurrent callers onto one in-flight fetch. */
  async refresh(): Promise<StoreState> {
    if (this.pending) return this.pending;

    this.setState({ ...this.state, loading: true, error: undefined });

    this.pending = (async () => {
      try {
        const limit = config().get<number>('issueLimit') ?? 2000;
        const snapshot = await this.queries.snapshot(limit);
        return this.setState({ snapshot, loading: false, error: undefined });
      } catch (error) {
        const rpcError = toRpcError(error);
        this.output.appendLine(`refresh failed: ${rpcError.kind}: ${rpcError.message}`);
        if (rpcError.detail) this.output.appendLine(rpcError.detail);
        // Keep the last good snapshot on screen; a transient bd failure should
        // not blank the board.
        return this.setState({ ...this.state, loading: false, error: rpcError });
      } finally {
        this.pending = undefined;
      }
    })();

    return this.pending;
  }

  private setState(next: StoreState): StoreState {
    this.state = next;
    this.emitter.fire(next);
    return next;
  }

  private restartPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;

    const seconds = config().get<number>('pollIntervalSeconds') ?? 0;
    if (seconds <= 0) return; // Opt-in only: bd spawns a process per poll.
    this.pollTimer = setInterval(() => void this.refresh(), seconds * 1000);
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.emitter.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('beadsUi');
}
