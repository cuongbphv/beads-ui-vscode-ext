/**
 * `bd-live.test.ts` has two describe blocks that each fan out several
 * independent `bd` calls against THIS repo's real, live `.beads` board on
 * purpose (see each describe block's own comment for why a scratch project
 * would lose real-CLI coverage the test is meant to have), then assert a
 * total-count invariant across the fanned-out results:
 *
 * - "dashboard snapshot is internally consistent": `BdQueries.snapshot()` is
 *   itself a "six-way fan-out" (`context`, `vocabulary`, `stats`, `list`,
 *   `ready`, `blocked`, `gates` — see its own doc comment in
 *   `src/extension/bd/queries.ts`), plus the sibling `gateIssueCounts()`
 *   helper as a seventh, still-separate call. See beads-ui-vscode-ext-l2o.
 * - "stats match the CLI > agrees with the issue list it will be shown next
 *   to": `queries.stats()`, `queries.list({ all: true })`, and
 *   `gateIssueCounts()` as three independent calls. See
 *   beads-ui-vscode-ext-3yq.
 *
 * A real concurrent write to the shared board between any two of a describe
 * block's calls — another session's `bd create`/`close`, a fleet agent, a
 * human — can make the results transiently disagree with each other even
 * though nothing is actually broken: a `beads`/list count plus the
 * separately-counted gates can miss the `stats` total by exactly one write,
 * or a snapshot's `readyIds`/`blockedIds` can name an id that the `beads`
 * list call (a separate `bd` invocation) hasn't picked up yet.
 *
 * `fetchWithConsistencyRetry` re-runs the whole fetch exactly once when the
 * consistency check passed in (`isDashboardConsistent` for the first describe
 * block, `isStatsConsistent` for the second — see each one's own doc comment
 * for why the two invariant shapes are genuinely different rather than one
 * being reused for the other) disagrees, matching the CLI's own eventual
 * consistency. A disagreement that survives the retry is treated as real: the
 * second result is returned as-is (still inconsistent, if it still is) so the
 * caller's own assertions fail loudly instead of the mismatch being silently
 * retried away.
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
 * The values `isStatsConsistent` needs — beads-ui-vscode-ext-3yq's three-way
 * fan-out (`queries.stats()`, `queries.list({ all: true })`,
 * `gateIssueCounts()` in `bd-live.test.ts`'s "stats match the CLI > agrees
 * with the issue list it will be shown next to" test).
 *
 * This is a genuinely different invariant shape than `DashboardConsistencyInput`,
 * not just a relabeling of the same fields: there is no `snapshot` here, so no
 * ready/blocked ids to cross-check, and this fan-out additionally compares
 * *closed*-count totals the same way it compares the overall total — a
 * comparison `DashboardConsistencyInput`/`isDashboardConsistent` has no fields
 * for at all. Reusing `isDashboardConsistent` by shoehorning this data into
 * its shape (e.g. passing empty `readyIds`/`blockedIds`) would silently drop
 * the closed-count check from the retry decision, so a race that skews only
 * the closed counts would never trigger a retry — exactly the kind of
 * weakening CLAUDE.md and this bead's acceptance criteria rule out. Hence a
 * second, small, dedicated check function alongside `isDashboardConsistent`.
 */
export interface StatsConsistencyInput {
  /** `queries.list({ all: true }).length`. */
  allLength: number;
  /** count of closed beads in that same list. */
  allClosedLength: number;
  gatesTotal: number;
  gatesClosed: number;
  statsTotalIssues: number;
  statsClosedIssues: number;
}

/**
 * True when the three-way fan-out's totals agree with each other:
 * - the issue list (open + closed, minus gates) plus the separately-counted
 *   gates add up to `stats.total_issues`.
 * - the same is true restricted to closed issues: closed issues in the list
 *   plus closed gates add up to `stats.closed_issues`.
 */
export function isStatsConsistent(input: StatsConsistencyInput): boolean {
  const { allLength, allClosedLength, gatesTotal, gatesClosed, statsTotalIssues, statsClosedIssues } =
    input;
  if (allLength + gatesTotal !== statsTotalIssues) return false;
  if (allClosedLength + gatesClosed !== statsClosedIssues) return false;
  return true;
}

/**
 * Calls `fetchOnce`, and if the result it derives via `toCheckInput` fails
 * `isConsistent`, calls `fetchOnce` exactly one more time and returns that
 * second result unconditionally — consistent or not. This never loops or
 * masks a persistent mismatch; it only absorbs a single transient race
 * between the fan-out's independent `bd` calls.
 *
 * Generic over both the fetch result `T` and the consistency-check input `C`
 * so it serves any fan-out shape — `isDashboardConsistent` for the
 * "dashboard snapshot" test's pair, `isStatsConsistent` for the "stats match
 * the CLI" test's three-way fan-out, or any future check — rather than
 * hardcoding one invariant shape.
 */
export async function fetchWithConsistencyRetry<T, C>(
  fetchOnce: () => Promise<T>,
  toCheckInput: (result: T) => C,
  isConsistent: (input: C) => boolean,
): Promise<T> {
  const first = await fetchOnce();
  if (isConsistent(toCheckInput(first))) return first;
  return fetchOnce();
}
