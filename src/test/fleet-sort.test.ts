import { describe, expect, it } from 'vitest';

import type { FleetOrchestrator, FleetWorker } from '../shared/fleet';
import { sortByRecency } from '../shared/fleet-sort';

function orchestrator(overrides: Partial<FleetOrchestrator> = {}): FleetOrchestrator {
  return { sessionId: 'session-1', workerIds: [], lastActivityAt: null, ...overrides };
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

describe('sortByRecency', () => {
  it('orders items by lastActivityAt descending, most recent first', () => {
    const oldest = worker({ agentId: 'oldest', lastActivityAt: '2026-01-01T00:00:00.000Z' });
    const newest = worker({ agentId: 'newest', lastActivityAt: '2026-03-01T00:00:00.000Z' });
    const middle = worker({ agentId: 'middle', lastActivityAt: '2026-02-01T00:00:00.000Z' });

    // Deliberately out of order on input, so a no-op sort would fail this.
    const out = sortByRecency([oldest, newest, middle]);

    expect(out.map((w) => w.agentId)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('sorts missing lastActivityAt after every timestamped item', () => {
    const withTime = worker({ agentId: 'has-time', lastActivityAt: '2026-01-01T00:00:00.000Z' });
    const noTime = worker({ agentId: 'no-time', lastActivityAt: null });

    expect(sortByRecency([noTime, withTime]).map((w) => w.agentId)).toEqual(['has-time', 'no-time']);
  });

  it('treats an unparseable timestamp the same as a missing one', () => {
    const withTime = worker({ agentId: 'has-time', lastActivityAt: '2026-01-01T00:00:00.000Z' });
    const garbage = worker({ agentId: 'garbage', lastActivityAt: 'not-a-date' });

    expect(sortByRecency([garbage, withTime]).map((w) => w.agentId)).toEqual(['has-time', 'garbage']);
  });

  it('does not mutate the input array', () => {
    const input = [worker({ agentId: 'a', lastActivityAt: '2026-01-01T00:00:00.000Z' }), worker({ agentId: 'b' })];
    const copy = [...input];

    sortByRecency(input);

    expect(input).toEqual(copy);
  });

  it('works the same for orchestrators, which share the lastActivityAt field', () => {
    const oldest = orchestrator({ sessionId: 'old', lastActivityAt: '2026-01-01T00:00:00.000Z' });
    const newest = orchestrator({ sessionId: 'new', lastActivityAt: '2026-05-01T00:00:00.000Z' });

    expect(sortByRecency([oldest, newest]).map((o) => o.sessionId)).toEqual(['new', 'old']);
  });

  it('is stable among items that all lack a timestamp', () => {
    const a = worker({ agentId: 'a', lastActivityAt: null });
    const b = worker({ agentId: 'b', lastActivityAt: null });
    const c = worker({ agentId: 'c', lastActivityAt: null });

    expect(sortByRecency([a, b, c]).map((w) => w.agentId)).toEqual(['a', 'b', 'c']);
  });
});
