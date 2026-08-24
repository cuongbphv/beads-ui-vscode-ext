/**
 * Header chip for read-only Dolt sync/engine status (bead ayq.2).
 *
 * Purely presentational: `App.tsx` owns the actual fetch (via `useSyncStatus`)
 * and only ever triggers it from the manual Refresh button, never from a poll
 * tick. This component itself never calls `bd dolt push`/`bd dolt pull` — the
 * only action it offers is copying the suggested pull command to the
 * clipboard through the same `copyText` RPC `bead-detail.tsx` already uses.
 *
 * Mode-aware: `mode` and `server_running` render whenever a status is known;
 * ahead/behind/last-sync render only when bd's reply actually included them —
 * this project's own `bd dolt status --json` (embedded mode) never does.
 */
import { Copy, GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';

import type { RpcError } from '../../shared/protocol';
import type { SyncStatus } from '../../shared/types';
import { call } from '../bridge/rpc';
import { cn, relativeTime } from '../lib/utils';

/** The only command this widget ever suggests. It copies the text; it never runs it. */
export const SUGGESTED_SYNC_COMMAND = 'bd dolt pull';

export interface SyncStatusChipProps {
  status: SyncStatus | undefined;
  loading: boolean;
  error: RpcError | undefined;
}

export function SyncStatusChip({ status, loading, error }: SyncStatusChipProps): ReactNode {
  // Nothing has been fetched yet — the chip stays out of the header entirely
  // until the user presses Refresh once, rather than showing a placeholder
  // for a call that was never made.
  if (!status) {
    if (loading) return <span className="text-fg-muted text-xs">checking sync…</span>;
    if (error) {
      return (
        <span className="text-warning text-xs" title={error.message}>
          sync status unavailable
        </span>
      );
    }
    return null;
  }

  const hasAhead = typeof status.ahead === 'number';
  const hasBehind = typeof status.behind === 'number';

  return (
    <span
      className="text-fg-muted inline-flex items-center gap-1.5 text-xs"
      title={`Dolt mode: ${status.mode}`}
    >
      <GitBranch aria-hidden="true" className="size-3.5" />
      <span data-testid="sync-mode">{status.mode}</span>
      <span
        aria-hidden="true"
        className={cn('inline-block size-1.5 rounded-full', status.server_running ? 'bg-success' : 'bg-fg-muted')}
      />
      <span className="sr-only">
        {status.server_running ? 'Dolt server running' : 'Dolt server not running'}
      </span>
      {hasAhead || hasBehind ? (
        <span data-testid="sync-ahead-behind">
          {hasAhead ? `↑${status.ahead}` : null}
          {hasBehind ? `↓${status.behind}` : null}
        </span>
      ) : null}
      {status.lastSyncAt ? (
        <span title={status.lastSyncAt}>synced {relativeTime(status.lastSyncAt)}</span>
      ) : null}
      <button
        type="button"
        title={`Copy "${SUGGESTED_SYNC_COMMAND}"`}
        className="hover:text-fg"
        onClick={() => void call('copyText', { text: SUGGESTED_SYNC_COMMAND })}
      >
        <Copy aria-hidden="true" className="size-3" />
        <span className="sr-only">Copy suggested sync command</span>
      </button>
    </span>
  );
}
