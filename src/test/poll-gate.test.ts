import { describe, expect, it } from 'vitest';

import { PollGate, pollingEnabled } from '../extension/poll-gate';

describe('pollingEnabled', () => {
  it('polls only when someone is looking at a focused window', () => {
    expect(pollingEnabled(5, 1, true)).toBe(true);
  });

  it('stays off when the setting is 0, whatever else is true', () => {
    expect(pollingEnabled(0, 3, true)).toBe(false);
  });

  it('stays off while every Beads view is hidden', () => {
    expect(pollingEnabled(5, 0, true)).toBe(false);
  });

  it('stays off while the window is in the background', () => {
    expect(pollingEnabled(5, 2, false)).toBe(false);
  });

  it('treats a negative interval as disabled rather than as an error', () => {
    expect(pollingEnabled(-1, 1, true)).toBe(false);
  });
});

describe('PollGate fingerprints', () => {
  it('adopts the first fingerprint silently instead of reloading on startup', () => {
    const gate = new PollGate();
    expect(gate.changed('harbor-1@2026-08-04T09:00:00Z')).toBe(false);
  });

  it('reports a moved fingerprint as somebody else’s change', () => {
    const gate = new PollGate();
    gate.changed('harbor-1@2026-08-04T09:00:00Z');
    expect(gate.changed('harbor-2@2026-08-04T09:00:05Z')).toBe(true);
  });

  it('stays quiet while nothing moves', () => {
    const gate = new PollGate();
    gate.changed('harbor-1@2026-08-04T09:00:00Z');
    expect(gate.changed('harbor-1@2026-08-04T09:00:00Z')).toBe(false);
    expect(gate.changed('harbor-1@2026-08-04T09:00:00Z')).toBe(false);
  });

  it('separates two issues touched in the same second by id', () => {
    const gate = new PollGate();
    gate.changed('harbor-1@2026-08-04T09:00:00Z');
    expect(gate.changed('harbor-2@2026-08-04T09:00:00Z')).toBe(true);
  });

  it('does not re-trigger on the fingerprint its own refresh left behind', () => {
    const gate = new PollGate();
    gate.changed('harbor-1@2026-08-04T09:00:00Z');

    // Something changed → the store refreshed → reset().
    expect(gate.changed('harbor-2@2026-08-04T09:00:05Z')).toBe(true);
    gate.reset();

    // The very next probe sees the fingerprint of the data we just loaded. That
    // is not news, and treating it as news would refresh forever.
    expect(gate.changed('harbor-2@2026-08-04T09:00:05Z')).toBe(false);
    expect(gate.changed('harbor-2@2026-08-04T09:00:05Z')).toBe(false);
  });
});

describe('PollGate resync backstop', () => {
  it('forces a full reload after the configured number of quiet ticks', () => {
    const gate = new PollGate(3);
    expect(gate.dueForResync()).toBe(false);
    expect(gate.dueForResync()).toBe(false);
    expect(gate.dueForResync()).toBe(true);
  });

  it('restarts the count after a refresh', () => {
    const gate = new PollGate(3);
    gate.dueForResync();
    gate.dueForResync();
    gate.reset();

    expect(gate.dueForResync()).toBe(false);
    expect(gate.dueForResync()).toBe(false);
    expect(gate.dueForResync()).toBe(true);
  });

  it('defaults to a cadence that is minutes, not seconds, of quiet ticks', () => {
    const gate = new PollGate();
    let ticks = 0;
    while (!gate.dueForResync()) ticks += 1;
    expect(ticks).toBeGreaterThanOrEqual(10);
  });
});
