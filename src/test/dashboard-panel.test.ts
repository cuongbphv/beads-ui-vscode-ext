/**
 * `DashboardPanel`'s non-Fleet wiring: the settings push (on `ready` and on
 * `beadsDashboard.showClosed` config changes), the mutation-error toast, the
 * `ready` handshake (settings + snapshot/error + initial tab), and the
 * `focus`/`setTab` host-initiated events.
 *
 * `dashboard-panel-fleet.test.ts` already covers `fleetSubscribe`/
 * `fleetUnsubscribe` visibility gating; this file is a sibling rather than an
 * extension of it so that file's scope note ("Fleet wiring") stays accurate
 * and the two concerns don't blur together. Mocking follows the same pattern
 * it established: fake just the `vscode` entry points `DashboardPanel.ts`
 * touches, plus a `WebviewPanel` stand-in, so `onMessage` can be exercised
 * without a real editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardSnapshot } from '../shared/types';
import type { RpcError } from '../shared/protocol';

type ConfigChangeListener = (event: { affectsConfiguration: (key: string) => boolean }) => void;

const configListeners = new Set<ConfigChangeListener>();
/** Mutable so a test can flip what `getConfiguration('beadsDashboard').get('showClosed', ...)` returns. */
let showClosedValue = true;

vi.mock('vscode', () => ({
  ViewColumn: { One: 1 },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: () => showClosedValue })),
    onDidChangeConfiguration: vi.fn((listener: ConfigChangeListener) => {
      configListeners.add(listener);
      return { dispose: () => configListeners.delete(listener) };
    }),
  },
  window: {
    activeTextEditor: undefined,
    createWebviewPanel: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  Uri: { joinPath: vi.fn(() => ({})) },
}));

const vscode = await import('vscode');
const { DashboardPanel } = await import('../extension/panel/DashboardPanel');
import type { BeadsStore } from '../extension/store';
import type { FleetService } from '../extension/fleet/FleetService';
import type { FleetSnapshot } from '../shared/fleet';

interface FakePanel {
  iconPath: unknown;
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
    cspSource: string;
    asWebviewUri: (uri: unknown) => unknown;
  };
  visible: boolean;
  viewColumn: number;
  reveal: ReturnType<typeof vi.fn>;
  onDidChangeViewState: (listener: () => void) => { dispose: () => void };
  onDidDispose: (listener: () => void) => { dispose: () => void };
  dispose: ReturnType<typeof vi.fn>;
  receiveMessage: (message: unknown) => void;
}

function makeFakePanel(): FakePanel {
  let messageListener: ((message: unknown) => void) | undefined;

  return {
    iconPath: undefined,
    webview: {
      html: '',
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
        messageListener = listener;
        return { dispose: vi.fn() };
      }),
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: unknown) => uri,
    },
    visible: true,
    viewColumn: 1,
    reveal: vi.fn(),
    onDidChangeViewState: () => ({ dispose: vi.fn() }),
    onDidDispose: () => ({ dispose: vi.fn() }),
    dispose: vi.fn(),
    receiveMessage: (message: unknown) => messageListener?.(message),
  };
}

/** Never actually observed in this file's tests, but the constructor wires `fleet.onDidChange`. */
class FakeFleetService {
  snapshot: FleetSnapshot | undefined;
  observe(): { dispose: () => void } {
    return { dispose: vi.fn() };
  }
  onDidChange = (): { dispose: () => void } => ({ dispose: vi.fn() });
}

/**
 * Minimal `BeadsStore` stand-in. `onMessage`'s `ready` branch only reaches
 * `store.current`/`store.refresh`; the RPC dispatch paths exercised here
 * (missing-parameter errors) throw before touching `store.queries`/
 * `store.mutations`, so neither needs to be modelled — same scope the fleet
 * test's fake store already keeps.
 */
function makeFakeStore(overrides: Partial<BeadsStore> = {}): BeadsStore {
  return {
    current: { loading: false },
    observe: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    refresh: vi.fn(async () => ({ loading: false })),
    // Never actually invoked in this file's RPC tests — both dispatch cases
    // exercised here throw out of `id()` (a missing "id" param) before their
    // method is called — but the member access `queries.show`/
    // `mutations.setStatus` happens first and throws on `undefined`, so these
    // need to exist.
    queries: {},
    mutations: {},
    ...overrides,
  } as unknown as BeadsStore;
}

const context = { extensionUri: {} } as unknown as import('vscode').ExtensionContext;

let fakePanel: FakePanel;
let fleet: FakeFleetService;

beforeEach(() => {
  configListeners.clear();
  showClosedValue = true;
  fakePanel = makeFakePanel();
  fleet = new FakeFleetService();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
    fakePanel as unknown as import('vscode').WebviewPanel,
  );
  // `showErrorMessage` lives on the shared `vscode` mock (not a per-test fake
  // panel), so a call recorded by one test would otherwise still be visible
  // to the next.
  vi.mocked(vscode.window.showErrorMessage).mockClear();
});

afterEach(() => {
  // Guard against a leaked singleton: `DashboardPanel.current` is static, so a
  // test that throws before its own `panel.dispose()` would otherwise leave a
  // stale panel behind for the next test's `show()` to return instead of a
  // fresh one.
  DashboardPanel.active?.dispose();
  vi.restoreAllMocks();
});

function show(store: BeadsStore, tab?: import('../shared/protocol').DashboardTab) {
  return DashboardPanel.show(
    context,
    store,
    fleet as unknown as FleetService,
    { revealBead: vi.fn() },
    tab,
  );
}

describe('DashboardPanel settings push', () => {
  it('pushes settings, ahead of the snapshot, in response to ready', async () => {
    const snapshot = {} as DashboardSnapshot;
    const panel = show(makeFakeStore({ current: { snapshot, loading: false } }));

    fakePanel.receiveMessage({ kind: 'ready' });
    await Promise.resolve();
    await Promise.resolve();

    const calls = fakePanel.webview.postMessage.mock.calls.map((call) => call[0]);
    const settingsIndex = calls.findIndex((event) => event.name === 'settings');
    const snapshotIndex = calls.findIndex((event) => event.name === 'issuesChanged');

    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(settingsIndex);
    expect(calls[settingsIndex]).toEqual({
      kind: 'event',
      name: 'settings',
      settings: { showClosed: true },
    });
    panel.dispose();
  });

  it('re-pushes settings when the showClosed configuration changes', () => {
    const panel = show(makeFakeStore());
    fakePanel.webview.postMessage.mockClear();

    showClosedValue = false;
    for (const listener of [...configListeners]) {
      listener({ affectsConfiguration: (key) => key === 'beadsDashboard.showClosed' });
    }

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'settings',
      settings: { showClosed: false },
    });
    panel.dispose();
  });

  it('does not push settings for a configuration change that does not affect showClosed', () => {
    const panel = show(makeFakeStore());
    fakePanel.webview.postMessage.mockClear();

    for (const listener of [...configListeners]) {
      listener({ affectsConfiguration: () => false });
    }

    expect(fakePanel.webview.postMessage).not.toHaveBeenCalled();
    panel.dispose();
  });
});

describe('DashboardPanel ready handshake', () => {
  it('pushes the already-cached snapshot without calling refresh', async () => {
    const snapshot = { truncated: false } as unknown as DashboardSnapshot;
    const store = makeFakeStore({ current: { snapshot, loading: false } });
    const panel = show(store);

    fakePanel.receiveMessage({ kind: 'ready' });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.refresh).not.toHaveBeenCalled();
    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'issuesChanged',
      snapshot,
    });
    panel.dispose();
  });

  it('refreshes and pushes the resulting snapshot when none is cached yet', async () => {
    const snapshot = { truncated: true } as unknown as DashboardSnapshot;
    const store = makeFakeStore({
      current: { loading: false },
      refresh: vi.fn(async () => ({ snapshot, loading: false })),
    });
    const panel = show(store);

    fakePanel.receiveMessage({ kind: 'ready' });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'issuesChanged',
      snapshot,
    });
    panel.dispose();
  });

  it('pushes an error event when the store has no snapshot and an error instead', async () => {
    const error: RpcError = { message: 'bd not found', kind: 'bd-not-found' };
    const store = makeFakeStore({
      current: { loading: false },
      refresh: vi.fn(async () => ({ error, loading: false })),
    });
    const panel = show(store);

    fakePanel.receiveMessage({ kind: 'ready' });
    await Promise.resolve();
    await Promise.resolve();

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'error',
      error,
    });
    panel.dispose();
  });

  it('pushes the initial tab after the snapshot when one was requested at show()', async () => {
    const snapshot = {} as DashboardSnapshot;
    const store = makeFakeStore({ current: { snapshot, loading: false } });
    const panel = show(store, 'board');

    fakePanel.receiveMessage({ kind: 'ready' });
    await Promise.resolve();
    await Promise.resolve();

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'setTab',
      tab: 'board',
    });
    panel.dispose();
  });
});

describe('DashboardPanel mutation error toast', () => {
  it('shows an error toast when a mutation RPC fails', async () => {
    const panel = show(makeFakeStore());

    fakePanel.receiveMessage({ kind: 'request', id: 1, method: 'setStatus', params: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'bd: Missing required parameter "id".',
    );
    panel.dispose();
  });

  it('does not toast when a failing RPC is not a mutation', async () => {
    const panel = show(makeFakeStore());

    fakePanel.receiveMessage({ kind: 'request', id: 1, method: 'showBead', params: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    panel.dispose();
  });
});

describe('DashboardPanel focus/setTab', () => {
  it('focus() reveals the panel and posts focusBead', () => {
    const panel = show(makeFakeStore());

    panel.focus('bd-1');

    expect(fakePanel.reveal).toHaveBeenCalledWith(fakePanel.viewColumn);
    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'focusBead',
      id: 'bd-1',
    });
    panel.dispose();
  });

  it('setTab() posts a setTab event', () => {
    const panel = show(makeFakeStore());

    panel.setTab('overview');

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'setTab',
      tab: 'overview',
    });
    panel.dispose();
  });
});
