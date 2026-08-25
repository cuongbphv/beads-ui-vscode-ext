/**
 * Focused unit test for `isDashboardConsistent`, `isStatsConsistent`, and the
 * shared `fetchWithConsistencyRetry` (see
 * `src/test/support/dashboard-consistency.ts`) — the retry-once helper
 * `bd-live.test.ts` uses in two describe blocks ("dashboard snapshot" and
 * "stats match the CLI") to absorb a single transient concurrent-write race
 * against the shared live board. Written for beads-ui-vscode-ext-l2o
 * (`isDashboardConsistent`) and extended for beads-ui-vscode-ext-3yq
 * (`isStatsConsistent`, and `fetchWithConsistencyRetry` generalized to take
 * an explicit `isConsistent` predicate so both checks share one retry
 * helper): that race is rare/intermittent by nature against a real board, so
 * this suite proves the retry logic by mocking the fetch itself — no live
 * `bd` and no real race required.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  fetchWithConsistencyRetry,
  isDashboardConsistent,
  isStatsConsistent,
} from './support/dashboard-consistency';

/** A result shaped enough to exercise `toCheckInput`, nothing more. */
interface FakeFetch {
  beadIds: string[];
  beadsLength: number;
  gatesTotal: number;
  statsTotalIssues: number;
  readyIds: string[];
  blockedIds: string[];
}

function toCheckInput(result: FakeFetch) {
  return {
    beadIds: new Set(result.beadIds),
    beadsLength: result.beadsLength,
    gatesTotal: result.gatesTotal,
    statsTotalIssues: result.statsTotalIssues,
    readyIds: result.readyIds,
    blockedIds: result.blockedIds,
  };
}

const consistent: FakeFetch = {
  beadIds: ['a', 'b'],
  beadsLength: 2,
  gatesTotal: 1,
  statsTotalIssues: 3,
  readyIds: ['a'],
  blockedIds: ['b'],
};

describe('isDashboardConsistent', () => {
  it('is true when the totals and ready/blocked ids all agree', () => {
    expect(isDashboardConsistent(toCheckInput(consistent))).toBe(true);
  });

  it('is false when beads + gates does not add up to stats.total_issues', () => {
    expect(
      isDashboardConsistent(toCheckInput({ ...consistent, statsTotalIssues: 4 })),
    ).toBe(false);
  });

  it('is false when a ready id is missing from the beads list', () => {
    expect(
      isDashboardConsistent(toCheckInput({ ...consistent, readyIds: ['a', 'missing'] })),
    ).toBe(false);
  });

  it('is false when a blocked id is missing from the beads list', () => {
    expect(
      isDashboardConsistent(toCheckInput({ ...consistent, blockedIds: ['b', 'missing'] })),
    ).toBe(false);
  });
});

/** A result shaped enough to exercise the "stats match the CLI" toCheckInput. */
interface FakeStatsFetch {
  allLength: number;
  allClosedLength: number;
  gatesTotal: number;
  gatesClosed: number;
  statsTotalIssues: number;
  statsClosedIssues: number;
}

const statsConsistent: FakeStatsFetch = {
  allLength: 5,
  allClosedLength: 2,
  gatesTotal: 1,
  gatesClosed: 1,
  statsTotalIssues: 6,
  statsClosedIssues: 3,
};

describe('isStatsConsistent', () => {
  it('is true when both the total and the closed-count totals agree', () => {
    expect(isStatsConsistent(statsConsistent)).toBe(true);
  });

  it('is false when all.length + gates.total does not add up to stats.total_issues', () => {
    expect(isStatsConsistent({ ...statsConsistent, statsTotalIssues: 7 })).toBe(false);
  });

  it('is false when the closed counts do not add up to stats.closed_issues', () => {
    expect(isStatsConsistent({ ...statsConsistent, statsClosedIssues: 99 })).toBe(false);
  });
});

describe('fetchWithConsistencyRetry', () => {
  it('fetches only once when the first result is already consistent', async () => {
    const fetchOnce = vi.fn().mockResolvedValue(consistent);

    const result = await fetchWithConsistencyRetry(fetchOnce, toCheckInput, isDashboardConsistent);

    expect(result).toBe(consistent);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once and returns the second result when the first disagrees but the retry agrees', async () => {
    // Simulates the observed race: a concurrent write lands between the
    // fan-out's independent `bd` calls on the first attempt (here, a ready
    // id the `beads` list hasn't caught up to yet), then a second, otherwise
    // identical fetch — matching what re-running the same real `bd` calls a
    // moment later would return once nothing is racing it any more — settles.
    const racy: FakeFetch = { ...consistent, readyIds: ['a', 'not-yet-listed'] };
    const fetchOnce = vi.fn().mockResolvedValueOnce(racy).mockResolvedValueOnce(consistent);

    const result = await fetchWithConsistencyRetry(fetchOnce, toCheckInput, isDashboardConsistent);

    expect(result).toBe(consistent);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });

  it('does not retry a second time — a mismatch that survives the retry is returned as-is', async () => {
    // A persistent mismatch (not a transient race) must still reach the
    // caller's own assertions and fail loudly, not be retried away.
    const stillRacy: FakeFetch = { ...consistent, statsTotalIssues: 99 };
    const fetchOnce = vi.fn().mockResolvedValue(stillRacy);

    const result = await fetchWithConsistencyRetry(fetchOnce, toCheckInput, isDashboardConsistent);

    expect(result).toBe(stillRacy);
    expect(isDashboardConsistent(toCheckInput(result))).toBe(false);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });

  it('also works with isStatsConsistent — the same retry-once helper serves a different invariant shape', async () => {
    // Proves `fetchWithConsistencyRetry`'s generalization (beads-ui-vscode-ext-3yq):
    // it is not hardcoded to `isDashboardConsistent` — any `(input: C) =>
    // boolean` predicate paired with a matching `toCheckInput` works, here
    // exercising a race the closed-count check alone would catch (the total
    // already agrees on the first attempt).
    const raceOnClosedCount: FakeStatsFetch = { ...statsConsistent, statsClosedIssues: 4 };
    const fetchOnce = vi
      .fn()
      .mockResolvedValueOnce(raceOnClosedCount)
      .mockResolvedValueOnce(statsConsistent);

    const result = await fetchWithConsistencyRetry(
      fetchOnce,
      (r: FakeStatsFetch) => r,
      isStatsConsistent,
    );

    expect(result).toBe(statsConsistent);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });
});
