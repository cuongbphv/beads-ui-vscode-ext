// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead, DashboardSnapshot } from '../shared/types';
import { installResizeObserver } from './support/dom-harness';
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
function snapshot(beads: Bead[]): DashboardSnapshot {
  const openCount = beads.filter((b) => b.status !== 'closed').length;
  const closedCount = beads.length - openCount;
  return {
    context: { bd_version: 'test', beads_dir: '.beads', repo_root: '/repo' },
    vocabulary: { statuses: index.statuses, types: [] },
    stats: {
      total_issues: beads.length,
      open_issues: openCount,
      in_progress_issues: 0,
      blocked_issues: 0,
      closed_issues: closedCount,
      deferred_issues: 0,
      pinned_issues: 0,
      ready_issues: 0,
    },
    beads,
    readyIds: [],
    blockedIds: [],
    gates: [],
    truncated: false,
    fetchedAt: '2026-08-24T00:00:00.000Z',
  };
}

async function mount(beads: Bead[]): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => {
    mountedRoot?.render(
      createElement(OverviewView, {
        snapshot: snapshot(beads),
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
