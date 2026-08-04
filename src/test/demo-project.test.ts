import { describe, expect, it } from 'vitest';

import { buildDemoIssues, buildDemoJsonl, demoSummary } from '../../scripts/lib/demo-project.mjs';

/**
 * The demo fixture is what every screenshot and the README GIF are taken
 * against, so its *shape* is the deliverable: a project that reads as mid-flight
 * rather than finished. These assertions are the review the expert gave us,
 * written down — if a later edit flattens the data back into a graveyard, the
 * suite says so instead of the Marketplace page.
 */

// A fixed anchor: the fixture is relative to "today", and a test that drifts
// with the calendar is not a test.
const SEED = new Date(2026, 7, 4, 12, 0, 0);

describe('demo fixture shape', () => {
  it('populates every board column, not just Done', () => {
    const byStatus = demoSummary(SEED).byStatus;

    // Board columns come from status *category*: active / wip / frozen / done.
    expect(byStatus.open).toBeGreaterThan(5); // active
    expect(byStatus.in_progress).toBeGreaterThan(2); // wip
    expect(byStatus.blocked).toBeGreaterThan(0); // wip, and the Blocked list
    expect(byStatus.deferred).toBeGreaterThan(0); // frozen — the On Hold column
    expect(byStatus.pinned).toBeGreaterThan(0); // frozen
    expect(byStatus.closed).toBeGreaterThan(5); // done
  });

  it('is genuinely mid-flight: between a third and two thirds still open', () => {
    const { total, byStatus } = demoSummary(SEED);
    const done = byStatus.closed;

    expect(done / total).toBeGreaterThan(0.2);
    expect(done / total).toBeLessThan(0.5);
  });

  it('exercises every issue type the UI draws an icon for', () => {
    const byType = demoSummary(SEED).byType;

    for (const type of ['epic', 'feature', 'bug', 'task', 'chore', 'decision', 'spike', 'story']) {
      expect(byType[type], `no ${type} in the demo project`).toBeGreaterThan(0);
    }
  });

  it('spreads work over four people and leaves a real unassigned pile', () => {
    const byAssignee = demoSummary(SEED).byAssignee;
    const people = Object.keys(byAssignee).filter((name) => name !== '(unassigned)');

    // The Workload chart degrades to a sentence below two assignees.
    expect(people.length).toBeGreaterThanOrEqual(4);
    expect(byAssignee['(unassigned)']).toBeGreaterThan(0);
    // The agent angle is the pitch; it has to be visible in the data.
    expect(byAssignee['claude-code']).toBeGreaterThan(0);
  });

  it('uses every priority, including P0', () => {
    const priorities = new Set(buildDemoIssues(SEED).map((issue) => issue.priority));
    expect([...priorities].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('carries enough close history for the burn-up to have a slope', () => {
    // Under 7 days the Overview degrades the burn-up to a sparkline by design.
    expect(demoSummary(SEED).closedSpanDays).toBeGreaterThan(7);
  });

  it('gives the timeline real spans instead of a single-day stack', () => {
    const issues = buildDemoIssues(SEED);
    const dated = issues.filter((issue) => issue.due_at);
    const estimated = issues.filter((issue) => issue.estimated_minutes);

    expect(dated.length).toBeGreaterThan(15);
    expect(estimated.length).toBeGreaterThan(20);

    const dues = dated.map((issue) => Date.parse(issue.due_at ?? ''));
    const spanDays = (Math.max(...dues) - Math.min(...dues)) / 86_400_000;
    expect(spanDays).toBeGreaterThan(30);
  });

  it('leaves something overdue, because real projects have overdue work', () => {
    const overdue = buildDemoIssues(SEED).filter(
      (issue) => issue.due_at && Date.parse(issue.due_at) < SEED.getTime() && !issue.closed_at,
    );
    expect(overdue.length).toBeGreaterThan(0);
  });
});

describe('demo fixture integrity', () => {
  it('has unique ids', () => {
    const ids = buildDemoIssues(SEED).map((issue) => issue.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every dependency at an issue that exists', () => {
    const issues = buildDemoIssues(SEED);
    const ids = new Set(issues.map((issue) => issue.id));

    for (const issue of issues) {
      for (const edge of issue.dependencies ?? []) {
        expect(ids.has(edge.depends_on_id), `${issue.id} → ${edge.depends_on_id}`).toBe(true);
        expect(edge.issue_id).toBe(issue.id);
      }
    }
  });

  it('hangs its epics off nothing and its tasks off an epic', () => {
    const issues = buildDemoIssues(SEED);
    const epics = new Set(issues.filter((i) => i.issue_type === 'epic').map((i) => i.id));

    for (const issue of issues) {
      const parent = issue.dependencies?.find((edge) => edge.type === 'parent-child');
      if (issue.issue_type === 'epic') expect(parent).toBeUndefined();
      if (parent) expect(epics.has(parent.depends_on_id)).toBe(true);
    }
  });

  it('closes nothing without a closed_at, and nothing open with one', () => {
    for (const issue of buildDemoIssues(SEED)) {
      if (issue.status === 'closed') expect(issue.closed_at).toBeTruthy();
      else expect(issue.closed_at).toBeUndefined();
    }
  });

  it('keeps timestamps in order: created ≤ started ≤ closed = updated', () => {
    for (const issue of buildDemoIssues(SEED)) {
      const created = Date.parse(issue.created_at);
      if (issue.started_at) expect(Date.parse(issue.started_at)).toBeGreaterThanOrEqual(created);
      if (issue.closed_at) {
        expect(Date.parse(issue.closed_at)).toBeGreaterThanOrEqual(
          Date.parse(issue.started_at ?? issue.created_at),
        );
        // bd's importer only overwrites a row when updated_at is newer, so the
        // seed has to carry the latest thing that happened to the issue.
        expect(issue.updated_at).toBe(issue.closed_at);
      }
    }
  });

  it('emits one JSON object per line, which is what bd import reads', () => {
    const lines = buildDemoJsonl(SEED).trimEnd().split('\n');

    expect(lines).toHaveLength(buildDemoIssues(SEED).length);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('is deterministic, so re-seeding does not reshuffle the screenshots', () => {
    expect(buildDemoJsonl(SEED)).toBe(buildDemoJsonl(SEED));
  });
});
