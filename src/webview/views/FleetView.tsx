/**
 * Fleet: which orchestrator sessions and workers are running against this
 * workspace, and which worktrees on disk are stale.
 *
 * `useFleet()` subscribes on mount and unsubscribes on unmount, so this
 * component being on screen is exactly what gates the extension host's
 * discovery loop (`FleetService.observe`) — switching to another tab
 * unmounts it and the polling stops with it, mirroring how the bd store's
 * poll gate is charged to whoever is looking.
 */
import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';

import { WorkerList } from '../components/fleet/worker-list';
import { EmptyState, Skeleton } from '../components/primitives';
import { useFleet } from '../hooks/use-fleet';

export function FleetView(): ReactNode {
  const { snapshot, loading } = useFleet();

  if (!snapshot) {
    return loading ? (
      <div className="grid gap-2 p-3" aria-busy="true" aria-label="Loading fleet">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
    ) : (
      <EmptyState
        icon={<Bot className="size-10" />}
        title="No fleet data yet"
        hint="Waiting for the first discovery scan from the extension host."
      />
    );
  }

  return <WorkerList snapshot={snapshot} />;
}
