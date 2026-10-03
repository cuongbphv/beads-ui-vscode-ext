// @vitest-environment jsdom

/**
 * The read-only sync-status header chip (bead ayq.2): mode-aware rendering,
 * ahead/behind/last-sync appearing only when present, and the copy button
 * copying the exact suggested command — never running a sync itself.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SyncStatus } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const copyCalls: unknown[] = [];

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    copyCalls.push({ method, params });
    return Promise.resolve({ ok: true });
  },
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

import { SyncStatusChip } from '../webview/components/sync-status-chip';

let mountedRoot: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  container?.remove();
  container = undefined;
  copyCalls.length = 0;
});

async function mount(props: {
  status: SyncStatus | undefined;
  loading?: boolean;
  error?: { kind: 'unknown'; message: string };
}): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () =>
    mountedRoot?.render(
      createElement(SyncStatusChip, {
        status: props.status,
        loading: props.loading ?? false,
        error: props.error,
      }),
    ),
  );
  return container;
}

describe('SyncStatusChip', () => {
  it('renders nothing before the first fetch (no status, not loading, no error)', async () => {
    const root = await mount({ status: undefined });
    expect(root.textContent).toBe('');
  });

  it('renders mode and server_running for the verified embedded-mode shape, with no ahead/behind/last-sync', async () => {
    const root = await mount({
      status: { mode: 'embedded', server_running: false },
    });

    expect(root.textContent).toContain('embedded');
    expect(root.textContent).toContain('Embedded mode uses no Dolt server process');
    expect(root.querySelector('[title]')?.getAttribute('title')).toContain('Server health does not indicate remote sync');
    expect(root.querySelector('[data-testid="sync-ahead-behind"]')).toBeNull();
    expect(root.textContent).not.toMatch(/synced/);
  });

  it('renders ahead/behind only when both are present in the status', async () => {
    const root = await mount({
      status: { mode: 'local-server', server_running: true, ahead: 2, behind: 1 },
    });

    const aheadBehind = root.querySelector('[data-testid="sync-ahead-behind"]');
    expect(aheadBehind).not.toBeNull();
    expect(aheadBehind?.textContent).toContain('2');
    expect(aheadBehind?.textContent).toContain('1');
  });

  it('renders last-sync only when present', async () => {
    const root = await mount({
      status: {
        mode: 'local-server',
        server_running: true,
        lastSyncAt: '2026-08-24T10:00:00.000Z',
      },
    });

    expect(root.textContent).toMatch(/synced/);
  });

  it('degraded status still renders (mode "unknown") rather than crashing', async () => {
    const root = await mount({
      status: { mode: 'unknown', server_running: false, degraded: true },
    });

    expect(root.textContent).toContain('unknown');
  });

  it('shows an error state without a status, and never a status placeholder for it', async () => {
    const root = await mount({
      status: undefined,
      error: { kind: 'unknown', message: 'bd exploded' },
    });

    expect(root.textContent).toContain('Dolt backend status unavailable');
  });

  it('marks an earlier backend result stale when the next status check fails', async () => {
    const root = await mount({
      status: { mode: 'local-server', server_running: true },
      error: { kind: 'unknown', message: 'server unreachable' },
    });
    expect(root.textContent).toContain('status stale');
    expect(root.querySelector('[role="status"]')?.getAttribute('title')).toBe('server unreachable');
    expect(root.querySelector('.bg-success')).toBeNull();
  });

  it('the copy button copies exactly the suggested command, via the copyText RPC, and never a push/pull mutation', async () => {
    const root = await mount({ status: { mode: 'embedded', server_running: false } });

    const button = root.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => button?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(copyCalls).toEqual([{ method: 'copyText', params: { text: 'bd dolt pull' } }]);
  });
});
