/**
 * Overview: the "where does this project stand" tab.
 *
 * Stat cards, six charts, and the two lists that answer the only questions
 * worth asking on arrival — what can I start, and what is stuck.
 */
import { AlertTriangle, CheckCircle2, CircleDot, Clock, FlaskConical, Zap } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { version as extensionVersion } from '../../../package.json';
import { activeMoleculeCount, StatusIndex } from '../../shared/model';
import type { Bead, DashboardSnapshot } from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';
import { BeadCard } from '../components/bead-card';
import { useToast } from '../components/toast';
import {
  BurnUpChart,
  ChartCard,
  EpicProgressChart,
  PriorityChart,
  StatusDonut,
  TypeChart,
  WorkloadChart,
} from '../components/charts';
import { HealthScorecard } from '../components/health-scorecard';
import { EmptyState, StatCard } from '../components/primitives';
import { directBlockerHint } from '../lib/blocked-hint';
import { burnUpDensity, workloadDensity } from '../lib/chart-density';

export function OverviewView({
  snapshot,
  index,
  onSelect,
  selectedId,
}: {
  snapshot: DashboardSnapshot;
  index: StatusIndex;
  onSelect: (id: string) => void;
  selectedId?: string;
}): ReactNode {
  const { stats, beads } = snapshot;
  const { notify } = useToast();
  const [readyLimit, setReadyLimit] = useState(8);
  const [claimingId, setClaimingId] = useState<string>();

  const readySet = useMemo(() => new Set(snapshot.readyIds), [snapshot.readyIds]);
  const blockedSet = useMemo(() => new Set(snapshot.blockedIds), [snapshot.blockedIds]);

  const ready = beads.filter((bead) => readySet.has(bead.id));
  const blocked = beads.filter((bead) => blockedSet.has(bead.id)).slice(0, 8);

  async function claim(id: string): Promise<void> {
    if (claimingId) return;
    setClaimingId(id);
    try {
      await call('claimBead', { id });
      notify(`Claimed ${id}`);
    } catch (error) {
      notify(asRpcError(error).message, 'error');
    } finally {
      setClaimingId(undefined);
    }
  }

  // Anything past its due date and still open — the number that should worry you.
  const overdue = useMemo(() => {
    const now = Date.now();
    return beads.filter(
      (bead) =>
        !index.isDone(bead.status) &&
        bead.due_at !== undefined &&
        Date.parse(bead.due_at) < now,
    ).length;
  }, [beads, index]);

  // Sparse data decides the layout, not just the drawing: a burn-up with no
  // trend in it should not also be the widest card on the page.
  const burnUp = useMemo(() => burnUpDensity(beads, index), [beads, index]);
  const workload = useMemo(() => workloadDensity(beads, index), [beads, index]);

  // Molecule roots ride along in `snapshot.beads` already — no extra `bd`
  // read, just a filter over data we already fetched for the other cards.
  const activeMolecules = useMemo(() => activeMoleculeCount(beads, index), [beads, index]);

  return (
    <div className="@container h-full overflow-y-auto px-3 py-3">
      <div className="text-fg-muted mb-3 flex flex-wrap items-center justify-end gap-2 text-xs">
        <span>Beads Dashboard</span>
        <span
          aria-label="Extension version"
          className="border-border bg-surface rounded-full border px-2 py-0.5 font-mono"
        >
          v{extensionVersion}
        </span>
      </div>
      {/* 1 → 2 → 6 columns by *container* width: a webview panel's width has
          nothing to do with the viewport's. */}
      <section
        aria-label="Project statistics"
        className="grid grid-cols-1 gap-2 @md:grid-cols-2 @3xl:grid-cols-6"
      >
        <StatCard
          icon={<CircleDot className="size-4" />}
          label="Total"
          value={stats.total_issues}
          hint={`${stats.open_issues} open`}
        />
        <StatCard
          icon={<Zap className="size-4" />}
          label="Ready"
          value={stats.ready_issues}
          hint="no blockers"
          tone="accent"
        />
        <StatCard
          icon={<AlertTriangle className="size-4" />}
          label="Blocked"
          value={stats.blocked_issues}
          hint="waiting on a dependency"
          tone="warning"
        />
        <StatCard
          icon={<Clock className="size-4" />}
          label="Overdue"
          value={overdue}
          hint="past due, still open"
          tone={overdue > 0 ? 'danger' : 'default'}
        />
        <StatCard
          icon={<CheckCircle2 className="size-4" />}
          label="Closed"
          value={stats.closed_issues}
          hint={`${percentDone(stats.closed_issues, stats.total_issues)}% of all issues`}
          tone="success"
        />
        <StatCard
          icon={<FlaskConical className="size-4" />}
          label="Molecules"
          value={activeMolecules}
          hint="active"
        />
      </section>

      {snapshot.issueScope ? (
        <p className="text-fg-muted mt-2 text-xs" aria-label="Issue data scope">
          Loaded {snapshot.issueScope.loadedCount} ordinary issues
          {snapshot.issueScope.hasMore ? ' (more available)' : ''}; project total {snapshot.issueScope.projectTotal}
          {snapshot.issueScope.excludedKinds.length > 0
            ? ` includes ${snapshot.issueScope.excludedKinds.join(', ')}`
            : ''}.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <ChartCard title="Status" hint="by category">
          <StatusDonut beads={beads} index={index} />
        </ChartCard>
        <ChartCard title="Priority" hint="open vs done">
          <PriorityChart beads={beads} index={index} />
        </ChartCard>
        <ChartCard title="Issue types">
          <TypeChart beads={beads} />
        </ChartCard>
        {/* Still two columns wide when sparse: the card shrinks in *height*, so
            a narrower one would only punch a hole in the row. */}
        <ChartCard title="Burn-up" hint="cumulative closed" className="@2xl:col-span-2">
          <BurnUpChart beads={beads} index={index} density={burnUp} />
        </ChartCard>
        <ChartCard title="Workload" hint="open work per PIC">
          <WorkloadChart beads={beads} index={index} density={workload} />
        </ChartCard>
        <ChartCard title="Epic progress" className="@2xl:col-span-2 @5xl:col-span-3">
          <EpicProgressChart beads={beads} index={index} />
        </ChartCard>
      </div>

      <div className="mt-3 grid gap-3 @3xl:grid-cols-2">
        <BeadList
          title="Ready to start"
          hint={`${ready.length} loaded ready · ${stats.ready_issues} project ready`}
          beads={ready.slice(0, readyLimit)}
          allBeads={beads}
          index={index}
          onSelect={onSelect}
          selectedId={selectedId}
          emptyText={snapshot.readyIds.length > 0 ? 'Ready issues are outside the loaded window. Raise the issue limit to see them.' : 'No ready issues right now.'}
          onClaim={claim}
          claimingId={claimingId}
          hiddenCount={ready.length - Math.min(readyLimit, ready.length)}
          onLoadMore={() => setReadyLimit((limit) => limit + 8)}
        />
        <BeadList
          title="Blocked"
          hint="Waiting on a dependency."
          beads={blocked}
          allBeads={beads}
          index={index}
          blocked
          onSelect={onSelect}
          selectedId={selectedId}
          emptyText="Nothing is blocked."
        />
      </div>

      <HealthScorecard onSelect={onSelect} />
    </div>
  );
}

function percentDone(done: number, total: number): number {
  return total <= 0 ? 0 : Math.round((done / total) * 100);
}

function BeadList({
  title,
  hint,
  beads,
  allBeads,
  index,
  onSelect,
  selectedId,
  emptyText,
  blocked,
  onClaim,
  claimingId,
  hiddenCount,
  onLoadMore,
}: {
  title: string;
  hint: string;
  beads: Bead[];
  /** The full snapshot, so a per-row blocker hint can resolve blocker titles. */
  allBeads: Bead[];
  index: StatusIndex;
  onSelect: (id: string) => void;
  selectedId?: string;
  emptyText: string;
  blocked?: boolean;
  onClaim?: (id: string) => void;
  claimingId?: string;
  hiddenCount?: number;
  onLoadMore?: () => void;
}): ReactNode {
  return (
    <section aria-label={title} className="bg-surface border-border rounded-lg border p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-fg-strong text-sm font-medium">{title}</h2>
        <span className="text-fg-muted text-xs">{hint}</span>
      </div>
      {beads.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-8" />} title={emptyText} />
      ) : (
        <ul className="grid gap-1.5">
          {beads.map((bead) => {
            // Compact "why blocked" hint: direct blocker only, capped at
            // depth 1 — see src/webview/lib/blocked-hint.ts. `undefined`
            // (no open direct blocker, e.g. a stale poll tick) leaves the
            // row exactly as it was before this hint existed.
            const blockedHint = blocked ? directBlockerHint(bead, allBeads, index) : undefined;
            return (
              <li key={bead.id}>
                <div className="flex items-center gap-2">
                  <BeadCard
                    bead={bead}
                    blocked={blocked}
                    selected={bead.id === selectedId}
                    onSelect={onSelect}
                    className="min-w-0 flex-1"
                  />
                  {onClaim ? (
                    <button
                      type="button"
                      disabled={Boolean(claimingId)}
                      onClick={() => onClaim(bead.id)}
                      className="border-border text-fg hover:bg-surface-hover disabled:opacity-50 rounded-md border px-2 py-1 text-xs"
                      aria-label={`Claim ${bead.id}`}
                    >
                      {claimingId === bead.id ? 'Claiming…' : 'Claim'}
                    </button>
                  ) : null}
                </div>
                {blockedHint ? (
                  <p className="text-fg-muted mt-1 truncate text-xs">
                    Blocked by <span className="text-fg">{blockedHint.title}</span>
                    {blockedHint.extra > 0 ? ` +${blockedHint.extra} more` : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {hiddenCount && hiddenCount > 0 && onLoadMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="border-border text-fg-muted hover:bg-surface-hover mt-2 w-full rounded-md border px-2 py-1.5 text-xs"
        >
          Show more ready issues ({hiddenCount} remaining)
        </button>
      ) : null}
    </section>
  );
}
