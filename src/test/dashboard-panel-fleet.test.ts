/**
 * `DashboardPanel`'s Fleet wiring: `fleetSubscribe`/`fleetUnsubscribe` (called
 * by the router on `subscribeFleet`/`unsubscribeFleet`) must gate
 * `FleetService.observe()` on *both* "this webview session subscribed" and
 * "the panel is actually on screen" — subscribed-but-hidden must not keep
 * discovery running, mirroring the discipline `bindVisibility` already gives
 * the bd store.
 *
 * `DashboardPanel.ts` imports the real `vscode` module, which does not exist
 * outside an editor host — this file fakes just the entry points it touches
 * (see the `store-watcher.test.ts` precedent) plus a `WebviewPanel` stand-in
 * so `onMessage`/`fleetSubscribe`/`fleetUnsubscribe` can be exercised without
 * a real editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetSnapshot } from '../shared/fleet';

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

const configListeners = new Set<(event: { affectsConfiguration: (key: string) => boolean }) => void>();

vi.mock('vscode', () => ({
  EventEmitter: FakeEventEmitter,
  ViewColumn: { One: 1 },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: () => true })),
    onDidChangeConfiguration: vi.fn(
      (listener: (event: { affectsConfiguration: (key: string) => boolean }) => void) => {
        configListeners.add(listener);
        return { dispose: () => configListeners.delete(listener) };
      },
    ),
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
  fireViewState: () => void;
  receiveMessage: (message: unknown) => void;
}

function makeFakePanel(): FakePanel {
  const viewStateListeners = new Set<() => void>();
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
    onDidChangeViewState: (listener: () => void) => {
      viewStateListeners.add(listener);
      return { dispose: () => viewStateListeners.delete(listener) };
    },
    onDidDispose: () => ({ dispose: vi.fn() }),
    dispose: vi.fn(),
    fireViewState: () => {
      for (const listener of [...viewStateListeners]) listener();
    },
    receiveMessage: (message: unknown) => messageListener?.(message),
  };
}

class FakeFleetService {
  observeCalls = 0;
  liveObservers = 0;
  snapshot: FleetSnapshot | undefined;
  private readonly listeners = new Set<(snapshot: FleetSnapshot) => void>();

  observe(): { dispose: () => void } {
    this.observeCalls += 1;
    this.liveObservers += 1;
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.liveObservers -= 1;
      },
    };
  }

  onDidChange = (listener: (snapshot: FleetSnapshot) => void): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(snapshot: FleetSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

function makeFakeStore(): BeadsStore {
  return {
    current: { loading: false },
    observe: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    refresh: vi.fn(async () => ({ loading: false })),
  } as unknown as BeadsStore;
}

function makeSnapshot(): FleetSnapshot {
  return {
    orchestrators: [],
    workers: [],
    worktrees: [],
    orphanWorktrees: [],
    generatedAt: new Date().toISOString(),
  };
}

const context = { extensionUri: {} } as unknown as import('vscode').ExtensionContext;

let fakePanel: FakePanel;

beforeEach(() => {
  configListeners.clear();
  fakePanel = makeFakePanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
    fakePanel as unknown as import('vscode').WebviewPanel,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardPanel Fleet subscribe/visibility gating', () => {
  it('does not observe the fleet until a webview session subscribes', () => {
    const fleet = new FakeFleetService();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    expect(fleet.observeCalls).toBe(0);
    panel.dispose();
  });

  it('observes the fleet once subscribed while the panel is visible', () => {
    const fleet = new FakeFleetService();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    panel.fleetSubscribe();

    expect(fleet.observeCalls).toBe(1);
    expect(fleet.liveObservers).toBe(1);
    panel.dispose();
  });

  it('stops observing when the panel becomes hidden, even while still subscribed', () => {
    const fleet = new FakeFleetService();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    panel.fleetSubscribe();
    expect(fleet.liveObservers).toBe(1);

    fakePanel.visible = false;
    fakePanel.fireViewState();

    expect(fleet.liveObservers).toBe(0);
    panel.dispose();
  });

  it('resumes observing when the panel becomes visible again while still subscribed', () => {
    const fleet = new FakeFleetService();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    panel.fleetSubscribe();
    fakePanel.visible = false;
    fakePanel.fireViewState();
    expect(fleet.liveObservers).toBe(0);

    fakePanel.visible = true;
    fakePanel.fireViewState();

    expect(fleet.liveObservers).toBe(1);
    panel.dispose();
  });

  it('stops observing once unsubscribed', () => {
    const fleet = new FakeFleetService();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    panel.fleetSubscribe();
    panel.fleetUnsubscribe();

    expect(fleet.liveObservers).toBe(0);
    panel.dispose();
  });

  it('forwards fleetChanged to the webview only while subscribed', () => {
    const fleet = new FakeFleetService();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    fleet.fire(makeSnapshot());
    expect(fakePanel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fleetChanged' }),
    );

    panel.fleetSubscribe();
    fakePanel.webview.postMessage.mockClear(); // the subscribe-time catch-up push is not this assertion's subject
    fleet.fire(makeSnapshot());

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fleetChanged' }),
    );
    panel.dispose();
  });

  it('catches a fresh subscriber up immediately with the last known snapshot', () => {
    const fleet = new FakeFleetService();
    fleet.snapshot = makeSnapshot();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    panel.fleetSubscribe();

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fleetChanged', fleet: fleet.snapshot }),
    );
    panel.dispose();
  });

  it('releases the fleet observation on dispose', () => {
    const fleet = new FakeFleetService();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    panel.fleetSubscribe();
    expect(fleet.liveObservers).toBe(1);

    panel.dispose();

    expect(fleet.liveObservers).toBe(0);
  });

  it('routes subscribeFleet/unsubscribeFleet RPC requests to the panel itself', async () => {
    const fleet = new FakeFleetService();
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    fakePanel.receiveMessage({ kind: 'request', id: 1, method: 'subscribeFleet', params: undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(fleet.liveObservers).toBe(1);
    panel.dispose();
  });
});
