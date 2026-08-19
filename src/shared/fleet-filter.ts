/**
 * Fleet tab's status filter: all / running / idle.
 *
 * "Idle" is deliberately not `FleetWorker['status'] === 'idle'` — it means
 * "not running", so it also covers `unknown` (a worker whose transcript went
 * quiet without a clean exit). Splitting `idle` and `unknown` into separate
 * filter values would ask the user to know beads' own bookkeeping distinction
 * before they could find a worker that simply is not doing anything.
 */
import type { FleetWorker } from './fleet';

export type FleetStatusFilter = 'all' | 'running' | 'idle';

export const FLEET_STATUS_FILTERS: readonly FleetStatusFilter[] = ['all', 'running', 'idle'];

export function matchesStatusFilter(status: FleetWorker['status'], filter: FleetStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return status === 'running';
  return status === 'idle' || status === 'unknown';
}

/** Narrows a worker list to the ones the current filter admits, order preserved. */
export function filterWorkersByStatus(
  workers: readonly FleetWorker[],
  filter: FleetStatusFilter,
): FleetWorker[] {
  return workers.filter((worker) => matchesStatusFilter(worker.status, filter));
}
