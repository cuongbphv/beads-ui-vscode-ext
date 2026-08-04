/**
 * The Overview's charts.
 *
 * Every colour is a CSS variable from the theme, so the charts follow the
 * editor between light and dark without a second palette. Recharts renders SVG
 * only — no canvas, no remote assets, nothing the webview CSP would block.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';

import { StatusIndex, parentIdOf } from '../../shared/model';
import {
  CATEGORY_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  typeStyle,
  type Bead,
  type StatusCategory,
} from '../../shared/types';
import {
  burnUpSeries,
  type BurnUpDensity,
  type WorkloadDensity,
} from '../lib/chart-density';
import { shortDate } from '../lib/utils';

/**
 * Every series colour comes from the editor's own categorical chart palette
 * (see `--color-chart-*` in globals.css), so a chart never fights the theme.
 */
const CATEGORY_COLORS: Record<StatusCategory, string> = {
  active: 'var(--color-chart-blue)',
  wip: 'var(--color-chart-orange)',
  frozen: 'var(--color-chart-neutral)',
  done: 'var(--color-chart-green)',
  unspecified: 'var(--color-chart-purple)',
};

/** Shared axis/tooltip styling so five charts cannot drift apart. */
const AXIS = {
  stroke: 'var(--color-fg-muted)',
  fontSize: 11,
  tickLine: false,
} as const;

/**
 * Recharts renders legend labels as bare text nodes that inherit `fill`, not the
 * theme's foreground, so on a dark editor they come out black. Every legend
 * therefore formats its own label.
 */
const LEGEND = {
  wrapperStyle: { fontSize: 11 },
  formatter: (value: string) => <span style={{ color: 'var(--color-fg)' }}>{value}</span>,
} as const;

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    fontSize: 12,
    color: 'var(--color-fg)',
  },
  labelStyle: { color: 'var(--color-fg-strong)' },
  cursor: { fill: 'var(--color-surface-hover)' },
} as const;

/**
 * A chart is a picture; this is the same information as a sentence.
 *
 * The SVG is hidden from assistive tech (recharts emits hundreds of unlabelled
 * shape nodes) and this line is announced in its place.
 */
function Summary({ text }: { text: string }): ReactNode {
  return <p className="sr-only">{text}</p>;
}

function counted(entries: Array<[string, number]>): string {
  return entries.length === 0
    ? 'no data'
    : entries.map(([name, value]) => `${name}: ${value}`).join(', ');
}

export function ChartCard({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <section
      aria-label={title}
      className={`bg-surface border-border surface-interactive hover:border-border-strong rounded-lg border p-3 ${className ?? ''}`}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-fg-strong text-sm font-medium">{title}</h2>
        {hint ? <span className="text-fg-muted text-xs">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Status mix, as a donut with the done-percentage in the middle. */
export function StatusDonut({
  beads,
  index,
}: {
  beads: Bead[];
  index: StatusIndex;
}): ReactNode {
  const counts = new Map<StatusCategory, number>();
  for (const bead of beads) {
    const category = index.category(bead.status);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const data = [...counts.entries()]
    .filter(([, value]) => value > 0)
    .map(([category, value]) => ({
      name: CATEGORY_LABELS[category],
      value,
      fill: CATEGORY_COLORS[category],
    }));

  const done = counts.get('done') ?? 0;
  const percent = beads.length ? Math.round((done / beads.length) * 100) : 0;

  return (
    <div className="relative h-52">
      <Summary
        text={`${beads.length} issues, ${percent}% done. ${counted(
          data.map((entry) => [entry.name, entry.value]),
        )}.`}
      />
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="var(--color-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend verticalAlign="bottom" height={24} {...LEGEND} />
        </PieChart>
      </ResponsiveContainer>
      {/* The headline number sits in the hole rather than in a caption. */}
      <div className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
        <p className="text-fg-strong text-2xl leading-none font-semibold tabular-nums">{percent}%</p>
        <p className="text-fg-muted text-xs">done</p>
      </div>
    </div>
  );
}

/** How the backlog is weighted, P0 through P4, split open vs done. */
export function PriorityChart({
  beads,
  index,
}: {
  beads: Bead[];
  index: StatusIndex;
}): ReactNode {
  const data = [0, 1, 2, 3, 4].map((priority) => {
    const inBucket = beads.filter((bead) => bead.priority === priority);
    const closed = inBucket.filter((bead) => index.isDone(bead.status)).length;
    return {
      name: PRIORITY_LABELS[priority].split(' · ')[0],
      open: inBucket.length - closed,
      done: closed,
      // Deliberately not named `fill`: recharts lets a data row's `fill` win
      // over a Bar's own, so a `fill` here would tint the *done* segment with
      // the priority hue too — which is what made P1 read as brown.
      barColor: PRIORITY_COLORS[priority],
    };
  });

  return (
    <div className="h-52">
      <Summary
        text={`Open work by priority. ${counted(data.map((entry) => [entry.name, entry.open]))}.`}
      />
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <XAxis dataKey="name" {...AXIS} axisLine={false} />
          <YAxis {...AXIS} axisLine={false} allowDecimals={false} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend {...LEGEND} />
          {/* `fill` is only for the legend swatch; each bar's Cell overrides it. */}
          <Bar
            dataKey="open"
            stackId="a"
            fill="var(--color-chart-blue)"
            radius={[0, 0, 0, 0]}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.barColor} />
            ))}
          </Bar>
          {/* Closed work stays visible but recedes: muted fill, not background. */}
          <Bar
            dataKey="done"
            stackId="a"
            fill="var(--color-chart-neutral)"
            fillOpacity={0.35}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Which kinds of work the project is made of. */
export function TypeChart({ beads }: { beads: Bead[] }): ReactNode {
  const counts = new Map<string, number>();
  for (const bead of beads) counts.set(bead.issue_type, (counts.get(bead.issue_type) ?? 0) + 1);

  const data = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, value]) => ({ name: type, value, fill: typeStyle(type).color }));

  return (
    <div className="h-52">
      <Summary text={`Issues by type. ${counted(data.map((entry) => [entry.name, entry.value]))}.`} />
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
          <XAxis type="number" {...AXIS} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={70} {...AXIS} axisLine={false} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Cumulative closed issues over time — the honest measure of progress.
 * Built from `closed_at`, so it needs no extra bookkeeping.
 */
export function BurnUpChart({
  beads,
  index,
  density,
}: {
  beads: Bead[];
  index: StatusIndex;
  /** Whether the data has earned a full-height chart — see lib/chart-density. */
  density: BurnUpDensity;
}): ReactNode {
  const series = burnUpSeries(beads, index);

  if (density.mode === 'empty' || series.length === 0) {
    return (
      <p className="text-fg-muted flex h-24 items-center justify-center text-sm">
        Nothing has been closed yet.
      </p>
    );
  }

  const data = series.map((point) => ({ ...point, label: shortDate(point.day) }));

  // A day or two of history has no curve in it. Drawing that at full height
  // spends the largest card on the page saying "a line went up once", so it
  // shrinks to a sparkline and the number carries the meaning instead.
  if (density.mode === 'sparkline') {
    return (
      <div>
        <Summary
          text={`${density.closed} of ${density.total} issues closed over ${density.spanDays} ${
            density.spanDays === 1 ? 'day' : 'days'
          }, most recently on ${data[data.length - 1].label}.`}
        />
        <div className="flex items-baseline gap-2">
          <p className="text-fg-strong text-2xl leading-none font-semibold tabular-nums">
            {density.closed}
          </p>
          <p className="text-fg-muted text-xs">
            closed over {density.spanDays} {density.spanDays === 1 ? 'day' : 'days'} — too short to
            trend
          </p>
        </div>
        <div className="mt-2 h-12" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id="burnup-spark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-chart-green)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--color-chart-green)" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="closed"
                stroke="var(--color-chart-green)"
                strokeWidth={1.5}
                fill="url(#burnup-spark)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="h-52">
      <Summary
        text={`${density.closed} of ${density.total} issues closed, first on ${data[0].label}, most recently on ${data[data.length - 1].label}.`}
      />
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="burnup" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-green)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--color-chart-green)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" {...AXIS} axisLine={false} minTickGap={24} />
          {/* Scaled to the whole backlog, so the gap above the line is the work left. */}
          <YAxis
            {...AXIS}
            axisLine={false}
            allowDecimals={false}
            domain={[0, beads.length]}
          />
          <Tooltip {...TOOLTIP_STYLE} />
          <ReferenceLine
            y={beads.length}
            stroke="var(--color-border-strong)"
            strokeDasharray="4 4"
            label={{ value: 'all issues', position: 'insideTopRight', fontSize: 10, fill: 'var(--color-fg-muted)' }}
          />
          <Area
            type="monotone"
            dataKey="closed"
            stroke="var(--color-chart-green)"
            strokeWidth={2}
            fill="url(#burnup)"
            dot={{ r: 2, fill: 'var(--color-chart-green)', stroke: 'none' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Who is carrying what — open work per assignee, unassigned included.
 *
 * A distribution needs something to distribute. With one person, or nobody, the
 * bar chart is a single bar restating a number the stat cards already gave you,
 * so those cases answer in a sentence instead.
 */
export function WorkloadChart({
  beads,
  index,
  density,
}: {
  beads: Bead[];
  index: StatusIndex;
  density: WorkloadDensity;
}): ReactNode {
  if (density.mode !== 'chart') {
    const message =
      density.mode === 'idle'
        ? 'No open work to distribute.'
        : density.mode === 'unowned'
          ? `${density.unassigned} open ${density.unassigned === 1 ? 'issue has' : 'issues have'} no PIC yet.`
          : `${density.assignees[0]} is carrying all ${density.open} open ${
              density.open === 1 ? 'issue' : 'issues'
            }${density.unassigned > 0 ? `, ${density.unassigned} still unassigned` : ''}.`;
    return (
      <p className="text-fg-muted flex h-24 items-center justify-center px-2 text-center text-sm">
        {message}
      </p>
    );
  }

  const counts = new Map<string, { open: number; wip: number }>();
  for (const bead of beads) {
    if (index.isDone(bead.status)) continue;
    const key = bead.assignee || 'unassigned';
    const entry = counts.get(key) ?? { open: 0, wip: 0 };
    if (index.category(bead.status) === 'wip') entry.wip += 1;
    else entry.open += 1;
    counts.set(key, entry);
  }

  const data = [...counts.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.open + b.wip - (a.open + a.wip))
    .slice(0, 8);

  return (
    <div className="h-52">
      <Summary
        text={`Open work per person. ${counted(data.map((entry) => [entry.name, entry.open + entry.wip]))}.`}
      />
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
          <XAxis type="number" {...AXIS} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={90} {...AXIS} axisLine={false} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend {...LEGEND} />
          <Bar
            dataKey="wip"
            stackId="a"
            name="in progress"
            fill="var(--color-chart-orange)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="open"
            stackId="a"
            name="open"
            fill="var(--color-chart-blue)"
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Completion per epic, so a stalled epic is visible next to a finished one. */
export function EpicProgressChart({
  beads,
  index,
}: {
  beads: Bead[];
  index: StatusIndex;
}): ReactNode {
  const epics = beads.filter((bead) => bead.issue_type === 'epic');
  const data = epics
    .map((epic) => {
      const children = beads.filter((bead) => parentIdOf(bead) === epic.id);
      const done = children.filter((child) => index.isDone(child.status)).length;
      return {
        name: epic.title.length > 22 ? `${epic.title.slice(0, 21)}…` : epic.title,
        done,
        remaining: children.length - done,
      };
    })
    .filter((entry) => entry.done + entry.remaining > 0);

  if (data.length === 0) {
    return (
      <p className="text-fg-muted flex h-24 items-center justify-center text-sm">
        No epics with children yet.
      </p>
    );
  }

  return (
    <div className="h-52">
      <Summary
        text={`Progress per epic. ${counted(
          data.map((entry) => [entry.name, entry.done] as [string, number]),
        )} done of ${counted(data.map((entry) => [entry.name, entry.done + entry.remaining]))}.`}
      />
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
          <XAxis type="number" {...AXIS} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={130} {...AXIS} axisLine={false} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend {...LEGEND} />
          <Bar
            dataKey="done"
            stackId="a"
            name="done"
            fill="var(--color-chart-green)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="remaining"
            stackId="a"
            name="remaining"
            fill="var(--color-chart-neutral)"
            fillOpacity={0.35}
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
