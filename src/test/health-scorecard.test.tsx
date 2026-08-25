// @vitest-environment jsdom

/**
 * The Overview health drawer (bead beads-ui-vscode-ext-72m.2): collapsed by
 * default, fetches nothing until "Run checks" is pressed, and a failing
 * check renders its own error tile without blanking the other three.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface RpcCall {
  method: string;
  params: unknown;
}

const calls: RpcCall[] = [];
let nextResult: unknown;
let nextRejection: unknown;

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    calls.push({ method, params });
    if (nextRejection !== undefined) return Promise.reject(nextRejection);
    return Promise.resolve(nextResult);
  },
  asRpcError: (error: unknown) =>
    error && typeof error === 'object' && 'kind' in error
      ? error
      : { kind: 'unknown', message: String(error) },
}));

import { HealthScorecard } from '../webview/components/health-scorecard';

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
  calls.length = 0;
  nextResult = undefined;
  nextRejection = undefined;
});

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => {
    mountedRoot?.render(createElement(HealthScorecard, { onSelect: vi.fn() }));
  });
  return container;
}

function drawerToggle(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector('section[aria-label="Project health"] > button');
}

function findButtonByText(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
}

/** A StatCard tile with an onClick renders as `role="button"`, not a `<button>` element. */
function findTileByLabel(root: HTMLElement, label: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('[role="button"]')].find((el) => el.textContent?.includes(label));
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const REPORT = {
  stale: { ok: true, items: [] },
  orphans: { ok: true, items: [] },
  lint: { ok: true, items: [] },
  cycles: { ok: true, items: [] },
  staleDays: 30,
  fetchedAt: '2026-08-25T00:00:00.000Z',
};

describe('HealthScorecard', () => {
  it('fetches nothing on mount', async () => {
    await mount();
    expect(calls).toEqual([]);
  });

  it('starts collapsed, with no "Run checks" button visible until opened', async () => {
    const root = await mount();

    expect(root.textContent).not.toContain('Run checks');
    expect(drawerToggle(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(calls).toEqual([]);
  });

  it('opening the drawer alone does not fetch — only the "Run checks" click does', async () => {
    nextResult = REPORT;
    const root = await mount();

    await act(async () => drawerToggle(root)?.click());
    expect(drawerToggle(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(calls).toEqual([]);

    const runButton = findButtonByText(root, 'Run checks');
    expect(runButton).toBeDefined();
    await act(async () => runButton?.click());
    await flush();

    expect(calls).toEqual([{ method: 'getHealthReport', params: undefined }]);
  });

  it('renders per-check counts once the report arrives', async () => {
    nextResult = {
      stale: {
        ok: true,
        items: [{ id: 'bd-1', title: 'Stale one', status: 'open', priority: 2, issue_type: 'task' }],
      },
      orphans: { ok: true, items: [] },
      lint: { ok: true, items: [] },
      cycles: { ok: true, items: [] },
      staleDays: 30,
      fetchedAt: '2026-08-25T00:00:00.000Z',
    };
    const root = await mount();
    await act(async () => drawerToggle(root)?.click());
    await act(async () => findButtonByText(root, 'Run checks')?.click());
    await flush();

    expect(root.textContent).toContain('Stale');
    expect(root.textContent).toContain('Orphans');
    expect(root.textContent).toContain('Lint');
    expect(root.textContent).toContain('Dep cycles');
    expect(root.textContent).toMatch(/Checked/);
  });

  it('a failing check renders its own error tile without blanking the other three', async () => {
    nextResult = {
      stale: {
        ok: true,
        items: [{ id: 'bd-1', title: 'Stale one', status: 'open', priority: 2, issue_type: 'task' }],
      },
      orphans: { ok: true, items: [] },
      lint: { ok: false, items: [], error: 'bd lint failed' },
      cycles: { ok: true, items: [] },
      staleDays: 30,
      fetchedAt: '2026-08-25T00:00:00.000Z',
    };
    const root = await mount();
    await act(async () => drawerToggle(root)?.click());
    await act(async () => findButtonByText(root, 'Run checks')?.click());
    await flush();

    // The failing check surfaces its message...
    expect(root.textContent).toContain('bd lint failed');
    // ...while the three healthy checks still show their real data, not a blank drawer.
    expect(root.textContent).toContain('Orphans');
    expect(root.textContent).toContain('Dep cycles');
    const staleTile = findTileByLabel(root, 'Stale');
    expect(staleTile).toBeDefined();
    await act(async () => staleTile?.click());
    expect(root.textContent).toContain('Stale one');
  });

  it('an RpcError from the transport surfaces without crashing and without a stale report', async () => {
    nextRejection = { kind: 'unknown', message: 'bd exploded' };
    const root = await mount();
    await act(async () => drawerToggle(root)?.click());
    await act(async () => findButtonByText(root, 'Run checks')?.click());
    await flush();

    expect(root.textContent).toContain('bd exploded');
  });
});
