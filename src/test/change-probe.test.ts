import { describe, expect, it, vi } from 'vitest';
import { ChangeProbeStrategy, EVENTS_PAGE_SIZE } from '../extension/bd/change-probe';
import { BdError } from '../extension/bd/BdService';
import type { BdQueries } from '../extension/bd/queries';

function fixture(resync = 12) {
  const queries = {
    eventsHead: vi.fn(async () => 100),
    eventsTail: vi.fn(async (seq: number) => ({ events: [] as Array<{ seq: number }>, latestSeq: seq })),
    watermark: vi.fn(async () => 'a@1'),
  };
  const probe = new ChangeProbeStrategy(queries as unknown as BdQueries, resync);
  return { queries, probe };
}

describe('journal change probe', () => {
  it('baselines at the current head and requests a full snapshot instead of replaying history', async () => {
    const { queries, probe } = fixture();
    expect(await probe.shouldRefresh()).toBe(true);
    expect(queries.eventsTail).toHaveBeenCalledWith(100, 1);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
    expect(queries.eventsTail).toHaveBeenLastCalledWith(100, EVENTS_PAGE_SIZE);
    expect(queries.watermark).not.toHaveBeenCalled();
  });

  it('reports outside changes and advances the checkpoint across reset', async () => {
    const { queries, probe } = fixture();
    await probe.shouldRefresh();
    probe.reset();
    queries.eventsTail.mockResolvedValueOnce({ events: [{ seq: 101 }, { seq: 102 }], latestSeq: 102 });
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
    expect(queries.eventsTail).toHaveBeenLastCalledWith(102, EVENTS_PAGE_SIZE);
  });

  it('keeps an event arriving during detection visible in the baseline snapshot', async () => {
    const { queries, probe } = fixture();
    queries.eventsTail.mockResolvedValueOnce({ events: [{ seq: 101 }], latestSeq: 101 });
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    await probe.shouldRefresh();
    expect(queries.eventsTail).toHaveBeenLastCalledWith(101, EVENTS_PAGE_SIZE);
  });

  it.each(['journal disabled', 'unknown command', 'page budget exceeded'])('uses watermark when %s', async (reason) => {
    const { queries, probe } = fixture();
    queries.eventsHead.mockRejectedValueOnce(new Error(reason));
    expect(await probe.shouldRefresh()).toBe(false);
    queries.watermark.mockResolvedValue('b@2');
    expect(await probe.shouldRefresh()).toBe(true);
    expect(queries.eventsHead).toHaveBeenCalledTimes(1);
    expect(queries.eventsTail).not.toHaveBeenCalled();
  });

  it('requires tail support even when a head query succeeds', async () => {
    const { queries, probe } = fixture();
    queries.eventsTail.mockRejectedValueOnce(new Error('unknown command'));
    expect(await probe.shouldRefresh()).toBe(false);
    expect(queries.watermark).toHaveBeenCalledTimes(1);
  });

  it('refreshes immediately when a journal is disabled or fails mid-session', async () => {
    const { queries, probe } = fixture();
    await probe.shouldRefresh();
    probe.reset();
    queries.eventsTail.mockRejectedValueOnce(new Error('disabled'));
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
    expect(queries.watermark).toHaveBeenCalledTimes(1);
    expect(queries.eventsTail).toHaveBeenCalledTimes(2);
  });

  it('re-baselines and refreshes when retention invalidates the cursor', async () => {
    const { queries, probe } = fixture();
    await probe.shouldRefresh();
    probe.reset();
    queries.eventsTail.mockRejectedValueOnce(new BdError({ kind: 'bd-error', code: 'events_journal_truncated', message: 'pruned' }));
    queries.eventsHead.mockResolvedValueOnce(200);
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
    expect(queries.eventsTail).toHaveBeenLastCalledWith(200, EVENTS_PAGE_SIZE);
  });

  it('falls back safely when truncation recovery also fails', async () => {
    const { queries, probe } = fixture();
    await probe.shouldRefresh();
    queries.eventsTail.mockRejectedValueOnce(new BdError({ kind: 'bd-error', code: 'events_journal_truncated', message: 'pruned' }));
    queries.eventsHead.mockRejectedValueOnce(new Error('offline'));
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    await probe.shouldRefresh();
    expect(queries.watermark).toHaveBeenCalledTimes(1);
  });

  it('preserves the 12-tick backstop and re-baselines a recreated journal', async () => {
    const { queries, probe } = fixture();
    await probe.shouldRefresh();
    probe.reset();
    for (let tick = 0; tick < 11; tick++) expect(await probe.shouldRefresh()).toBe(false);
    queries.eventsHead.mockResolvedValueOnce(0);
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    await probe.shouldRefresh();
    expect(queries.eventsTail).toHaveBeenLastCalledWith(0, EVENTS_PAGE_SIZE);
  });

  it('preserves the backstop when watermark is active', async () => {
    const { queries, probe } = fixture(3);
    queries.eventsHead.mockRejectedValueOnce(new Error('old CLI'));
    expect(await probe.shouldRefresh()).toBe(false);
    expect(await probe.shouldRefresh()).toBe(false);
    expect(await probe.shouldRefresh()).toBe(true);
    expect(queries.watermark).toHaveBeenCalledTimes(2);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
  });

  it('detects a distinct watermark immediately and rescues a same-second collision at tick 12', async () => {
    const { queries, probe } = fixture();
    queries.eventsHead.mockRejectedValueOnce(new Error('journal disabled'));
    expect(await probe.shouldRefresh()).toBe(false); // adopt a@1
    queries.watermark.mockResolvedValue('b@1');
    expect(await probe.shouldRefresh()).toBe(true); // distinct issue ID, same second
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false); // adopt b@1
    for (let tick = 2; tick < 12; tick++) expect(await probe.shouldRefresh()).toBe(false);
    expect(await probe.shouldRefresh()).toBe(true); // same b@1, forced resync
  });

  it('propagates watermark errors to the store', async () => {
    const { queries, probe } = fixture();
    queries.eventsHead.mockRejectedValueOnce(new Error('disabled'));
    queries.watermark.mockRejectedValueOnce(new Error('list failed'));
    await expect(probe.shouldRefresh()).rejects.toThrow('list failed');
  });

  it('redetects after changing the CLI executable', async () => {
    const { queries, probe } = fixture();
    queries.eventsHead.mockRejectedValueOnce(new Error('old CLI'));
    await probe.shouldRefresh();
    probe.restart();
    expect(await probe.shouldRefresh()).toBe(true);
    expect(queries.eventsHead).toHaveBeenCalledTimes(2);
  });
});
