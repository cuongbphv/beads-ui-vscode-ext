// @vitest-environment jsdom

/**
 * `WorkerList`: orchestrators + their workers, the "stale worktrees" section,
 * and the degraded empty state — all a pure function of the `FleetSnapshot`
 * it is handed.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { FleetSnapshot, FleetWorker, FleetWorktree } from '../shared/fleet';
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

async function render(snapshot: FleetSnapshot): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(WorkerList, { snapshot })));
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
    const el = await render(snapshot({ degraded: { reason: 'no-claude-dir' } }));
    expect(el.textContent).toContain('No Claude Code session data');
    expect(el.textContent).toContain('~/.claude/projects');
  });
});

describe('WorkerList empty state', () => {
  it('renders an empty state when there is no fleet activity at all', async () => {
    const el = await render(snapshot());
    expect(el.textContent).toContain('No fleet activity');
  });
});

describe('WorkerList orchestrators and workers', () => {
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

describe('WorkerList stale worktrees', () => {
  it('renders an orphan worktree under "Stale worktrees" with its diffstat', async () => {
    const el = await render(
      snapshot({
        worktrees: [worktree({ path: '/repo/wt-stale', dirName: 'wt-stale', beadId: 'proj-stale' })],
        orphanWorktrees: ['/repo/wt-stale'],
      }),
    );

    expect(el.textContent).toContain('Stale worktrees');
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

    expect(el.textContent).not.toContain('Stale worktrees');
  });
});
