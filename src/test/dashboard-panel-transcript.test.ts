/**
 * `DashboardPanel`'s transcript wiring: `transcriptSubscribe`/
 * `transcriptUnsubscribe` (called by the router on `subscribeTranscript`/
 * `unsubscribeTranscript`) must resolve targets through `FleetService`'s
 * already-discovered paths, forward `transcriptAppend` batches to the
 * webview, and dispose its `TranscriptTailer` on panel dispose so nothing
 * keeps polling a closed panel's file.
 *
 * Real fixture files on disk, same style as `fleet-transcript-tailer.test.ts`
 * — this file exercises the real `TranscriptTailer` through `DashboardPanel`,
 * not a mock of it.
 */
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

vi.mock('vscode', () => ({
  EventEmitter: FakeEventEmitter,
  ViewColumn: { One: 1 },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: () => true })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
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
  /**
   * `DashboardPanel` registers its listener as `(message) => void
   * this.onMessage(message)` — matching the real `vscode` event signature,
   * which does not await handlers — so the returned promise is deliberately
   * discarded there. This helper cannot recover it either; it just gives the
   * real `fs` work inside `onMessage` (via `subscribeTranscript`) a moment to
   * finish before the caller asserts on `postMessage`.
   */
  receiveMessage: (message: unknown) => Promise<void>;
}

function makeFakePanel(): FakePanel {
  let messageListener: ((message: unknown) => void | Promise<void>) | undefined;

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
    receiveMessage: async (message: unknown) => {
      void messageListener?.(message);
      await new Promise((resolve) => setTimeout(resolve, 150)); // let the real fs I/O settle
    },
  };
}

class FakeFleetService {
  snapshot: FleetSnapshot | undefined;
  filePaths: Record<string, string> = {};
  baseDir: string | null = null;

  observe(): { dispose: () => void } {
    return { dispose: () => {} };
  }

  onDidChange = (): { dispose: () => void } => ({ dispose: () => {} });

  filePathFor(targetId: string): string | null {
    return this.filePaths[targetId] ?? null;
  }

  get transcriptsBaseDir(): string | null {
    return this.baseDir;
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

const context = { extensionUri: {} } as unknown as import('vscode').ExtensionContext;

let fakePanel: FakePanel;
let root: string;
let baseDir: string;

function jsonLine(role: 'user' | 'assistant', text: string): string {
  return `${JSON.stringify({ type: role, message: { role, content: text } })}\n`;
}

beforeEach(async () => {
  fakePanel = makeFakePanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
    fakePanel as unknown as import('vscode').WebviewPanel,
  );
  root = await mkdtemp(join(tmpdir(), 'dashboard-panel-transcript-test-'));
  baseDir = join(root, 'projects', 'proj-dir');
  await mkdir(baseDir, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('DashboardPanel transcript wiring', () => {
  it('resolves subscribeTranscript through FleetService and returns the tailer backfill', async () => {
    const filePath = join(baseDir, 'session-1.jsonl');
    await writeFile(filePath, jsonLine('user', 'hello'), 'utf8');

    const fleet = new FakeFleetService();
    fleet.baseDir = baseDir;
    fleet.filePaths['session:s1'] = filePath;

    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    const backfill = await panel.transcriptSubscribe('session:s1');

    expect(backfill.events).toHaveLength(1);
    expect(backfill.events[0].role).toBe('user');
    panel.dispose();
  });

  it('rejects a target FleetService cannot resolve', async () => {
    const fleet = new FakeFleetService();
    fleet.baseDir = baseDir;
    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    await expect(panel.transcriptSubscribe('agent:never-seen')).rejects.toThrow();
    panel.dispose();
  });

  it('posts transcriptAppend to the webview for a line appended after subscribe', async () => {
    const filePath = join(baseDir, 'session-2.jsonl');
    await writeFile(filePath, jsonLine('user', 'first'), 'utf8');

    const fleet = new FakeFleetService();
    fleet.baseDir = baseDir;
    fleet.filePaths['session:s2'] = filePath;

    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });
    // A short poll cadence is not configurable from the RPC surface, so this
    // waits out the tailer's real default interval — acceptable for one
    // integration-level test; `fleet-transcript-tailer.test.ts` covers the
    // fast-path timing exhaustively with an injected short interval.
    await panel.transcriptSubscribe('session:s2');

    fakePanel.webview.postMessage.mockClear();
    await appendFile(filePath, jsonLine('assistant', 'streamed'), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'event',
        name: 'transcriptAppend',
        targetId: 'session:s2',
        totalBytes: expect.any(Number),
      }),
    );
    panel.dispose();
  }, 10_000);

  it('routes subscribeTranscript/unsubscribeTranscript RPC requests through the panel itself', async () => {
    const filePath = join(baseDir, 'session-3.jsonl');
    await writeFile(filePath, jsonLine('user', 'hi'), 'utf8');

    const fleet = new FakeFleetService();
    fleet.baseDir = baseDir;
    fleet.filePaths['session:s3'] = filePath;

    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });

    await fakePanel.receiveMessage({
      kind: 'request',
      id: 1,
      method: 'subscribeTranscript',
      params: { targetId: 'session:s3' },
    });

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'response', id: 1, ok: true }),
    );

    await fakePanel.receiveMessage({
      kind: 'request',
      id: 2,
      method: 'unsubscribeTranscript',
      params: { targetId: 'session:s3' },
    });

    expect(fakePanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'response', id: 2, ok: true, data: { ok: true } }),
    );
    panel.dispose();
  });

  it('disposes the transcript tailer on panel dispose (no leaked poll loop)', async () => {
    const filePath = join(baseDir, 'session-4.jsonl');
    await writeFile(filePath, jsonLine('user', 'hi'), 'utf8');

    const fleet = new FakeFleetService();
    fleet.baseDir = baseDir;
    fleet.filePaths['session:s4'] = filePath;

    const panel = DashboardPanel.show(context, makeFakeStore(), fleet as unknown as FleetService, {
      revealBead: vi.fn(),
    });
    await panel.transcriptSubscribe('session:s4');
    panel.dispose();

    fakePanel.webview.postMessage.mockClear();
    await appendFile(filePath, jsonLine('assistant', 'after dispose'), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(fakePanel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'transcriptAppend' }),
    );
  }, 10_000);
});
