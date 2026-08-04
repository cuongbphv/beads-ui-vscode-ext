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
import { PollGate, pollingEnabled } from './poll-gate';

export interface StoreState {
  snapshot?: DashboardSnapshot;
  error?: RpcError;
  loading: boolean;
}

/**
 * Cadence of the change probe when a Beads view is on screen.
 *
 * The headline use of this extension is watching an agent file and close beads
 * while you work, so "you have to press Refresh" is not an acceptable default.
 * What makes a live default affordable is that a tick is *not* a refresh: it is
 * one `bd list --limit 1` fingerprint (see `BdQueries.watermark`), and the
 * six-way snapshot fan-out only runs when that fingerprint moves.
 */
export const DEFAULT_POLL_SECONDS = 5;

/**
 * Probe ticks between forced full refreshes.
 *
 * The fingerprint cannot see two writes to the same issue inside the same
 * second, and a `bd delete` leaves a tombstone the list filters out. Neither is
 * worth a more expensive probe, but both would otherwise leave the view stale
 * indefinitely — so once a minute the answer is taken from the data itself.
 */
const FULL_RESYNC_TICKS = 12;

/**
 * Bind a view's visibility to the store's poll gate.
 *
 * Polling is charged to whoever is looking: the panel and each tree view hold an
 * observer while they are on screen and release it when they are not, so a
 * window sitting on an unrelated file spawns no `bd` at all.
 */
export function bindVisibility(
  store: BeadsStore,
  view: { visible: boolean; onDidChange: (listener: () => void) => vscode.Disposable },
): vscode.Disposable {
  let hold: vscode.Disposable | undefined = view.visible ? store.observe() : undefined;

  const subscription = view.onDidChange(() => {
    if (view.visible && !hold) hold = store.observe();
    else if (!view.visible && hold) {
      hold.dispose();
      hold = undefined;
    }
  });

  return {
    dispose: () => {
      subscription.dispose();
      hold?.dispose();
    },
  };
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

  /** How many views are currently on screen. Polling runs only above zero. */
  private observers = 0;
  /** Fingerprint bookkeeping — the part worth testing without an editor. */
  private readonly gate = new PollGate(FULL_RESYNC_TICKS);

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
        if (event.affectsConfiguration('beadsDashboard.pollIntervalSeconds')) this.restartPolling();
        if (event.affectsConfiguration('beadsDashboard.issueLimit')) void this.refresh();
      }),
      // An unfocused window cannot be watched, so it is not worth a process. The
      // catch-up probe on the way back in is what makes that safe.
      vscode.window.onDidChangeWindowState(() => {
        this.restartPolling();
        if (vscode.window.state.focused) void this.tick();
      }),
    );

    this.restartPolling();
  }

  get current(): StoreState {
    return this.state;
  }

  /**
   * Register a view as on screen. Dispose the result when it is hidden.
   *
   * The first observer also probes immediately: a view that was hidden while an
   * agent worked would otherwise show a stale board for up to one interval.
   */
  observe(): vscode.Disposable {
    this.observers += 1;
    if (this.observers === 1) {
      this.restartPolling();
      void this.tick();
    }

    let released = false;
    return {
      dispose: () => {
        if (released) return;
        released = true;
        this.observers = Math.max(0, this.observers - 1);
        if (this.observers === 0) this.restartPolling();
      },
    };
  }

  /** Refresh, coalescing concurrent callers onto one in-flight fetch. */
  async refresh(): Promise<StoreState> {
    if (this.pending) return this.pending;

    this.setState({ ...this.state, loading: true, error: undefined });

    this.pending = (async () => {
      try {
        const limit = config().get<number>('issueLimit') ?? 2000;
        const snapshot = await this.queries.snapshot(limit);
        // The data is now current by definition; let the next probe re-establish
        // the fingerprint instead of guessing it from these rows.
        this.gate.reset();
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

  /**
   * One cycle of the change probe.
   *
   * Public for the unit suite, which drives it directly rather than waiting on a
   * timer.
   */
  async tick(): Promise<void> {
    // A refresh already in flight will answer the same question, and its
    // completion resets the fingerprint.
    if (this.pending) return;

    if (this.gate.dueForResync()) {
      await this.refresh();
      return;
    }

    try {
      if (this.gate.changed(await this.queries.watermark())) await this.refresh();
    } catch (error) {
      // A probe that fails is not news: `refresh()` owns error reporting, and a
      // transient failure must not blank the board or spam the log every tick.
      this.output.appendLine(`poll probe failed: ${toRpcError(error).message}`);
    }
  }

  private restartPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;

    // `0` still means "never poll" — the escape hatch for anyone who wants the
    // extension to spawn nothing it was not asked to spawn. Nobody looking, or a
    // window in the background, costs no process either.
    const seconds = config().get<number>('pollIntervalSeconds') ?? DEFAULT_POLL_SECONDS;
    if (!pollingEnabled(seconds, this.observers, vscode.window.state.focused)) return;

    this.pollTimer = setInterval(() => void this.tick(), seconds * 1000);
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.emitter.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('beadsDashboard');
}
