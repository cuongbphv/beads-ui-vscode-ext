/**
 * Overview: the "where does this project stand" tab.
 *
 * Stat cards, six charts, and the two lists that answer the only questions
 * worth asking on arrival — what can I start, and what is stuck.
 */
import { AlertTriangle, CheckCircle2, CircleDot, Clock, FlaskConical, Zap } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { version as extensionVersion } from '../../../package.json';
import { activeMoleculeCount, StatusIndex } from '../../shared/model';
import type { Bead, DashboardSnapshot } from '../../shared/types';
import { BeadCard } from '../components/bead-card';
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

  const readySet = useMemo(() => new Set(snapshot.readyIds), [snapshot.readyIds]);
  const blockedSet = useMemo(() => new Set(snapshot.blockedIds), [snapshot.blockedIds]);

  const ready = beads.filter((bead) => readySet.has(bead.id)).slice(0, 8);
  const blocked = beads.filter((bead) => blockedSet.has(bead.id)).slice(0, 8);

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
          hint="Nothing is blocking these."
          beads={ready}
          allBeads={beads}
          index={index}
          onSelect={onSelect}
          selectedId={selectedId}
          emptyText="No unblocked issues right now."
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
                <BeadCard
                  bead={bead}
                  blocked={blocked}
                  selected={bead.id === selectedId}
                  onSelect={onSelect}
                />
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
    </section>
  );
}
