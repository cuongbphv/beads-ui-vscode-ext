import { describe, expect, it } from 'vitest';

import type { FleetWorker } from '../shared/fleet';
import { filterWorkersByStatus, matchesStatusFilter } from '../shared/fleet-filter';

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

describe('matchesStatusFilter', () => {
  it('admits every status under "all"', () => {
    expect(matchesStatusFilter('running', 'all')).toBe(true);
    expect(matchesStatusFilter('idle', 'all')).toBe(true);
    expect(matchesStatusFilter('unknown', 'all')).toBe(true);
  });

  it('admits only running workers under "running"', () => {
    expect(matchesStatusFilter('running', 'running')).toBe(true);
    expect(matchesStatusFilter('idle', 'running')).toBe(false);
    expect(matchesStatusFilter('unknown', 'running')).toBe(false);
  });

  it('treats "idle" as "not running": both idle and unknown match', () => {
    expect(matchesStatusFilter('idle', 'idle')).toBe(true);
    expect(matchesStatusFilter('unknown', 'idle')).toBe(true);
    expect(matchesStatusFilter('running', 'idle')).toBe(false);
  });
});

describe('filterWorkersByStatus', () => {
  it('narrows the list to running workers only', () => {
    const running = worker({ agentId: 'running-1', status: 'running' });
    const idle = worker({ agentId: 'idle-1', status: 'idle' });
    const unknown = worker({ agentId: 'unknown-1', status: 'unknown' });

    expect(filterWorkersByStatus([running, idle, unknown], 'running').map((w) => w.agentId)).toEqual([
      'running-1',
    ]);
  });

  it('narrows the list to idle + unknown workers under "idle"', () => {
    const running = worker({ agentId: 'running-1', status: 'running' });
    const idle = worker({ agentId: 'idle-1', status: 'idle' });
    const unknown = worker({ agentId: 'unknown-1', status: 'unknown' });

    expect(filterWorkersByStatus([running, idle, unknown], 'idle').map((w) => w.agentId)).toEqual([
      'idle-1',
      'unknown-1',
    ]);
  });

  it('returns every worker unchanged under "all"', () => {
    const workers = [worker({ agentId: 'a', status: 'running' }), worker({ agentId: 'b', status: 'idle' })];

    expect(filterWorkersByStatus(workers, 'all')).toEqual(workers);
  });

  it('preserves relative order rather than grouping by status', () => {
    const workers = [
      worker({ agentId: 'a', status: 'idle' }),
      worker({ agentId: 'b', status: 'running' }),
      worker({ agentId: 'c', status: 'unknown' }),
    ];

    expect(filterWorkersByStatus(workers, 'idle').map((w) => w.agentId)).toEqual(['a', 'c']);
  });
});
