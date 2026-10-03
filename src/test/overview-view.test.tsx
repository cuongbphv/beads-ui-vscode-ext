// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { version as extensionVersion } from '../../package.json';
import { StatusIndex } from '../shared/model';
import type { Bead, DashboardSnapshot } from '../shared/types';
import { installResizeObserver } from './support/dom-harness';

// OverviewView now mounts HealthScorecard (bead beads-ui-vscode-ext-72m.2),
// which reaches `acquireVsCodeApi()` through `use-health.ts` -> bridge/rpc.
// That global only exists inside a real webview, so every test that renders
// OverviewView must stub the bridge, same as bead-detail-history.test.tsx
// does for bead-detail.tsx's own RPC-backed sections.
const rpc = vi.hoisted(() => ({ calls: new Array<{ method: string; params: unknown }>() }));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    rpc.calls.push({ method, params });
    return method === 'claimBead' ? Promise.resolve({ ok: true }) : new Promise(() => undefined);
  },
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

import { OverviewView } from '../webview/views/OverviewView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let mountedRoot: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.replaceChildren();
  rpc.calls.length = 0;
});

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'closed', category: 'done' },
]);

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return {
    title: partial.id,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...partial,
  };
}

/**
 * A minimal but real `DashboardSnapshot` — everything `OverviewView` reads
 * off it — so this test exercises the same shape the host actually sends,
 * not a partial mock.
 */
function snapshot(beads: Bead[], blockedIds: string[] = []): DashboardSnapshot {
  const openCount = beads.filter((b) => b.status !== 'closed').length;
  const closedCount = beads.length - openCount;
  return {
    context: { bd_version: 'test', beads_dir: '.beads', repo_root: '/repo' },
    vocabulary: { statuses: index.statuses, types: [] },
    stats: {
      total_issues: beads.length,
      open_issues: openCount,
      in_progress_issues: 0,
      blocked_issues: blockedIds.length,
      closed_issues: closedCount,
      deferred_issues: 0,
      pinned_issues: 0,
      ready_issues: 0,
    },
    beads,
    readyIds: [],
    blockedIds,
    gates: [],
    truncated: false,
    fetchedAt: '2026-08-24T00:00:00.000Z',
  };
}

async function mountSnapshot(data: DashboardSnapshot, onSelect = vi.fn()): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => {
    mountedRoot?.render(
      createElement(OverviewView, {
        snapshot: data,
        index,
        onSelect,
      }),
    );
  });
  return container;
}

async function mount(beads: Bead[], blockedIds: string[] = []): Promise<HTMLDivElement> {
  return mountSnapshot(snapshot(beads, blockedIds));
}

/** The rendered value of the stat card whose label starts with `label`. */
function statValue(root: HTMLElement, label: string): string | null {
  const cards = [...root.querySelectorAll('section[aria-label="Project statistics"] > div')];
  const card = cards.find((el) => el.textContent?.includes(label));
  return card?.querySelector('p')?.textContent ?? null;
}

describe('OverviewView extension version', () => {
  it('shows the packaged extension version above the statistics', async () => {
    installResizeObserver();
    const root = await mount([]);
    const badge = root.querySelector('[aria-label="Extension version"]');
    expect(badge?.textContent).toBe(`v${extensionVersion}`);
    const statistics = root.querySelector('[aria-label="Project statistics"]');
    expect(badge && statistics && (badge.compareDocumentPosition(statistics) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  });
});

describe('OverviewView molecules stat card', () => {
  it('counts only molecule-type issues outside the done category, derived from snapshot.beads', async () => {
    installResizeObserver();
    const beads = [
      bead({ id: 'mol-open', issue_type: 'molecule', status: 'open' }),
      bead({ id: 'mol-wip', issue_type: 'molecule', status: 'in_progress' }),
      bead({ id: 'mol-done', issue_type: 'molecule', status: 'closed' }),
      bead({ id: 'task-1', issue_type: 'task', status: 'open' }),
    ];

    const root = await mount(beads);

    expect(statValue(root, 'Molecules')).toBe('2');
  });

  it('shows zero when the snapshot has no molecule-type issues', async () => {
    installResizeObserver();
    const beads = [bead({ id: 'task-1' }), bead({ id: 'task-2', status: 'closed' })];

    const root = await mount(beads);

    expect(statValue(root, 'Molecules')).toBe('0');
  });
});

/** The "Blocked" list section, or null if it hasn't rendered. */
function blockedSection(root: HTMLElement): HTMLElement | null {
  return root.querySelector('section[aria-label="Blocked"]');
}

describe('OverviewView Blocked list row hint (beads-ui-vscode-ext-72m.6)', () => {
  it('shows the direct blocker title on a row with a single open blocker', async () => {
    installResizeObserver();
    const beads = [
      bead({
        id: 'a',
        title: 'Ship the release',
        dependencies: [{ id: 'b', dependency_type: 'blocks' }],
      }),
      bead({ id: 'b', title: 'Fix the flaky test' }),
    ];

    const root = await mount(beads, ['a']);

    expect(blockedSection(root)?.textContent).toContain('Blocked by');
    expect(blockedSection(root)?.textContent).toContain('Fix the flaky test');
  });

  it('shows the first blocker title plus a count when there is more than one', async () => {
    installResizeObserver();
    const beads = [
      bead({
        id: 'a',
        title: 'Ship the release',
        dependencies: [
          { id: 'b', dependency_type: 'blocks' },
          { id: 'c', dependency_type: 'blocks' },
        ],
      }),
      bead({ id: 'b', title: 'Fix the flaky test' }),
      bead({ id: 'c', title: 'Update the schema' }),
    ];

    const root = await mount(beads, ['a']);

    const text = blockedSection(root)?.textContent ?? '';
    expect(text).toContain('Fix the flaky test');
    expect(text).toContain('+1 more');
  });

  it('leaves the row unchanged when no open direct blocker is found (stale poll tick)', async () => {
    installResizeObserver();
    // "a" is listed as blocked this tick, but its only recorded blocker is
    // already closed — buildBlockerChain resolves an empty chain for it.
    const beads = [
      bead({
        id: 'a',
        title: 'Ship the release',
        dependencies: [{ id: 'b', dependency_type: 'blocks' }],
      }),
      bead({ id: 'b', title: 'Fix the flaky test', status: 'closed' }),
    ];

    const root = await mount(beads, ['a']);

    expect(blockedSection(root)?.textContent).not.toContain('Blocked by');
  });
});

describe('OverviewView Ready actions', () => {
  it('reveals a ready issue beyond eight, opens it, and claims via atomic RPC', async () => {
    installResizeObserver();
    const beads = Array.from({ length: 125 }, (_, i) => bead({ id: `bd-${i + 1}` }));
    const data = snapshot(beads);
    data.readyIds = beads.map((item) => item.id);
    data.stats.ready_issues = 150;
    data.issueScope = {
      loadedCount: 125, projectTotal: 200, excludedKinds: ['gates'], hasMore: true,
    };
    data.truncated = true;
    const onSelect = vi.fn();
    const root = await mountSnapshot(data, onSelect);

    const ready = root.querySelector('section[aria-label="Ready to start"]');
    expect(ready?.textContent).toContain('125 loaded ready · 150 project ready');
    expect(root.querySelector('[aria-label="Issue data scope"]')?.textContent).toContain('Loaded 125 ordinary issues (more available); project total 200 includes gates');
    expect(ready?.querySelector('[aria-label="bd-10: bd-10"]')).toBeNull();

    const more = [...(ready?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.includes('Show more ready issues'));
    await act(async () => more?.click());
    const card = ready?.querySelector<HTMLElement>('[aria-label="bd-10: bd-10"]');
    expect(card).not.toBeNull();
    await act(async () => card?.click());
    expect(onSelect).toHaveBeenCalledWith('bd-10');
    await act(async () => ready?.querySelector<HTMLButtonElement>('[aria-label="Claim bd-10"]')?.click());
    expect(rpc.calls).toContainEqual({ method: 'claimBead', params: { id: 'bd-10' } });
  });

  it('uses native ready membership for a custom status', async () => {
    installResizeObserver();
    const data = snapshot([
      bead({ id: 'triaged-1', status: 'triaged' }),
      bead({ id: 'open-1', status: 'open' }),
    ]);
    data.readyIds = ['triaged-1'];
    data.stats.ready_issues = 1;
    const root = await mountSnapshot(data);
    const ready = root.querySelector('section[aria-label="Ready to start"]');
    expect(ready?.textContent).toContain('triaged-1');
    expect(ready?.textContent).not.toContain('open-1');
  });
});
