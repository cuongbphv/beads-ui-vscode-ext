/**
 * Focused unit test for `isDashboardConsistent`/`fetchWithConsistencyRetry`
 * (see `src/test/support/dashboard-consistency.ts`) — the retry-once helper
 * `bd-live.test.ts`'s "dashboard snapshot" describe block uses to absorb a
 * single transient concurrent-write race against the shared live board.
 * Written for beads-ui-vscode-ext-l2o: that race is rare/intermittent by
 * nature against a real board, so this suite proves the retry logic by
 * mocking the fetch itself — no live `bd` and no real race required.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  fetchWithConsistencyRetry,
  isDashboardConsistent,
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

describe('fetchWithConsistencyRetry', () => {
  it('fetches only once when the first result is already consistent', async () => {
    const fetchOnce = vi.fn().mockResolvedValue(consistent);

    const result = await fetchWithConsistencyRetry(fetchOnce, toCheckInput);

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

    const result = await fetchWithConsistencyRetry(fetchOnce, toCheckInput);

    expect(result).toBe(consistent);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });

  it('does not retry a second time — a mismatch that survives the retry is returned as-is', async () => {
    // A persistent mismatch (not a transient race) must still reach the
    // caller's own assertions and fail loudly, not be retried away.
    const stillRacy: FakeFetch = { ...consistent, statsTotalIssues: 99 };
    const fetchOnce = vi.fn().mockResolvedValue(stillRacy);

    const result = await fetchWithConsistencyRetry(fetchOnce, toCheckInput);

    expect(result).toBe(stillRacy);
    expect(isDashboardConsistent(toCheckInput(result))).toBe(false);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });
});
