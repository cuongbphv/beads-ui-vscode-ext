/**
 * Row order for the Fleet tab: most recently active first.
 *
 * Pure and framework-free (see CLAUDE.md) so the ordering can be tested in
 * isolation from `WorkerList` — mirrors `roadmap-sort.ts`'s own contract for
 * the Roadmap. Both `FleetOrchestrator` and `FleetWorker` carry a nullable
 * `lastActivityAt`, so this is generic over anything shaped that way rather
 * than duplicated per type.
 */

export interface HasLastActivity {
  lastActivityAt: string | null | undefined;
}

/** `undefined` for `null`, missing, or a string that does not parse as a date. */
function timeOf(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Sorts by `lastActivityAt` descending (most recent first). Missing or
 * unparseable timestamps sort last, and ties among them preserve the
 * original relative order — `Array#sort` is stable, and this comparator
 * never treats two "no timestamp" rows as anything but equal.
 */
export function sortByRecency<T extends HasLastActivity>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const aTime = timeOf(a.lastActivityAt);
    const bTime = timeOf(b.lastActivityAt);
    if (aTime === undefined && bTime === undefined) return 0;
    if (aTime === undefined) return 1;
    if (bTime === undefined) return -1;
    return bTime - aTime;
  });
}
