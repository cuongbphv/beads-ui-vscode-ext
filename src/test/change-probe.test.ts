import { describe, expect, it } from 'vitest';

import { ChangeProbeStrategy, EVENTS_PAGE_SIZE } from '../extension/bd/change-probe';
import type { BdQueries, EventsTailPage } from '../extension/bd/queries';

/**
 * A stand-in for `BdQueries` that records every call and replays canned
 * answers — mirrors the `FakeBd` pattern in `src/test/queries.test.ts`.
 */
class FakeQueries {
  readonly eventsTailCalls: Array<{ sinceSeq: number; limit: number }> = [];
  watermarkCalls = 0;

  /** `undefined` (the default) reproduces bd 1.2.2: `events` does not exist. */
  eventsTailImpl: ((sinceSeq: number, limit: number) => Promise<EventsTailPage>) | undefined;

  watermarkQueue: Array<string | Error> = [];

  async watermark(): Promise<string> {
    this.watermarkCalls += 1;
    const next = this.watermarkQueue.shift() ?? '';
    if (next instanceof Error) throw next;
    return next;
  }

  async eventsTail(sinceSeq: number, limit: number): Promise<EventsTailPage> {
    this.eventsTailCalls.push({ sinceSeq, limit });
    if (!this.eventsTailImpl) {
      throw Object.assign(new Error('bd failed'), {
        rpcError: { kind: 'bd-error', message: 'unknown command "events" for "bd"' },
      });
    }
    return this.eventsTailImpl(sinceSeq, limit);
  }
}

function strategy(fake: FakeQueries, resyncAfterTicks = 12): ChangeProbeStrategy {
  return new ChangeProbeStrategy(fake as unknown as BdQueries, resyncAfterTicks);
}

describe('ChangeProbeStrategy — dormant path (bd 1.2.2, no events command)', () => {
  it('probes events exactly once, then locks onto watermark for the rest of the session', async () => {
    const fake = new FakeQueries();
    fake.watermarkQueue = ['a@t1', 'a@t1', 'a@t1', 'a@t1'];
    const s = strategy(fake, 100); // resync far away so it never interferes here

    await s.shouldRefresh(); // triggers detect() -> events probe fails -> watermark
    await s.shouldRefresh();
    await s.shouldRefresh();

    expect(fake.eventsTailCalls).toHaveLength(1);
    expect(fake.eventsTailCalls[0]).toEqual({ sinceSeq: 0, limit: 1 });
    expect(fake.watermarkCalls).toBe(3);
  });

  it('is byte-identical to the plain watermark probe once locked: adopts the first fingerprint silently', async () => {
    const fake = new FakeQueries();
    fake.watermarkQueue = ['harbor-1@2026-08-04T09:00:00Z'];
    const s = strategy(fake, 100);

    expect(await s.shouldRefresh()).toBe(false);
  });

  it('reports a moved fingerprint as somebody else’s change, same as PollGate alone', async () => {
    const fake = new FakeQueries();
    fake.watermarkQueue = ['harbor-1@2026-08-04T09:00:00Z', 'harbor-2@2026-08-04T09:00:05Z'];
    const s = strategy(fake, 100);

    expect(await s.shouldRefresh()).toBe(false);
    expect(await s.shouldRefresh()).toBe(true);
  });

  it('does not re-adopt the fingerprint left behind by its own resync-triggered refresh, once reset() runs', async () => {
    const fake = new FakeQueries();
    fake.watermarkQueue = ['harbor-1@2026-08-04T09:00:00Z'];
    const s = strategy(fake, 100);

    await s.shouldRefresh();
    s.reset();
    fake.watermarkQueue = ['harbor-1@2026-08-04T09:00:00Z'];
    expect(await s.shouldRefresh()).toBe(false);
  });

  it('propagates a watermark failure so store.tick() keeps logging it, rather than swallowing it', async () => {
    const fake = new FakeQueries();
    fake.watermarkQueue = [new Error('bd list failed')];
    const s = strategy(fake, 100);

    await expect(s.shouldRefresh()).rejects.toThrow('bd list failed');
  });
});

describe('ChangeProbeStrategy — 12-tick full-resync backstop', () => {
  it('forces a refresh after the configured number of quiet ticks, without ever probing', async () => {
    const fake = new FakeQueries();
    const s = strategy(fake, 3);

    expect(await s.shouldRefresh()).toBe(false); // tick 1: detect() -> falls back to watermark
    expect(await s.shouldRefresh()).toBe(false); // tick 2: already locked, straight to watermark
    expect(await s.shouldRefresh()).toBe(true); // tick 3: backstop fires, pre-empting the probe

    // Tick 1's detect() call is the only events probe ever made; tick 3's
    // backstop pre-empts the probe entirely — no bd call that cycle.
    expect(fake.eventsTailCalls).toHaveLength(1);
    expect(fake.watermarkCalls).toBe(2);
  });

  it('restarts the tick count after reset() (i.e. after a refresh lands)', async () => {
    const fake = new FakeQueries();
    const s = strategy(fake, 3);

    await s.shouldRefresh();
    await s.shouldRefresh();
    s.reset();

    expect(await s.shouldRefresh()).toBe(false);
    expect(await s.shouldRefresh()).toBe(false);
    expect(await s.shouldRefresh()).toBe(true);
  });

  it('still applies the same backstop once the fast path is active', async () => {
    const fake = new FakeQueries();
    fake.eventsTailImpl = async (sinceSeq) => ({ events: [], latestSeq: sinceSeq });
    const s = strategy(fake, 2);

    expect(await s.shouldRefresh()).toBe(false); // tick 1: detect() + first probe, no events
    expect(await s.shouldRefresh()).toBe(true); // tick 2: backstop fires, pre-empting the probe

    expect(fake.eventsTailCalls).toHaveLength(1); // only the detect() call — backstop pre-empted tick 2
  });
});

describe('ChangeProbeStrategy — hypothetical events-capable bd (never fires against 1.2.2 today)', () => {
  it('adopts the fast path when the detection probe succeeds, and advances seq with each page', async () => {
    const fake = new FakeQueries();
    const pages: Record<number, EventsTailPage> = {
      0: { events: [{ seq: 1 }], latestSeq: 7 },
      7: { events: [], latestSeq: 7 },
      // seq advances again on the next real event
    };
    fake.eventsTailImpl = async (sinceSeq) => pages[sinceSeq] ?? { events: [], latestSeq: sinceSeq };
    const s = strategy(fake, 100);

    // Detection probe: since=0, limit=1 — exactly `bd events tail --since 0 --limit 1`.
    expect(await s.shouldRefresh()).toBe(true); // detect() page had an event -> refresh
    expect(fake.eventsTailCalls[0]).toEqual({ sinceSeq: 0, limit: 1 });

    // Second probe reuses the seq the first page advanced to, at the page-size limit.
    expect(await s.shouldRefresh()).toBe(false);
    expect(fake.eventsTailCalls[1]).toEqual({ sinceSeq: 7, limit: EVENTS_PAGE_SIZE });

    // No watermark fallback while the fast path stays healthy.
    expect(fake.watermarkCalls).toBe(0);
  });

  it('reports a change the moment a page carries any event', async () => {
    const fake = new FakeQueries();
    let call = 0;
    fake.eventsTailImpl = async () => {
      call += 1;
      return call === 1 ? { events: [], latestSeq: 0 } : { events: [{ seq: 5 }], latestSeq: 5 };
    };
    const s = strategy(fake, 100);

    expect(await s.shouldRefresh()).toBe(false); // detect(): no events yet
    expect(await s.shouldRefresh()).toBe(true); // next page carries one
  });

  it('falls back to watermark permanently if the journal fails mid-session (409 / disabled)', async () => {
    const fake = new FakeQueries();
    let call = 0;
    fake.eventsTailImpl = async () => {
      call += 1;
      if (call === 1) return { events: [], latestSeq: 0 };
      throw Object.assign(new Error('journal disabled'), {
        rpcError: { kind: 'bd-error', message: 'journal disabled' },
      });
    };
    fake.watermarkQueue = ['a@t1', 'a@t1'];
    const s = strategy(fake, 100);

    expect(await s.shouldRefresh()).toBe(false); // detect() succeeds, events mode active
    expect(await s.shouldRefresh()).toBe(false); // events call throws -> falls back to watermark this tick
    expect(await s.shouldRefresh()).toBe(false); // now permanently on watermark

    expect(fake.eventsTailCalls).toHaveLength(2); // never retried after the failure
    expect(fake.watermarkCalls).toBe(2);
  });
});
