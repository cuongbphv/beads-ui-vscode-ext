import { describe, expect, it, vi } from 'vitest';

import type { Bead, BdGate, DashboardSnapshot } from '../shared/types';
import type { ActorResolver } from '../extension/actor';
import type { BeadsStore } from '../extension/store';

vi.mock('vscode', () => ({
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    constructor(public label: string, public collapsibleState: number) {}
  },
  ThemeIcon: class {
    constructor(public id: string, public color?: unknown) {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  MarkdownString: class {
    constructor(public value: string) {}
  },
  EventEmitter: class {
    event = () => ({ dispose: () => {} });
    fire = () => {};
    dispose = () => {};
  },
  workspace: { getConfiguration: () => ({ get: () => true }) },
}));

const { BeadsTreeProvider } = await import('../extension/tree/BeadsTreeProvider');

function issue(id: string, overrides: Partial<Bead> = {}): Bead {
  return { id, title: id, status: 'open', priority: 2, issue_type: 'task', ...overrides };
}

function gate(id: string, awaitType: BdGate['await_type'] = 'human'): BdGate {
  return { id, title: id, status: 'open', priority: 2, issue_type: 'gate', await_type: awaitType };
}

function snapshot(beads: Bead[], gates: BdGate[] = [], readyIds: string[] = [], blockedIds: string[] = []): DashboardSnapshot {
  return {
    context: { bd_version: '1.3.1', beads_dir: '.beads', repo_root: '/repo' },
    vocabulary: { statuses: [
      { name: 'open', category: 'active' },
      { name: 'in_progress', category: 'wip' },
      { name: 'closed', category: 'done' },
    ], types: [] },
    stats: { total_issues: beads.length, open_issues: beads.length, in_progress_issues: 0, blocked_issues: 0, closed_issues: 0, deferred_issues: 0, pinned_issues: 0, ready_issues: readyIds.length },
    beads, gates, readyIds, blockedIds, truncated: false, fetchedAt: '2026-10-03T00:00:00Z',
  };
}

function makeProvider(initial: DashboardSnapshot): {
  provider: InstanceType<typeof BeadsTreeProvider>;
  update: (next: DashboardSnapshot) => void;
} {
  let current = initial;
  let changed: (() => void) | undefined;
  const store = {
    get current() { return { snapshot: current, loading: false }; },
    onDidChange(listener: () => void) { changed = listener; return { dispose: () => {} }; },
  } as unknown as BeadsStore;
  const actor = { get current() { return 'alice'; } } as ActorResolver;
  return {
    provider: new BeadsTreeProvider(store, actor, 'mine'),
    update(next) { current = next; changed?.(); },
  };
}

describe('Needs You tree', () => {
  it('uses Beads ready and blocked membership, current owner, and human gates', () => {
    const { provider } = makeProvider(snapshot([
      issue('mine-ready', { assignee: 'alice' }),
      issue('mine-blocked', { assignee: 'alice', blocked_by_count: 1 }),
      issue('other', { assignee: 'bob' }),
    ], [{ ...gate('review'), owner: 'reviewer' }, gate('timer', 'timer')], ['mine-ready', 'mine-blocked'], ['mine-blocked']));
    const nodes = provider.getChildren();
    expect(nodes.map((node) => node.label)).toContain('Gates (1)');
    const review = provider.getChildren(nodes[0])[0];
    expect(review.gateId).toBe('review');
    expect(review.description).toContain('reviewer');
    const tooltip = review.tooltip;
    expect(typeof tooltip === 'string' ? tooltip : tooltip?.value).toContain('Resolve this gate after the decision');
    expect(nodes.find((node) => node.bead?.id === 'mine-ready')?.description).toContain('ready');
    expect(nodes.find((node) => node.bead?.id === 'mine-blocked')?.description).toContain('blocked');
    expect(nodes.find((node) => node.bead?.id === 'mine-blocked')?.description).not.toContain('ready');
    expect(nodes.some((node) => node.bead?.id === 'other')).toBe(false);
    provider.dispose();
  });

  it('refreshes after a claim changes owner and a human gate resolves, even with no ordinary issues', () => {
    const { provider, update } = makeProvider(snapshot([], [gate('review')]));
    expect(provider.getChildren()[0]?.label).toBe('Gates (1)');
    update(snapshot([issue('claimed', { assignee: 'alice', status: 'in_progress' })]));
    const nodes = provider.getChildren();
    expect(nodes.some((node) => node.kind === 'gate')).toBe(false);
    expect(nodes.find((node) => node.bead?.id === 'claimed')?.description).toContain('claimed');
    provider.dispose();
  });
});
