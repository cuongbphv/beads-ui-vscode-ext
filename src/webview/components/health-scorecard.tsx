/**
 * On-demand project-health drawer (bead beads-ui-vscode-ext-72m.2): stale /
 * orphans / lint / dependency-cycle checks, one {@link StatCard} tile per
 * check, each independently degradable (see `HealthCheck` in
 * `shared/types.ts`) — a failing check renders its own error tile instead
 * of blanking the other three.
 *
 * Collapsed by default. Fetches nothing on mount and nothing on the poll
 * tick: the only way data appears is pressing "Run checks", which calls
 * `useHealth().run()` — mirrors `useSyncStatus`'s manual-only fetch.
 *
 * `bd preflight` and `bd doctor` are deliberately excluded from what this
 * drawer can ever show — see the `HealthReport` doc comment in
 * `shared/types.ts` for why.
 */
import { AlertOctagon, ChevronDown, ClipboardList, Link2Off, ShieldQuestion, Clock3 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import type { Bead, HealthCheck, HealthReport, LintFinding } from '../../shared/types';
import { useHealth } from '../hooks/use-health';
import { cn, relativeTime } from '../lib/utils';
import { BeadCard } from './bead-card';
import { Button, EmptyState, StatCard } from './primitives';

type CheckKey = 'stale' | 'orphans' | 'lint' | 'cycles';

export function HealthScorecard({ onSelect }: { onSelect: (id: string) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<CheckKey | null>(null);
  const { report, loading, error, run } = useHealth();

  function toggle(key: CheckKey): void {
    setExpanded((current) => (current === key ? null : key));
  }

  return (
    <section
      aria-label="Project health"
      className="bg-surface border-border mt-3 rounded-lg border p-3"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-fg-strong text-sm font-medium">Project health</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => run()} disabled={loading}>
              {loading ? 'Running checks…' : 'Run checks'}
            </Button>
            {report ? (
              <span className="text-fg-muted text-xs">Checked {relativeTime(report.fetchedAt)}</span>
            ) : null}
            {error ? <span className="text-danger text-xs">{error.message}</span> : null}
          </div>

          {report ? (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 @md:grid-cols-2 @3xl:grid-cols-4">
                <CheckTile
                  title="Stale"
                  icon={<Clock3 className="size-4" />}
                  check={report.stale}
                  expanded={expanded === 'stale'}
                  onToggle={() => toggle('stale')}
                />
                <CheckTile
                  title="Orphans"
                  icon={<Link2Off className="size-4" />}
                  check={report.orphans}
                  expanded={expanded === 'orphans'}
                  onToggle={() => toggle('orphans')}
                />
                <CheckTile
                  title="Lint"
                  icon={<ClipboardList className="size-4" />}
                  check={report.lint}
                  expanded={expanded === 'lint'}
                  onToggle={() => toggle('lint')}
                />
                <CheckTile
                  title="Dep cycles"
                  icon={<AlertOctagon className="size-4" />}
                  check={report.cycles}
                  expanded={expanded === 'cycles'}
                  onToggle={() => toggle('cycles')}
                />
              </div>

              {expanded ? (
                <div className="mt-3">
                  <DrillDown checkKey={expanded} report={report} onSelect={onSelect} />
                </div>
              ) : null}
            </>
          ) : !loading && !error ? (
            <EmptyState
              icon={<ShieldQuestion className="size-8" />}
              title="No checks run yet"
              hint="Run checks to look for stale issues, orphans, lint gaps and dependency cycles."
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One check's tile. A failed check (`ok: false`) renders its own error
 * state — an em dash plus the message — instead of a `0` that would read as
 * "nothing found" when the check never actually ran.
 */
function CheckTile<T>({
  title,
  icon,
  check,
  expanded,
  onToggle,
}: {
  title: string;
  icon: ReactNode;
  check: HealthCheck<T>;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  if (!check.ok) {
    return (
      <StatCard
        icon={icon}
        label={title}
        value="—"
        hint={check.error ?? 'check failed'}
        tone="danger"
      />
    );
  }

  const count = check.items.length;
  return (
    <StatCard
      icon={icon}
      label={title}
      value={count}
      hint={count > 0 ? 'select to view' : 'none found'}
      tone={count > 0 ? 'warning' : 'success'}
      onClick={count > 0 ? onToggle : undefined}
      expanded={expanded}
    />
  );
}

function DrillDown({
  checkKey,
  report,
  onSelect,
}: {
  checkKey: CheckKey;
  report: HealthReport;
  onSelect: (id: string) => void;
}): ReactNode {
  switch (checkKey) {
    case 'stale':
      return <BeadDrillDown beads={report.stale.items} onSelect={onSelect} />;
    case 'orphans':
      return <BeadDrillDown beads={report.orphans.items} onSelect={onSelect} />;
    case 'lint':
      return <LintDrillDown findings={report.lint.items} />;
    case 'cycles':
      return <CyclesDrillDown items={report.cycles.items} />;
  }
}

function BeadDrillDown({
  beads,
  onSelect,
}: {
  beads: Bead[];
  onSelect: (id: string) => void;
}): ReactNode {
  return (
    <ul className="grid gap-1.5">
      {beads.map((bead) => (
        <li key={bead.id}>
          <BeadCard bead={bead} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function LintDrillDown({ findings }: { findings: LintFinding[] }): ReactNode {
  return (
    <ul className="grid gap-1.5">
      {findings.map((finding) => (
        <li key={finding.id} className="bg-surface border-border rounded-md border p-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-fg-muted truncate font-mono text-xs">{finding.id}</span>
            <span className="text-fg-strong truncate">{finding.title}</span>
          </div>
          <ul className="mt-1 flex flex-wrap gap-1">
            {finding.missing.map((section) => (
              <li
                key={section}
                className="bg-surface-hover text-fg-muted rounded-sm px-1.5 py-px text-[10px]"
              >
                {section}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * `bd dep cycles --json` element shape is [Unverified] — this project's own
 * board has no cycle to sample (measured 2026-08-25: `[]`) — so each row is
 * rendered defensively rather than assuming a field name.
 */
function CyclesDrillDown({ items }: { items: unknown[] }): ReactNode {
  return (
    <ul className="grid gap-1.5">
      {items.map((item, index) => (
        <li
          key={index}
          className="bg-surface border-border rounded-md border p-2 font-mono text-xs"
        >
          {describeCycle(item)}
        </li>
      ))}
    </ul>
  );
}

function describeCycle(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    if (Array.isArray(record.ids)) return record.ids.map(String).join(' → ');
    if (Array.isArray(record.issues)) return record.issues.map(String).join(' → ');
  }
  return JSON.stringify(item);
}
