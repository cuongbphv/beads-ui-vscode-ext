/**
 * The demo project the screenshots and the README GIF are taken against.
 *
 * The extension's own tracker is 98% closed, so every chart taken against it
 * skews Done and the product reads as finished rather than alive. "Harbor" is a
 * deliberately mid-flight project: five epics at different stages, every status
 * category populated, four people plus an agent, and a close history long enough
 * for the burn-up to have a slope.
 *
 * This module is pure — it builds records, it does not touch bd or the disk, so
 * the shape can be asserted in the unit suite. `seed-demo-workspace.mjs` feeds
 * the output to `bd import`, which is the only field format that preserves
 * `created_at` / `closed_at` / `due_at`: `bd create` would stamp every close
 * with today and flatten the burn-up into a single point.
 *
 * Day offsets are relative to the seed date, so a workspace seeded six months
 * from now still looks like a project that is happening right now.
 */

/** Assignees. `claude-code` is real: this is what an agent-filed bead looks like. */
const CUONG = 'cuong';
const MAI = 'mai';
const LINH = 'linh';
const AGENT = 'claude-code';

/**
 * The project, as a flat table. `parent` is the epic id; `blockedBy` becomes a
 * `blocks` edge so `bd ready` and `bd blocked` return something real.
 *
 * Offsets are days from the seed date: negative is past, positive is future.
 */
const ISSUES = [
  // ── Epics ────────────────────────────────────────────────────────────────
  {
    id: 'harbor-1',
    title: 'Auth & onboarding',
    type: 'epic',
    status: 'closed',
    priority: 1,
    assignee: CUONG,
    labels: ['auth'],
    created: -58,
    started: -56,
    closed: -19,
    due: -18,
    description: 'Everything between "I have a repo" and "I have a running deploy".',
  },
  {
    id: 'harbor-2',
    title: 'Realtime deploy log streaming',
    type: 'epic',
    status: 'in_progress',
    priority: 0,
    assignee: MAI,
    labels: ['realtime'],
    created: -40,
    started: -22,
    due: 16,
    description:
      'Tail a running build the way you would tail a file — no polling, no refresh button.',
  },
  {
    id: 'harbor-3',
    title: 'Billing & plan limits',
    type: 'epic',
    status: 'in_progress',
    priority: 1,
    assignee: CUONG,
    labels: ['billing'],
    created: -34,
    started: -9,
    due: 34,
    description: 'Charge for the thing. Enforce the limits the plans claim to enforce.',
  },
  {
    id: 'harbor-4',
    title: 'Mobile & responsive polish',
    type: 'epic',
    status: 'open',
    priority: 3,
    labels: ['ui'],
    created: -21,
    due: 27,
    description: 'The dashboard is used from a phone far more often than we designed for.',
  },
  {
    id: 'harbor-5',
    title: 'Platform hardening',
    type: 'epic',
    status: 'in_progress',
    priority: 1,
    assignee: LINH,
    labels: ['platform'],
    created: -45,
    started: -30,
    due: 21,
    description: 'The unglamorous half: workers, queues, keys and upgrades.',
  },

  // ── Epic 1 · Auth & onboarding (shipped) ─────────────────────────────────
  {
    id: 'harbor-101',
    title: 'Email + password sign-in',
    type: 'feature',
    status: 'closed',
    priority: 1,
    assignee: MAI,
    parent: 'harbor-1',
    labels: ['auth'],
    created: -57,
    started: -55,
    closed: -47,
    estimate: 720,
  },
  {
    id: 'harbor-102',
    title: 'GitHub OAuth sign-in',
    type: 'feature',
    status: 'closed',
    priority: 1,
    assignee: MAI,
    parent: 'harbor-1',
    labels: ['auth'],
    created: -57,
    started: -46,
    closed: -38,
    estimate: 600,
  },
  {
    id: 'harbor-103',
    title: 'Session cookie hardening (SameSite, rotation)',
    type: 'task',
    status: 'closed',
    priority: 1,
    assignee: LINH,
    parent: 'harbor-1',
    labels: ['auth', 'security', 'needs-human'],
    created: -50,
    started: -37,
    closed: -34,
    estimate: 240,
  },
  {
    id: 'harbor-104',
    title: 'Password reset link expires immediately',
    type: 'bug',
    status: 'closed',
    priority: 0,
    assignee: MAI,
    parent: 'harbor-1',
    labels: ['auth', 'needs-human'],
    created: -36,
    started: -35,
    closed: -35,
    estimate: 90,
    description: 'The TTL was read as seconds and written as milliseconds.',
  },
  {
    id: 'harbor-105',
    title: 'ADR-001: session store — Redis over stateless JWT',
    type: 'decision',
    status: 'closed',
    priority: 2,
    assignee: CUONG,
    parent: 'harbor-1',
    labels: ['auth', 'adr'],
    created: -54,
    closed: -49,
    description:
      'Revocation is a hard requirement for the enterprise plan, and a stateless token cannot be revoked before it expires.',
  },
  {
    id: 'harbor-106',
    title: 'Onboarding checklist on the empty dashboard',
    type: 'feature',
    status: 'closed',
    priority: 2,
    assignee: LINH,
    parent: 'harbor-1',
    labels: ['auth', 'ui'],
    created: -44,
    started: -30,
    closed: -24,
    estimate: 480,
  },
  {
    id: 'harbor-107',
    title: 'Seed script for demo accounts',
    type: 'chore',
    status: 'closed',
    priority: 3,
    assignee: AGENT,
    parent: 'harbor-1',
    labels: ['auth', 'tooling', 'auto-ok'],
    created: -30,
    started: -21,
    closed: -19,
    estimate: 120,
  },

  // ── Epic 2 · Realtime deploy log streaming (in flight) ────────────────────
  {
    id: 'harbor-201',
    title: 'Stream build logs over SSE',
    type: 'feature',
    status: 'in_progress',
    priority: 0,
    assignee: MAI,
    parent: 'harbor-2',
    labels: ['realtime', 'api', 'auto-partial'],
    created: -28,
    started: -6,
    due: 5,
    estimate: 960,
    description:
      'The build log is written to object storage in 4 KB chunks. The viewer currently polls that object every 2 seconds, which is both slow and expensive. Push the chunks instead.',
    design:
      'Server-Sent Events, not WebSockets: the stream is one-directional and SSE survives proxies that strip Upgrade headers. One event per chunk, `id:` carrying the byte offset so a reconnect can resume with Last-Event-ID.',
    acceptance:
      'A running build renders new output within 500 ms. Killing the connection and reconnecting loses no lines. 500 concurrent tails hold under one worker.',
  },
  {
    id: 'harbor-202',
    title: 'Reconnect and backfill the lines missed while offline',
    type: 'feature',
    status: 'blocked',
    priority: 1,
    assignee: MAI,
    parent: 'harbor-2',
    labels: ['realtime', 'needs-human'],
    created: -28,
    due: 11,
    estimate: 480,
    blockedBy: ['harbor-201'],
    description: 'Laptop lid closes, connection drops, the user misses the failure they were watching for.',
  },
  {
    id: 'harbor-203',
    title: 'Per-service filter in the log viewer',
    type: 'feature',
    status: 'open',
    priority: 2,
    parent: 'harbor-2',
    labels: ['realtime', 'ui'],
    created: -20,
    due: 18,
    estimate: 360,
  },
  {
    id: 'harbor-204',
    title: 'Viewer drops lines once the buffer passes 10k',
    type: 'bug',
    status: 'open',
    priority: 1,
    assignee: LINH,
    parent: 'harbor-2',
    labels: ['realtime', 'ui'],
    created: -11,
    due: 3,
    estimate: 240,
    description: 'The virtualised list evicts from the wrong end, so the newest output is the output that disappears.',
  },
  {
    id: 'harbor-205',
    title: 'Load-test the stream endpoint at 500 concurrent tails',
    type: 'task',
    status: 'open',
    priority: 2,
    assignee: AGENT,
    parent: 'harbor-2',
    labels: ['realtime', 'perf'],
    created: -9,
    due: 13,
    estimate: 300,
    blockedBy: ['harbor-201'],
  },
  {
    id: 'harbor-206',
    title: 'Do we need a broker for fan-out, or is per-pod fan-out enough?',
    type: 'spike',
    status: 'closed',
    priority: 1,
    assignee: CUONG,
    parent: 'harbor-2',
    labels: ['realtime', 'spike', 'auto-ok'],
    created: -33,
    started: -31,
    closed: -27,
    estimate: 480,
    description:
      'Answer: per-pod is enough to 2k concurrent tails. Revisit at 10k — the note is in the ADR.',
  },
  {
    id: 'harbor-207',
    title: 'Log retention policy and the pruning job',
    type: 'task',
    status: 'deferred',
    priority: 3,
    parent: 'harbor-2',
    labels: ['realtime', 'ops'],
    created: -18,
    defer: 24,
    estimate: 420,
    description: 'Nothing is being pruned yet, and nothing needs to be until the first month of retention is up.',
  },
  {
    id: 'harbor-208',
    title: 'Download the whole log as a file',
    type: 'feature',
    status: 'open',
    priority: 3,
    parent: 'harbor-2',
    labels: ['realtime'],
    created: -14,
    due: 22,
    estimate: 180,
  },
  {
    id: 'harbor-209',
    title: 'Instrument stream latency (p50/p95) in the dashboard',
    type: 'task',
    status: 'closed',
    priority: 2,
    assignee: AGENT,
    parent: 'harbor-2',
    labels: ['realtime', 'observability', 'auto-ok'],
    created: -16,
    started: -13,
    closed: -8,
    estimate: 240,
  },
  {
    id: 'harbor-210',
    title: 'SSE connections leak when the tab closes',
    type: 'bug',
    status: 'in_progress',
    priority: 0,
    assignee: LINH,
    parent: 'harbor-2',
    labels: ['realtime', 'ops', 'auto-partial'],
    created: -7,
    started: -2,
    due: -1,
    estimate: 180,
    description:
      'Every abandoned tab holds a worker slot until the build finishes. Two afternoons of demos exhausted the pool.',
  },

  // ── Epic 3 · Billing & plan limits (just started) ─────────────────────────
  {
    id: 'harbor-301',
    title: 'ADR-002: Stripe Billing vs. our own metered invoices',
    type: 'decision',
    status: 'closed',
    priority: 1,
    assignee: CUONG,
    parent: 'harbor-3',
    labels: ['billing', 'adr'],
    created: -33,
    closed: -12,
    description: 'Stripe Billing. We are not in the tax-compliance business.',
  },
  {
    id: 'harbor-302',
    title: 'Plan selection and checkout',
    type: 'feature',
    status: 'in_progress',
    priority: 1,
    assignee: CUONG,
    parent: 'harbor-3',
    labels: ['billing', 'auto-partial'],
    created: -30,
    started: -4,
    due: 19,
    estimate: 1200,
  },
  {
    id: 'harbor-303',
    title: 'Enforce concurrent-build limits per plan',
    type: 'feature',
    status: 'open',
    priority: 1,
    parent: 'harbor-3',
    labels: ['billing', 'platform'],
    created: -30,
    due: 26,
    estimate: 720,
    blockedBy: ['harbor-302'],
  },
  {
    id: 'harbor-304',
    title: 'Webhook handler for subscription lifecycle events',
    type: 'task',
    status: 'open',
    priority: 2,
    assignee: AGENT,
    parent: 'harbor-3',
    labels: ['billing', 'api'],
    created: -25,
    due: 21,
    estimate: 480,
  },
  {
    id: 'harbor-305',
    title: 'Stripe test fixtures for the e2e suite',
    type: 'chore',
    status: 'open',
    priority: 3,
    parent: 'harbor-3',
    labels: ['billing', 'tooling'],
    created: -20,
    due: 29,
    estimate: 240,
  },
  {
    id: 'harbor-306',
    title: 'As an owner, I can see what I will be charged this month',
    type: 'story',
    status: 'open',
    priority: 2,
    assignee: MAI,
    parent: 'harbor-3',
    labels: ['billing', 'ui'],
    created: -15,
    due: 31,
    estimate: 600,
  },
  {
    id: 'harbor-307',
    title: 'Trial banner still shows for paying customers',
    type: 'bug',
    status: 'open',
    priority: 2,
    assignee: MAI,
    parent: 'harbor-3',
    labels: ['billing', 'ui'],
    created: -5,
    due: 7,
    estimate: 60,
  },

  // ── Epic 4 · Mobile & responsive polish (not started) ─────────────────────
  {
    id: 'harbor-401',
    title: 'Deploy list collapses to cards under 640px',
    type: 'task',
    status: 'open',
    priority: 2,
    assignee: LINH,
    parent: 'harbor-4',
    labels: ['ui', 'mobile'],
    created: -19,
    due: 17,
    estimate: 480,
  },
  {
    id: 'harbor-402',
    title: 'Sticky header covers the first row on iOS Safari',
    type: 'bug',
    status: 'open',
    priority: 2,
    parent: 'harbor-4',
    labels: ['ui', 'mobile'],
    created: -13,
    due: 20,
    estimate: 120,
  },
  {
    id: 'harbor-403',
    title: 'Swipe a deploy to roll it back',
    type: 'feature',
    status: 'deferred',
    priority: 4,
    parent: 'harbor-4',
    labels: ['ui', 'mobile'],
    created: -12,
    defer: 17,
    estimate: 600,
    description: 'Parked until someone asks for it twice.',
  },
  {
    id: 'harbor-404',
    title: 'Audit tap targets against WCAG 2.5.5',
    type: 'chore',
    status: 'open',
    priority: 3,
    assignee: AGENT,
    parent: 'harbor-4',
    labels: ['ui', 'a11y'],
    created: -10,
    due: 24,
    estimate: 180,
  },
  {
    id: 'harbor-405',
    title: 'Dark-mode contrast pass on the deploy timeline',
    type: 'task',
    status: 'open',
    priority: 4,
    parent: 'harbor-4',
    labels: ['ui', 'a11y'],
    created: -8,
    due: 32,
    estimate: 240,
  },

  // ── Epic 5 · Platform hardening ───────────────────────────────────────────
  {
    id: 'harbor-501',
    title: 'Upgrade Node 20 → 22 across every service',
    type: 'chore',
    status: 'closed',
    priority: 2,
    assignee: AGENT,
    parent: 'harbor-5',
    labels: ['platform', 'auto-ok'],
    created: -44,
    started: -29,
    closed: -22,
    estimate: 360,
  },
  {
    id: 'harbor-502',
    title: 'Deploy queue stalls when a worker dies mid-build',
    type: 'bug',
    status: 'blocked',
    priority: 0,
    assignee: CUONG,
    parent: 'harbor-5',
    labels: ['platform', 'ops', 'needs-human'],
    created: -17,
    due: 6,
    estimate: 480,
    blockedBy: ['harbor-505'],
    description:
      'The lease is never released, so the queue waits forever on a worker that is not coming back. Needs the health check before it can be fixed properly.',
  },
  {
    id: 'harbor-503',
    title: 'Structured logging for the scheduler',
    type: 'task',
    status: 'closed',
    priority: 2,
    assignee: MAI,
    parent: 'harbor-5',
    labels: ['platform', 'observability'],
    created: -40,
    started: -26,
    closed: -16,
    estimate: 300,
  },
  {
    id: 'harbor-504',
    title: 'Can we run builds on ARM runners?',
    type: 'spike',
    status: 'open',
    priority: 2,
    assignee: CUONG,
    parent: 'harbor-5',
    labels: ['platform', 'spike'],
    created: -6,
    due: 10,
    estimate: 480,
  },
  {
    id: 'harbor-505',
    title: 'Health-check endpoint for build workers',
    type: 'task',
    status: 'in_progress',
    priority: 1,
    assignee: LINH,
    parent: 'harbor-5',
    labels: ['platform', 'ops', 'auto-partial'],
    created: -17,
    started: -3,
    due: 2,
    estimate: 360,
  },
  {
    id: 'harbor-506',
    title: 'Rotate the deploy signing key every 90 days',
    type: 'chore',
    status: 'pinned',
    priority: 1,
    assignee: CUONG,
    parent: 'harbor-5',
    labels: ['platform', 'security'],
    created: -38,
    description: 'Standing item. Pinned so it never falls off the list.',
  },
  {
    id: 'harbor-507',
    title: 'Rollback picks the wrong artifact when two deploys share a SHA',
    type: 'bug',
    status: 'open',
    priority: 1,
    parent: 'harbor-5',
    labels: ['platform'],
    created: -9,
    due: -3,
    estimate: 300,
  },
  {
    id: 'harbor-508',
    title: 'Backfill the audit log for pre-2026 deploys',
    type: 'task',
    status: 'deferred',
    priority: 4,
    parent: 'harbor-5',
    labels: ['platform'],
    created: -26,
    defer: 30,
    estimate: 600,
  },
  {
    id: 'harbor-509',
    title: 'Prune stale preview environments nightly',
    type: 'chore',
    status: 'closed',
    priority: 3,
    assignee: AGENT,
    parent: 'harbor-5',
    labels: ['platform', 'ops'],
    created: -24,
    started: -14,
    closed: -5,
    estimate: 240,
  },

  // ── Unparented: the triage pile every project actually has ────────────────
  {
    id: 'harbor-601',
    title: 'Docs: the quickstart curl example 404s',
    type: 'bug',
    status: 'open',
    priority: 3,
    labels: ['docs'],
    created: -4,
    estimate: 30,
  },
  {
    id: 'harbor-602',
    title: 'CLI: `harbor tail` to follow a deploy from the terminal',
    type: 'feature',
    status: 'open',
    priority: 2,
    labels: ['cli'],
    created: -3,
    due: 25,
    estimate: 720,
  },
  {
    id: 'harbor-603',
    title: 'Answer the RFC thread about self-hosted runners',
    type: 'task',
    status: 'open',
    priority: 3,
    created: -2,
    due: 4,
    estimate: 60,
  },
];

/** Local midnight + `hour`, `offset` days from `base`. */
function at(base, offset, hour) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, hour, 0, 0, 0);
  return date.toISOString();
}

/**
 * An hour of the working day for this issue, so timestamps do not all land on
 * the same minute. Derived from the id rather than from a random source:
 * re-seeding the same workspace twice produces byte-identical data.
 *
 * `step` walks the lifecycle forward — created, started, closed — which keeps
 * the three in order even when two of them fall on the same day.
 */
function hourFor(id, step) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 997;
  return 9 + (hash % 6) + step; // 09:00–16:00
}

/**
 * Build the JSONL records `bd import` accepts.
 *
 * @param {Date} [seedDate] Anchor for every relative offset. Defaults to now.
 * @returns {object[]} one object per issue, in import order
 */
export function buildDemoIssues(seedDate = new Date()) {
  const blockedByFor = new Map();
  for (const issue of ISSUES) {
    if (issue.blockedBy) blockedByFor.set(issue.id, issue.blockedBy);
  }

  return ISSUES.map((issue) => {
    const created = at(seedDate, issue.created, hourFor(issue.id, 0));
    const started =
      issue.started === undefined ? undefined : at(seedDate, issue.started, hourFor(issue.id, 1));
    const closed =
      issue.closed === undefined ? undefined : at(seedDate, issue.closed, hourFor(issue.id, 2));
    const due = issue.due === undefined ? undefined : at(seedDate, issue.due, 17);
    const defer = issue.defer === undefined ? undefined : at(seedDate, issue.defer, 9);

    // The importer only overwrites an existing row when `updated_at` is newer,
    // so it has to be the latest thing that happened to the issue.
    const updated = closed ?? started ?? created;

    const dependencies = [];
    if (issue.parent) {
      dependencies.push({ issue_id: issue.id, depends_on_id: issue.parent, type: 'parent-child' });
    }
    for (const blocker of blockedByFor.get(issue.id) ?? []) {
      dependencies.push({ issue_id: issue.id, depends_on_id: blocker, type: 'blocks' });
    }

    const record = {
      id: issue.id,
      title: issue.title,
      issue_type: issue.type,
      status: issue.status,
      priority: issue.priority,
      created_at: created,
      updated_at: updated,
      created_by: issue.assignee ?? CUONG,
    };

    if (issue.description) record.description = issue.description;
    if (issue.design) record.design = issue.design;
    if (issue.acceptance) record.acceptance_criteria = issue.acceptance;
    if (issue.assignee) record.assignee = issue.assignee;
    if (issue.labels) record.labels = issue.labels;
    if (started) record.started_at = started;
    if (closed) {
      record.closed_at = closed;
      record.close_reason = 'Done';
    }
    if (due) record.due_at = due;
    if (defer) record.defer_until = defer;
    if (issue.estimate) record.estimated_minutes = issue.estimate;
    if (dependencies.length > 0) record.dependencies = dependencies;

    return record;
  });
}

/** `buildDemoIssues` as a JSONL string, ready for `bd import`. */
export function buildDemoJsonl(seedDate = new Date()) {
  return `${buildDemoIssues(seedDate)
    .map((record) => JSON.stringify(record))
    .join('\n')}\n`;
}

/** Counts by status / type / assignee — what the seeder prints and the test asserts. */
export function demoSummary(seedDate = new Date()) {
  const issues = buildDemoIssues(seedDate);
  const tally = (key) =>
    issues.reduce((acc, issue) => {
      const value = issue[key] ?? '(unassigned)';
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});

  return {
    total: issues.length,
    byStatus: tally('status'),
    byType: tally('issue_type'),
    byAssignee: tally('assignee'),
    closedSpanDays: (() => {
      const closed = issues.filter((i) => i.closed_at).map((i) => Date.parse(i.closed_at));
      if (closed.length === 0) return 0;
      return Math.round((Math.max(...closed) - Math.min(...closed)) / 86_400_000);
    })(),
  };
}

export const DEMO_PREFIX = 'harbor';

/** Who the person taking the screenshot is, for the sidebar's Needs You section. */
export const DEMO_ACTOR = CUONG;
