import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Store-level coverage for the `.beads/last-touched` file watcher (DEC-001:
 * the watcher is a doorbell, never a data source). `store.ts` imports the
 * real `vscode` module, which does not exist outside an editor host, so this
 * file provides just enough of a fake to exercise `BeadsStore`'s wiring:
 * `EventEmitter`, `RelativePattern`, and the handful of `workspace`/`window`
 * entry points the store actually touches (see the `vscode.` grep in
 * store.ts — nothing else is used).
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

/**
 * The store subscribes to configuration changes in its constructor, so the fake
 * has to keep the listeners rather than discard them: `fireConfigChange` below
 * is how a test replays "the user edited a setting".
 */
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

type Listener = () => void;

interface FakeWatcher {
  onDidChange: (listener: Listener) => { dispose: () => void };
  onDidCreate: (listener: Listener) => { dispose: () => void };
  dispose: () => void;
  fireChange: () => void;
  fireCreate: () => void;
}

function makeWatcher(): FakeWatcher {
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

/** Replay a settings edit, exactly as VS Code reports it: one changed key. */
function fireConfigChange(changedKey: string): void {
  const event = { affectsConfiguration: (key: string) => key === changedKey };
  for (const listener of [...configListeners]) listener(event);
}

let configValues: Record<string, unknown>;
let watcher: FakeWatcher;

beforeEach(() => {
  configListeners.clear();
  configValues = { pollIntervalSeconds: 5, issueLimit: 2000 };
  windowState.focused = true;
  watcher = makeWatcher();

  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (key: string) => configValues[key],
  } as unknown as import('vscode').WorkspaceConfiguration);
  vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
    watcher as unknown as import('vscode').FileSystemWatcher,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BeadsStore watcher wiring', () => {
  it('probes the board when the watcher fires while a view is on screen', () => {
    const store = new BeadsStore(makeFolder(), makeOutput());
    const tick = vi.spyOn(store, 'tick').mockResolvedValue();
    const hold = store.observe();
    tick.mockClear(); // observe() itself probes once; that is not this test's subject

    watcher.fireChange();

    expect(tick).toHaveBeenCalledTimes(1);

    hold.dispose();
    store.dispose();
  });

  it('ignores the watcher entirely when no view is observing', () => {
    const store = new BeadsStore(makeFolder(), makeOutput());
    const tick = vi.spyOn(store, 'tick').mockResolvedValue();

    watcher.fireChange();

    expect(tick).not.toHaveBeenCalled();

    store.dispose();
  });

  it('treats onDidCreate the same as onDidChange, since the file may not exist yet', () => {
    const store = new BeadsStore(makeFolder(), makeOutput());
    const tick = vi.spyOn(store, 'tick').mockResolvedValue();
    const hold = store.observe();
    tick.mockClear();

    watcher.fireCreate();

    expect(tick).toHaveBeenCalledTimes(1);

    hold.dispose();
    store.dispose();
  });

  it('coalesces a rapid burst of watcher events into a single probe', () => {
    const store = new BeadsStore(makeFolder(), makeOutput());
    const tick = vi.spyOn(store, 'tick').mockResolvedValue();
    const hold = store.observe();
    tick.mockClear();

    for (let i = 0; i < 10; i += 1) watcher.fireChange();

    expect(tick).toHaveBeenCalledTimes(1);

    hold.dispose();
    store.dispose();
  });

  it('keeps the configured cadence until the watcher proves itself, then backs it off', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const store = new BeadsStore(makeFolder(), makeOutput());
    vi.spyOn(store, 'tick').mockResolvedValue();
    const hold = store.observe();

    const beforeProof = setIntervalSpy.mock.calls.at(-1);
    expect(beforeProof?.[1]).toBe(5_000);

    watcher.fireChange(); // the watcher's first proof of life

    const afterProof = setIntervalSpy.mock.calls.at(-1);
    expect(afterProof?.[1]).toBe(30_000);

    hold.dispose();
    store.dispose();
  });

  it('disposes the watcher when the store is disposed', () => {
    const store = new BeadsStore(makeFolder(), makeOutput());
    store.dispose();

    expect(watcher.dispose).toHaveBeenCalled();
  });
});

/**
 * `beadsDashboard.bdPath` is the one setting the extension actively steers the
 * user towards — the `bd-not-found` toast carries an **Open Settings** button
 * pointing straight at it (`extension.ts:157-160`). A setting offered as the
 * remedy has to take effect without a window reload.
 */
describe('BeadsStore bdPath reconfiguration', () => {
  it('retargets bd and refreshes when beadsDashboard.bdPath changes', () => {
    const store = new BeadsStore(makeFolder(), makeOutput());
    const setBdPath = vi.spyOn(store.bd, 'setBdPath');
    const refresh = vi.spyOn(store, 'refresh').mockResolvedValue({ loading: false });

    configValues.bdPath = '/opt/homebrew/bin/bd';
    fireConfigChange('beadsDashboard.bdPath');

    expect(setBdPath).toHaveBeenCalledWith('/opt/homebrew/bin/bd');
    expect(store.bd.executable).toBe('/opt/homebrew/bin/bd');
    expect(refresh).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it('passes an unset bdPath through as unset, never as an empty string', () => {
    configValues.bdPath = '/opt/homebrew/bin/bd';
    const store = new BeadsStore(makeFolder(), makeOutput());
    vi.spyOn(store, 'refresh').mockResolvedValue({ loading: false });
    expect(store.bd.executable).toBe('/opt/homebrew/bin/bd');

    delete configValues.bdPath;
    fireConfigChange('beadsDashboard.bdPath');

    expect(store.bd.executable).toBe('bd');

    store.dispose();
  });

  it('leaves bd alone when some other setting changes', () => {
    const store = new BeadsStore(makeFolder(), makeOutput());
    const setBdPath = vi.spyOn(store.bd, 'setBdPath');
    const refresh = vi.spyOn(store, 'refresh').mockResolvedValue({ loading: false });

    fireConfigChange('beadsDashboard.pollIntervalSeconds');

    expect(setBdPath).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    store.dispose();
  });

  it('stops listening once disposed', () => {
    const store = new BeadsStore(makeFolder(), makeOutput());
    const setBdPath = vi.spyOn(store.bd, 'setBdPath');
    store.dispose();

    configValues.bdPath = '/opt/homebrew/bin/bd';
    fireConfigChange('beadsDashboard.bdPath');

    expect(setBdPath).not.toHaveBeenCalled();
  });
});
