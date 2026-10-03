// @vitest-environment jsdom

/**
 * `WorkerList`: orchestrators + their workers, the unassociated worktrees section,
 * the degraded empty state, and (beads-ui-vscode-ext-37b) click-to-select
 * into the transcript pane with `aria-current` on the selected row —
 * all a pure function of the `FleetSnapshot` and `selectedTarget` it is handed.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FleetSnapshot, FleetWorker, FleetWorktree } from '../shared/fleet';
import type { FleetStatusFilter } from '../shared/fleet-filter';
import type { Bead } from '../shared/types';
import { WorkerList } from '../webview/components/fleet/worker-list';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let mounted: Root | undefined;
let container: HTMLElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.unmount());
    mounted = undefined;
  }
  container?.remove();
  container = undefined;
});

async function render(
  snapshot: FleetSnapshot,
  options: {
    selectedTarget?: string | null;
    onSelectTarget?: (targetId: string) => void;
    statusFilter?: FleetStatusFilter;
    beadsById?: ReadonlyMap<string, Bead>;
  } = {},
): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () =>
    mounted?.render(
      createElement(WorkerList, {
        snapshot,
        selectedTarget: options.selectedTarget ?? null,
        onSelectTarget: options.onSelectTarget ?? (() => {}),
        statusFilter: options.statusFilter,
        beadsById: options.beadsById ?? new Map(),
      }),
    ),
  );
  return container;
}

function worker(overrides: Partial<FleetWorker> = {}): FleetWorker {
  return {
    agentId: 'agent-a',
    sessionId: 'session-1',
    beadId: null,
    worktreePath: null,
    briefSummary: '',
    lastActivityAt: null,
    status: 'unknown',
    ...overrides,
  };
}

function worktree(overrides: Partial<FleetWorktree> = {}): FleetWorktree {
  return {
    path: '/repo/wt-x',
    dirName: 'wt-x',
    beadId: null,
    git: {
      branch: 'work/x',
      changedFiles: 0,
      insertions: 0,
      deletions: 0,
      measuredAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function snapshot(overrides: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return {
    orchestrators: [],
    workers: [],
    worktrees: [],
    orphanWorktrees: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('WorkerList degraded state', () => {
  it('renders a friendly hint for a missing ~/.claude/projects directory', async () => {
    const el = await render(snapshot({ degraded: { reason: 'no-claude-dir' }, providerDegraded: { claude: 'no-claude-dir', codex: 'no-codex-dir' } }));
    expect(el.textContent).toContain('No agent session data');
    expect(el.textContent).toContain('No Claude Code or Codex session directory');
  });

  it('shows an ordinary empty state when Codex sessions exist but Claude does not', async () => {
    const el = await render(snapshot({ degraded: { reason: 'no-claude-dir' }, providerDegraded: { claude: 'no-claude-dir' } }));
    expect(el.textContent).toContain('No fleet activity');
    expect(el.textContent).not.toContain('No agent session data');
  });
});

describe('WorkerList empty state', () => {
  it('renders an empty state when there is no fleet activity at all', async () => {
    const el = await render(snapshot());
    expect(el.textContent).toContain('No fleet activity');
  });
});

describe('WorkerList orchestrators and workers', () => {
  it('labels Codex rows and selects their transcript targets', async () => {
    const onSelectTarget = vi.fn();
    const el = await render(snapshot({
      orchestrators: [{ provider: 'codex', sessionId: 'codex-session', workerIds: ['codex-child'], lastActivityAt: null }],
      workers: [worker({ provider: 'codex', agentId: 'codex-child', sessionId: 'codex-session', status: 'running' })],
    }), { onSelectTarget });
    const header = el.querySelector('header[role="button"]') as HTMLElement;
    const row = el.querySelector('li[role="button"]') as HTMLElement;
    expect(header.getAttribute('aria-label')).toContain('Codex orchestrator session');
    expect(row.getAttribute('aria-label')).toContain('Codex worker');
    expect(el.textContent).toContain('Running');
    await act(async () => header.click());
    await act(async () => row.click());
    expect(onSelectTarget).toHaveBeenNthCalledWith(1, 'session:codex-session');
    expect(onSelectTarget).toHaveBeenNthCalledWith(2, 'agent:codex-child');
  });

  it('renders an orchestrator with its worker count and each worker row', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-12345678', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [
          worker({
            agentId: 'agent-a',
            sessionId: 'session-12345678',
            beadId: 'proj-7pi',
            briefSummary: 'Implementing bead proj-7pi',
            status: 'running',
          }),
        ],
      }),
    );

    expect(el.textContent).toContain('1 worker');
    expect(el.textContent).toContain('Running');
    expect(el.textContent).toContain('proj-7pi');
    expect(el.textContent).toContain('Implementing bead proj-7pi');
  });

  it('pairs a worker with its matched worktree for the diffstat and dir name', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [
          worker({
            worktreePath: '/repo/wt-7pi',
            status: 'idle',
          }),
        ],
        worktrees: [
          worktree({
            path: '/repo/wt-7pi',
            dirName: 'wt-7pi',
            git: {
              branch: 'work/7pi',
              changedFiles: 3,
              insertions: 10,
              deletions: 2,
              measuredAt: new Date().toISOString(),
            },
          }),
        ],
      }),
    );

    expect(el.textContent).toContain('wt-7pi');
    expect(el.textContent).toContain('3 files');
    expect(el.textContent).toContain('+10');
    expect(el.textContent).toContain('-2');
  });

  it('only lists workers under their own orchestrator session', async () => {
    const el = await render(
      snapshot({
        orchestrators: [
          { sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null },
          { sessionId: 'session-2', workerIds: ['agent-b'], lastActivityAt: null },
        ],
        workers: [
          worker({ agentId: 'agent-a', sessionId: 'session-1', briefSummary: 'brief for a' }),
          worker({ agentId: 'agent-b', sessionId: 'session-2', briefSummary: 'brief for b' }),
        ],
      }),
    );

    const sections = el.querySelectorAll('section');
    // Two orchestrator sections; the third (stale) only appears with orphans.
    expect(sections).toHaveLength(2);
  });
});

describe('WorkerList lease badge (beads-ui-vscode-ext-ayq.1)', () => {
  function leasedBead(overrides: Partial<Bead> = {}): Bead {
    return {
      id: 'proj-7pi',
      title: 'Claimed work',
      status: 'in_progress',
      priority: 1,
      issue_type: 'task',
      ...overrides,
    };
  }

  it('shows a lease chip beside a worker whose bead carries a live lease', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1', beadId: 'proj-7pi' })],
      }),
      {
        beadsById: new Map([
          ['proj-7pi', leasedBead({ lease_expires_at: '2999-01-01T00:00:00.000Z' })],
        ]),
      },
    );

    expect(el.textContent).toContain('leased');
  });

  it('shows an expired chip when the matched bead lease is long dead', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1', beadId: 'proj-7pi' })],
      }),
      {
        beadsById: new Map([
          ['proj-7pi', leasedBead({ lease_expires_at: '2000-01-01T00:00:00.000Z' })],
        ]),
      },
    );

    expect(el.textContent).toContain('lease expired');
  });

  it('shows no chip when the matched bead has no lease fields — absence is none, not expired', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1', beadId: 'proj-7pi' })],
      }),
      { beadsById: new Map([['proj-7pi', leasedBead()]]) },
    );

    expect(el.textContent).not.toContain('leased');
    expect(el.textContent).not.toContain('lease expired');
  });

  it('renders the row unharmed when the worker bead id matches nothing in the map', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1', beadId: 'proj-unknown' })],
      }),
      { beadsById: new Map() },
    );

    expect(el.querySelectorAll('li[role="button"]')).toHaveLength(1);
    expect(el.textContent).not.toContain('leased');
  });
});

describe('WorkerList lease badge unique-suffix lookup (beads-ui-vscode-ext-ayq.5)', () => {
  function leasedBead(overrides: Partial<Bead> = {}): Bead {
    return {
      id: 'proj-7pi',
      title: 'Claimed work',
      status: 'in_progress',
      priority: 1,
      issue_type: 'task',
      ...overrides,
    };
  }

  it('shows a lease chip when the worker names the exact full bead id', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [
          worker({ agentId: 'agent-a', sessionId: 'session-1', beadId: 'beads-ui-vscode-ext-19r.1' }),
        ],
      }),
      {
        beadsById: new Map([
          [
            'beads-ui-vscode-ext-19r.1',
            leasedBead({ id: 'beads-ui-vscode-ext-19r.1', lease_expires_at: '2999-01-01T00:00:00.000Z' }),
          ],
        ]),
      },
    );

    expect(el.textContent).toContain('leased');
  });

  it('shows a lease chip when the worker names a short id that matches exactly one bead', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1', beadId: '19r.1' })],
      }),
      {
        beadsById: new Map([
          [
            'beads-ui-vscode-ext-19r.1',
            leasedBead({ id: 'beads-ui-vscode-ext-19r.1', lease_expires_at: '2999-01-01T00:00:00.000Z' }),
          ],
        ]),
      },
    );

    expect(el.textContent).toContain('leased');
  });

  it('shows no chip when the short id suffix-matches two beads with different prefixes', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1', beadId: '19r.1' })],
      }),
      {
        beadsById: new Map([
          [
            'proj-a-19r.1',
            leasedBead({ id: 'proj-a-19r.1', lease_expires_at: '2999-01-01T00:00:00.000Z' }),
          ],
          [
            'proj-b-19r.1',
            leasedBead({ id: 'proj-b-19r.1', lease_expires_at: '2999-01-01T00:00:00.000Z' }),
          ],
        ]),
      },
    );

    expect(el.textContent).not.toContain('leased');
  });

  it('shows no chip when the short id matches no bead at all', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1', beadId: '19r.1' })],
      }),
      {
        beadsById: new Map([
          [
            'beads-ui-vscode-ext-7pi',
            leasedBead({ id: 'beads-ui-vscode-ext-7pi', lease_expires_at: '2999-01-01T00:00:00.000Z' }),
          ],
        ]),
      },
    );

    expect(el.textContent).not.toContain('leased');
  });
});

describe('WorkerList unassociated worktrees', () => {
  it('renders an unassociated worktree without claiming its worker is inactive', async () => {
    const el = await render(
      snapshot({
        worktrees: [worktree({ path: '/repo/wt-stale', dirName: 'wt-stale', beadId: 'proj-stale' })],
        orphanWorktrees: ['/repo/wt-stale'],
      }),
    );

    expect(el.textContent).toContain('Unassociated worktrees');
    expect(el.textContent).toContain('worker link unknown');
    expect(el.textContent).not.toContain('no active worker');
    expect(el.textContent).toContain('wt-stale');
    expect(el.textContent).toContain('proj-stale');
  });

  it('omits the stale section entirely when there are no orphans', async () => {
    const el = await render(
      snapshot({
        worktrees: [worktree({ path: '/repo/wt-active' })],
        orphanWorktrees: [],
      }),
    );

    expect(el.textContent).not.toContain('Unassociated worktrees');
  });
});

describe('WorkerList selection (beads-ui-vscode-ext-37b)', () => {
  it('calls onSelectTarget with agent:<id> when a worker row is clicked', async () => {
    const onSelectTarget = vi.fn();
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1' })],
      }),
      { onSelectTarget },
    );

    const row = el.querySelector('li[role="button"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSelectTarget).toHaveBeenCalledWith('agent:agent-a');
  });

  it('calls onSelectTarget with session:<id> when an orchestrator header is clicked', async () => {
    const onSelectTarget = vi.fn();
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: [], lastActivityAt: null }],
      }),
      { onSelectTarget },
    );

    const header = el.querySelector('header[role="button"]') as HTMLElement;
    expect(header).not.toBeNull();
    await act(async () => header.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSelectTarget).toHaveBeenCalledWith('session:session-1');
  });

  it('activates a worker row on Enter and on Space, same as a bead card', async () => {
    const onSelectTarget = vi.fn();
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1' })],
      }),
      { onSelectTarget },
    );

    const row = el.querySelector('li[role="button"]') as HTMLElement;
    await act(async () => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await act(async () => row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));

    expect(onSelectTarget).toHaveBeenCalledTimes(2);
    expect(onSelectTarget).toHaveBeenCalledWith('agent:agent-a');
  });

  it('marks only the selected worker row with aria-current', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a', 'agent-b'], lastActivityAt: null }],
        workers: [
          worker({ agentId: 'agent-a', sessionId: 'session-1' }),
          worker({ agentId: 'agent-b', sessionId: 'session-1' }),
        ],
      }),
      { selectedTarget: 'agent:agent-b' },
    );

    const rows = Array.from(el.querySelectorAll('li[role="button"]'));
    expect(rows).toHaveLength(2);
    const current = rows.filter((row) => row.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('aria-label')).toContain('agent-b');
  });

  it('marks the orchestrator header current when its session is selected', async () => {
    const el = await render(
      snapshot({ orchestrators: [{ sessionId: 'session-1', workerIds: [], lastActivityAt: null }] }),
      { selectedTarget: 'session:session-1' },
    );

    const header = el.querySelector('header[role="button"]');
    expect(header?.getAttribute('aria-current')).toBe('true');
  });

  it('leaves aria-current unset on every row when nothing is selected', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a'], lastActivityAt: null }],
        workers: [worker({ agentId: 'agent-a', sessionId: 'session-1' })],
      }),
    );

    expect(el.querySelectorAll('[aria-current]')).toHaveLength(0);
  });
});

describe('WorkerList recency order (beads-ui-vscode-ext-w9a.6)', () => {
  it('lists workers under an orchestrator most-recently-active first', async () => {
    const el = await render(
      snapshot({
        orchestrators: [
          { sessionId: 'session-1', workerIds: ['agent-a', 'agent-b', 'agent-c'], lastActivityAt: null },
        ],
        workers: [
          // Deliberately out of order on input.
          worker({ agentId: 'agent-oldest', lastActivityAt: '2026-01-01T00:00:00.000Z' }),
          worker({ agentId: 'agent-newest', lastActivityAt: '2026-03-01T00:00:00.000Z' }),
          worker({ agentId: 'agent-no-time', lastActivityAt: null }),
          worker({ agentId: 'agent-middle', lastActivityAt: '2026-02-01T00:00:00.000Z' }),
        ],
      }),
    );

    const rows = Array.from(el.querySelectorAll('li[role="button"]'));
    const order = rows.map((row) => row.getAttribute('aria-label'));
    expect(order[0]).toContain('agent-newest');
    expect(order[1]).toContain('agent-middle');
    expect(order[2]).toContain('agent-oldest');
    expect(order[3]).toContain('agent-no-time');
  });

  it('lists orchestrator sections most-recently-active first', async () => {
    const el = await render(
      snapshot({
        orchestrators: [
          { sessionId: 'oldest-session', workerIds: [], lastActivityAt: '2026-01-01T00:00:00.000Z' },
          { sessionId: 'newest-session', workerIds: [], lastActivityAt: '2026-03-01T00:00:00.000Z' },
        ],
      }),
    );

    const headers = Array.from(el.querySelectorAll('header[role="button"]'));
    expect(headers[0]?.getAttribute('aria-label')).toContain('newest-session');
    expect(headers[1]?.getAttribute('aria-label')).toContain('oldest-session');
  });
});

describe('WorkerList status filter (beads-ui-vscode-ext-w9a.6)', () => {
  it('shows every worker when the filter is "all" (the default)', async () => {
    const el = await render(
      snapshot({
        orchestrators: [{ sessionId: 'session-1', workerIds: ['agent-a', 'agent-b'], lastActivityAt: null }],
        workers: [
          worker({ agentId: 'agent-a', status: 'running' }),
          worker({ agentId: 'agent-b', status: 'idle' }),
        ],
      }),
    );

    expect(el.querySelectorAll('li[role="button"]')).toHaveLength(2);
  });

  it('narrows to only running workers under the "running" filter', async () => {
    const el = await render(
      snapshot({
        orchestrators: [
          { sessionId: 'session-1', workerIds: ['agent-a', 'agent-b', 'agent-c'], lastActivityAt: null },
        ],
        workers: [
          worker({ agentId: 'agent-running', status: 'running' }),
          worker({ agentId: 'agent-idle', status: 'idle' }),
          worker({ agentId: 'agent-unknown', status: 'unknown' }),
        ],
      }),
      { statusFilter: 'running' },
    );

    const rows = Array.from(el.querySelectorAll('li[role="button"]'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('aria-label')).toContain('agent-running');
  });

  it('never reads the header count as 0 when the orchestrator has real workers, even when every one is filtered out (beads-ui-vscode-ext-w9a.9)', async () => {
    const el = await render(
      snapshot({
        orchestrators: [
          { sessionId: 'session-1', workerIds: ['agent-a', 'agent-b', 'agent-c'], lastActivityAt: null },
        ],
        workers: [
          worker({ agentId: 'agent-a', sessionId: 'session-1', status: 'idle' }),
          worker({ agentId: 'agent-b', sessionId: 'session-1', status: 'idle' }),
          worker({ agentId: 'agent-c', sessionId: 'session-1', status: 'idle' }),
        ],
      }),
      { statusFilter: 'running' },
    );

    // The row list is correctly empty under the "running" filter...
    expect(el.querySelectorAll('li[role="button"]')).toHaveLength(0);
    // ...but the header must still report the true total, never 0 or "no data".
    expect(el.textContent).toContain('0 of 3 workers');
    expect(el.textContent).not.toContain('0 workers');
  });

  it('narrows to idle and unknown workers under the "idle" filter', async () => {
    const el = await render(
      snapshot({
        orchestrators: [
          { sessionId: 'session-1', workerIds: ['agent-a', 'agent-b', 'agent-c'], lastActivityAt: null },
        ],
        workers: [
          worker({ agentId: 'agent-running', status: 'running' }),
          worker({ agentId: 'agent-idle', status: 'idle' }),
          worker({ agentId: 'agent-unknown', status: 'unknown' }),
        ],
      }),
      { statusFilter: 'idle' },
    );

    const rows = Array.from(el.querySelectorAll('li[role="button"]'));
    const labels = rows.map((row) => row.getAttribute('aria-label'));
    expect(rows).toHaveLength(2);
    expect(labels.some((label) => label?.includes('agent-idle'))).toBe(true);
    expect(labels.some((label) => label?.includes('agent-unknown'))).toBe(true);
  });
});
