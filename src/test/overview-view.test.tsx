// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead, DashboardSnapshot } from '../shared/types';
import { installResizeObserver } from './support/dom-harness';

// OverviewView now mounts HealthScorecard (bead beads-ui-vscode-ext-72m.2),
// which reaches `acquireVsCodeApi()` through `use-health.ts` -> bridge/rpc.
// That global only exists inside a real webview, so every test that renders
// OverviewView must stub the bridge, same as bead-detail-history.test.tsx
// does for bead-detail.tsx's own RPC-backed sections.
vi.mock('../webview/bridge/rpc', () => ({
  call: () => new Promise(() => undefined),
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

async function mount(beads: Bead[], blockedIds: string[] = []): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => {
    mountedRoot?.render(
      createElement(OverviewView, {
        snapshot: snapshot(beads, blockedIds),
        index,
        onSelect: vi.fn(),
      }),
    );
  });
  return container;
}

/** The rendered value of the stat card whose label starts with `label`. */
function statValue(root: HTMLElement, label: string): string | null {
  const cards = [...root.querySelectorAll('section[aria-label="Project statistics"] > div')];
  const card = cards.find((el) => el.textContent?.includes(label));
  return card?.querySelector('p')?.textContent ?? null;
}

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
