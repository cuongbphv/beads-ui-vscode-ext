/**
 * `bd-live.test.ts`'s "dashboard snapshot is internally consistent" test
 * (describe block `'dashboard snapshot'`) reads several independent `bd`
 * calls that each shell out separately: `BdQueries.snapshot()` is itself a
 * "six-way fan-out" (`context`, `vocabulary`, `stats`, `list`, `ready`,
 * `blocked`, `gates` — see its own doc comment in
 * `src/extension/bd/queries.ts`), and the test additionally calls the
 * sibling `gateIssueCounts()` helper as a seventh, still-separate call. All
 * of that runs against THIS repo's real, live `.beads` board on purpose —
 * see that describe block's own comment for why a scratch project would lose
 * real-CLI coverage the test is meant to have.
 *
 * A real concurrent write to the shared board between any two of those calls
 * — another session's `bd create`/`close`, a fleet agent, a human — can make
 * the results transiently disagree with each other even though nothing is
 * actually broken: `snapshot.beads.length + gates.total` can miss
 * `snapshot.stats.total_issues` by exactly one write, or `snapshot.readyIds`/
 * `blockedIds` can name an id that the `beads` list call (a separate `bd`
 * invocation) hasn't picked up yet. See beads-ui-vscode-ext-l2o.
 *
 * `fetchWithConsistencyRetry` re-runs the whole fetch exactly once when the
 * invariants `isDashboardConsistent` checks disagree, matching the CLI's own
 * eventual consistency. A disagreement that survives the retry is treated as
 * real: the second result is returned as-is (still inconsistent, if it still
 * is) so the caller's own assertions fail loudly instead of the mismatch
 * being silently retried away.
 */

/** The values `isDashboardConsistent` needs, independent of any real bd type. */
export interface DashboardConsistencyInput {
  /** ids of every bead in `snapshot.beads`. */
  beadIds: Set<string>;
  beadsLength: number;
  gatesTotal: number;
  statsTotalIssues: number;
  readyIds: string[];
  blockedIds: string[];
}

/**
 * True when the fan-out's own invariants agree with each other:
 * - `beads` (open + closed, minus gates) plus the separately-counted gates
 *   add up to `stats.total_issues`.
 * - every id `snapshot` claims is ready or blocked actually appears in the
 *   `beads` list that same snapshot returned.
 */
export function isDashboardConsistent(input: DashboardConsistencyInput): boolean {
  const { beadIds, beadsLength, gatesTotal, statsTotalIssues, readyIds, blockedIds } = input;
  if (beadsLength + gatesTotal !== statsTotalIssues) return false;
  for (const id of readyIds) if (!beadIds.has(id)) return false;
  for (const id of blockedIds) if (!beadIds.has(id)) return false;
  return true;
}

/**
 * Calls `fetchOnce`, and if the result it derives via `toCheckInput` fails
 * `isDashboardConsistent`, calls `fetchOnce` exactly one more time and
 * returns that second result unconditionally — consistent or not. This never
 * loops or masks a persistent mismatch; it only absorbs a single transient
 * race between the fan-out's independent `bd` calls.
 */
export async function fetchWithConsistencyRetry<T>(
  fetchOnce: () => Promise<T>,
  toCheckInput: (result: T) => DashboardConsistencyInput,
): Promise<T> {
  const first = await fetchOnce();
  if (isDashboardConsistent(toCheckInput(first))) return first;
  return fetchOnce();
}
