/**
 * `leaseState`: the pure claim-liveness classifier (beads-ui-vscode-ext-ayq.1).
 *
 * Every test injects a fixed `nowMs` — the classifier owns no clock — and the
 * cases cover all four states plus the boundaries between them. The invariant
 * the whole feature hangs on: an issue with NO lease fields (every issue bd
 * emitted on this machine at build time) classifies as `none`, never throws,
 * and never masquerades as an expired lease.
 */
import { describe, expect, it } from 'vitest';

import { HEARTBEAT_FRESH_MS, formatDurationMs, leaseState } from '../shared/lease';

/** A fixed "now" so nothing in here depends on the wall clock. */
const NOW = Date.parse('2026-08-24T12:00:00.000Z');

function atOffset(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

describe('leaseState: none', () => {
  it('classifies an issue with no lease fields at all as none', () => {
    expect(leaseState({}, NOW)).toEqual({ state: 'none' });
  });

  it('treats undefined lease fields as none, never as epoch-zero timestamps', () => {
    const info = leaseState(
      { lease_expires_at: undefined, heartbeat_at: undefined, lease_granted_node: undefined },
      NOW,
    );
    expect(info.state).toBe('none');
    expect(info.expiresInMs).toBeUndefined();
    expect(info.heartbeatAgeMs).toBeUndefined();
  });

  it('classifies a bare lease_granted_node without any timestamp as none — liveness is unmeasurable', () => {
    expect(leaseState({ lease_granted_node: 'node-a' }, NOW).state).toBe('none');
  });

  it('treats an unparseable timestamp as absent rather than throwing or misclassifying', () => {
    expect(leaseState({ lease_expires_at: 'not-a-date' }, NOW).state).toBe('none');
    expect(
      leaseState({ lease_expires_at: 'not-a-date', heartbeat_at: atOffset(-1_000) }, NOW).state,
    ).toBe('live');
  });
});

describe('leaseState: live', () => {
  it('classifies an unexpired lease with a fresh heartbeat as live', () => {
    const info = leaseState(
      {
        lease_expires_at: atOffset(4 * 60_000),
        heartbeat_at: atOffset(-30_000),
        lease_granted_node: 'node-a',
        assignee: 'agent-7',
      },
      NOW,
    );
    expect(info.state).toBe('live');
    expect(info.holder).toBe('agent-7');
    expect(info.node).toBe('node-a');
    expect(info.expiresInMs).toBe(4 * 60_000);
    expect(info.heartbeatAgeMs).toBe(30_000);
  });

  it('is live with only an unexpired lease_expires_at (no heartbeat reported)', () => {
    expect(leaseState({ lease_expires_at: atOffset(60_000) }, NOW).state).toBe('live');
  });

  it('is live with only a fresh heartbeat (no expiry reported)', () => {
    expect(leaseState({ heartbeat_at: atOffset(-1_000) }, NOW).state).toBe('live');
  });

  it('is not yet expired at the exact expiry instant — "in the past" is strict', () => {
    expect(leaseState({ lease_expires_at: atOffset(0) }, NOW).state).toBe('live');
  });

  it('is not yet stale at exactly HEARTBEAT_FRESH_MS of heartbeat age — "older than" is strict', () => {
    expect(leaseState({ heartbeat_at: atOffset(-HEARTBEAT_FRESH_MS) }, NOW).state).toBe('live');
  });
});

describe('leaseState: stale-heartbeat', () => {
  it('classifies a heartbeat older than HEARTBEAT_FRESH_MS as stale while the lease is unexpired', () => {
    const info = leaseState(
      { lease_expires_at: atOffset(60_000), heartbeat_at: atOffset(-HEARTBEAT_FRESH_MS - 1) },
      NOW,
    );
    expect(info.state).toBe('stale-heartbeat');
    expect(info.heartbeatAgeMs).toBe(HEARTBEAT_FRESH_MS + 1);
  });

  it('is stale on heartbeat age alone when no expiry was reported', () => {
    expect(leaseState({ heartbeat_at: atOffset(-2 * HEARTBEAT_FRESH_MS) }, NOW).state).toBe(
      'stale-heartbeat',
    );
  });
});

describe('leaseState: expired', () => {
  it('classifies a lease_expires_at in the past as expired', () => {
    const info = leaseState({ lease_expires_at: atOffset(-1) }, NOW);
    expect(info.state).toBe('expired');
    expect(info.expiresInMs).toBe(-1);
  });

  it('expired wins over a stale heartbeat — the stronger fact', () => {
    expect(
      leaseState(
        { lease_expires_at: atOffset(-60_000), heartbeat_at: atOffset(-HEARTBEAT_FRESH_MS - 1) },
        NOW,
      ).state,
    ).toBe('expired');
  });

  it('expired wins even while the heartbeat still looks fresh (a heartbeat cannot revive a dead lease)', () => {
    expect(
      leaseState({ lease_expires_at: atOffset(-60_000), heartbeat_at: atOffset(-1_000) }, NOW).state,
    ).toBe('expired');
  });
});

describe('HEARTBEAT_FRESH_MS', () => {
  it('mirrors bd DefaultLeaseTTL (5 minutes) — a heartbeat older than one full lease window is stale', () => {
    expect(HEARTBEAT_FRESH_MS).toBe(5 * 60_000);
  });
});

describe('formatDurationMs', () => {
  it('formats sub-minute durations in seconds', () => {
    expect(formatDurationMs(45_000)).toBe('45s');
  });

  it('formats sub-hour durations in whole minutes', () => {
    expect(formatDurationMs(4 * 60_000 + 30_000)).toBe('4m');
  });

  it('formats hours with a minute remainder', () => {
    expect(formatDurationMs(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m');
  });

  it('formats a magnitude, never a sign — callers phrase past vs future', () => {
    expect(formatDurationMs(-45_000)).toBe('45s');
  });
});
