import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Repro for beads-ui-vscode-ext-9e9.9.
 *
 * The bead's original theory was that `poll-gate.ts`'s focus check
 * (`pollingEnabled`) lets a mutation's own auto-triggered refresh silently
 * fail to land in an unfocused window. Reading `store.ts` shows that theory
 * does not hold: `pollingEnabled`/`focused` only gates whether the periodic
 * `setInterval` timer runs (`restartPolling`) — the mutation path
 * (`this.mutations.onChanged(() => void this.refresh())`) calls `refresh()`
 * directly, with no focus check anywhere in `refresh()` or `tick()`. This
 * file exercises the real mechanism instead: `refresh()`'s own concurrency
 * coalescing (`if (this.pending) return this.pending;`).
 *
 * `BdService.exec()` spawns one subprocess per call with no queue/serialization
 * (see BdService.ts), so nothing stops a poll tick's `queries.snapshot()`
 * fan-out (several `bd` subcommands, launched via `Promise.all`) from still
 * being in flight when a mutation's own `bd create`/`bd update` finishes and
 * calls `notify()` -> `refresh()`. `refresh()` has no way to tell "a caller
 * showed up wanting data newer than what's already in flight" from "a caller
 * is happy with whatever the in-flight fetch returns" — it always answers
 * every waiting caller with the *same* in-flight promise. If that promise
 * was already running before the mutation's write landed, the coalesced
 * caller's data can silently miss the mutation, `changeProbe.reset()` then
 * adopts the resulting (stale) fingerprint as the new baseline, and nothing
 * schedules a follow-up fetch — exactly the "silently fail to land, with
 * nothing to force a later retry" symptom bead 9e9.4 worked around with
 * explicit `Beads: Refresh` calls. This has nothing to do with window focus.
 *
 * A first attempt at fixing this (commit 7cf3587, reverted at e1ed87b) ran
 * the trailing "catch me up" fetch by recursively calling the *public*
 * `refresh()` again from inside the in-flight fetch's `finally` block. That
 * recursive call re-ran the `loading: true` / `loading: false` state-flip
 * dance on every trailing pass, and — because a new external caller arriving
 * during any trailing pass queues yet another one — nothing bounded how many
 * `setState` transitions a single burst of activity could produce. Against
 * `scripts/e2e/editing-suite.spec.mjs`'s real create-issue flow this showed
 * up as the board never settling long enough for Playwright's stability
 * check to pass on the "+ Add issue" button (confirmed live via bisection:
 * reverting only `store.ts` to its pre-9e9.9 content made the same E2E run
 * pass cleanly; the current fix's own loop lives entirely inside one async
 * function and fires `setState({loading: true})` exactly once per external
 * `refresh()` call, however many internal passes the `do`/`while` takes).
 */
class FakeEventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  event = (listener: (value: T) => void): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

class FakeRelativePattern {
  constructor(
    public readonly base: unknown,
    public readonly pattern: string,
  ) {}
}

const windowState = { focused: true };
const configListeners = new Set<(event: { affectsConfiguration: (key: string) => boolean }) => void>();

vi.mock('vscode', () => ({
  EventEmitter: FakeEventEmitter,
  RelativePattern: FakeRelativePattern,
  workspace: {
    getConfiguration: vi.fn(),
    onDidChangeConfiguration: vi.fn(
      (listener: (event: { affectsConfiguration: (key: string) => boolean }) => void) => {
        configListeners.add(listener);
        return { dispose: () => configListeners.delete(listener) };
      },
    ),
    createFileSystemWatcher: vi.fn(),
  },
  window: {
    get state() {
      return windowState;
    },
    onDidChangeWindowState: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

const vscode = await import('vscode');
const { BeadsStore } = await import('../extension/store');
type DashboardSnapshotLike = Awaited<ReturnType<InstanceType<typeof BeadsStore>['queries']['snapshot']>>;

function makeWatcher() {
  const changeEmitter = new FakeEventEmitter<void>();
  const createEmitter = new FakeEventEmitter<void>();
  return {
    onDidChange: changeEmitter.event,
    onDidCreate: createEmitter.event,
    dispose: vi.fn(),
    fireChange: () => changeEmitter.fire(undefined),
    fireCreate: () => createEmitter.fire(undefined),
  };
}

function makeFolder(): import('vscode').WorkspaceFolder {
  return {
    uri: { fsPath: '/fake/workspace' },
    name: 'fake',
    index: 0,
  } as unknown as import('vscode').WorkspaceFolder;
}

function makeOutput(): import('vscode').OutputChannel {
  return { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
}

function makeSnapshot(beadIds: string[]): DashboardSnapshotLike {
  return {
    context: {},
    vocabulary: {},
    stats: {},
    beads: beadIds.map((id) => ({ id })),
    readyIds: [],
    blockedIds: [],
    gates: [],
    truncated: false,
    fetchedAt: new Date().toISOString(),
  } as unknown as DashboardSnapshotLike;
}

/** A promise plus the callbacks to settle it later, for controlling fetch timing by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  configListeners.clear();
  windowState.focused = true;
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (key: string) => ({ pollIntervalSeconds: 5, issueLimit: 2000 } as Record<string, unknown>)[key],
  } as unknown as import('vscode').WorkspaceConfiguration);
  vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
    makeWatcher() as unknown as import('vscode').FileSystemWatcher,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BeadsStore.refresh() concurrency coalescing (focus-independent)', () => {
  it('runs a trailing fetch so a mutation that lands mid-fetch is never permanently dropped', async () => {
    const store = new BeadsStore(makeFolder(), makeOutput());

    const first = deferred<DashboardSnapshotLike>();
    const second = deferred<DashboardSnapshotLike>();
    const calls: Array<Promise<DashboardSnapshotLike>> = [first.promise, second.promise];
    let callIndex = 0;
    const snapshotSpy = vi
      .spyOn(store.queries, 'snapshot')
      .mockImplementation(() => calls[callIndex++] ?? Promise.resolve(makeSnapshot([])));

    // A poll tick's own refresh starts first (e.g. the 12-tick resync backstop,
    // or a fingerprint move from someone else's write) and is still in flight
    // — its underlying `bd` subprocesses were launched before the mutation
    // below ever happened.
    const tickRefresh = store.refresh();

    // The mutation itself lands and completes ("bd create" resolves), then
    // `BdMutations.onChanged` fires and calls `refresh()` exactly as
    // store.ts's mutation subscription does. This is the call that must see
    // the new issue.
    const mutationRefresh = store.refresh();

    // Only one underlying `bd` fetch was actually started — the mutation's
    // refresh request was coalesced onto the tick's already-running fetch.
    expect(snapshotSpy).toHaveBeenCalledTimes(1);

    // The in-flight fetch resolves with the snapshot it captured *before* the
    // mutation landed (it has no way to know a newer write is now pending).
    first.resolve(makeSnapshot(['old-1']));
    // Give the loop one microtask turn to notice `refreshQueued` and start
    // the trailing pass before asserting on it.
    await Promise.resolve();
    await Promise.resolve();

    // ...but the mutation's refresh() call, having arrived while the first
    // fetch was in flight, queued a trailing fetch that starts the moment
    // the first one finishes — this is what used to never happen.
    expect(snapshotSpy).toHaveBeenCalledTimes(2);

    // Both callers await the *same* promise, which now only settles once the
    // trailing pass lands too — so the mutation's effect is never exposed as
    // merely "eventually true if you keep checking": every awaiter of this
    // `refresh()` call gets the caught-up result directly, with no unfocused
    // window / 12-tick backstop needed to recover it.
    second.resolve(makeSnapshot(['old-1', 'new-mutation-issue']));
    await Promise.all([tickRefresh, mutationRefresh]);
    expect(store.current.snapshot?.beads.map((b) => b.id)).toEqual(['old-1', 'new-mutation-issue']);

    store.dispose();
  });

  it('does not queue a trailing fetch when no call arrives while one is in flight', async () => {
    const store = new BeadsStore(makeFolder(), makeOutput());

    const only = deferred<DashboardSnapshotLike>();
    const snapshotSpy = vi.spyOn(store.queries, 'snapshot').mockReturnValue(only.promise);

    await Promise.resolve(); // let refresh() start before resolving
    const refreshPromise = store.refresh();
    only.resolve(makeSnapshot(['solo']));
    await refreshPromise;

    // No second caller showed up during the fetch, so no trailing fetch is owed.
    await Promise.resolve();
    expect(snapshotSpy).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it(
    'regression (beads-ui-vscode-ext-9e9.9): a trailing fetch produces exactly one loading ' +
      'transition, not one per pass — the sustained-re-render bug from the first (reverted) fix',
    async () => {
      const store = new BeadsStore(makeFolder(), makeOutput());

      const passes = [deferred<DashboardSnapshotLike>(), deferred<DashboardSnapshotLike>(), deferred<DashboardSnapshotLike>()];
      let callIndex = 0;
      vi.spyOn(store.queries, 'snapshot').mockImplementation(() => passes[callIndex++].promise);

      const loadingTransitions: boolean[] = [];
      store.onDidChange((state) => loadingTransitions.push(state.loading));

      // Three overlapping external callers, each arriving while the previous
      // pass is still in flight — the same shape a rapid burst of mutations
      // (or a mutation racing a poll tick racing another mutation) produces.
      const r1 = store.refresh();
      const r2 = store.refresh(); // arrives while pass 1 is in flight -> queues pass 2
      passes[0].resolve(makeSnapshot(['p1']));
      await Promise.resolve();
      await Promise.resolve();
      const r3 = store.refresh(); // arrives while pass 2 is in flight -> queues pass 3
      passes[1].resolve(makeSnapshot(['p1', 'p2']));
      await Promise.resolve();
      await Promise.resolve();
      passes[2].resolve(makeSnapshot(['p1', 'p2', 'p3']));
      await Promise.all([r1, r2, r3]);

      // Three fetch passes ran (the trailing-fetch behaviour above one, but
      // regardless of how many, `loading` must transition true -> false
      // exactly once for the whole burst, not once per pass. The reverted
      // fix's recursive `void this.refresh()` fired `loading: true` again on
      // every trailing pass, which is what kept the real board re-rendering
      // for the full length of a burst instead of settling once.
      expect(loadingTransitions.filter((loading) => loading === true)).toHaveLength(1);
      expect(loadingTransitions.at(-1)).toBe(false);
      expect(store.current.snapshot?.beads.map((b) => b.id)).toEqual(['p1', 'p2', 'p3']);

      store.dispose();
    },
  );
});
