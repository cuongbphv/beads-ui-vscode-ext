import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Shape smoke tests over REAL bd 1.2.2 output captured in a scratch project
 * (bead beads-ui-vscode-ext-8eo.1). See src/test/fixtures/mol/README.md for
 * how each file was generated and what each previously-unverified question
 * measured. These assertions pin the structures Epic B's parsers rely on —
 * if a future bd version changes a field name, re-capture and re-pin.
 */

const dir = fileURLToPath(new URL('./fixtures/mol/', import.meta.url));

function load(name: string): unknown {
  return JSON.parse(readFileSync(`${dir}${name}`, 'utf8')) as unknown;
}

describe('mol fixtures (bd 1.2.2 captures)', () => {
  it('every fixture file parses as JSON', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const f of files) {
      expect(() => load(f), f).not.toThrow();
    }
  });

  it('bd list --type molecule: array of issue rows typed "molecule"', () => {
    const rows = load('list-type-molecule.json') as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    expect(rows[0].issue_type).toBe('molecule');
    expect(typeof rows[0].id).toBe('string');
    expect(typeof rows[0].title).toBe('string');
    expect(typeof rows[0].status).toBe('string');
    // Measured: NO mol_type field exists on 1.2.2 rows.
    expect('mol_type' in rows[0]).toBe(false);
  });

  it('--include-templates adds the proto row flagged is_template', () => {
    const rows = load('list-type-molecule-include-templates.json') as Array<
      Record<string, unknown>
    >;
    expect(rows.length).toBe(2);
    const proto = rows.find((r) => r.is_template === true);
    expect(proto).toBeDefined();
    expect(proto?.labels).toEqual(['template']);
  });

  it('bd mol progress: snake_case counters, no rate/eta emitted', () => {
    const p = load('mol-progress.json') as Record<string, unknown>;
    expect(typeof p.molecule_id).toBe('string');
    expect(typeof p.molecule_title).toBe('string');
    expect(p.total).toBe(4);
    expect(p.completed).toBe(1);
    expect(p.in_progress).toBe(1);
    expect(p.percent).toBe(25);
    expect(typeof p.current_step_id).toBe('string');
    expect(p.schema_version).toBe(1);
  });

  it('bd mol show --parallel: root/issues/dependencies + parallel analysis', () => {
    const s = load('mol-show-parallel.json') as {
      root: Record<string, unknown>;
      issues: unknown[];
      dependencies: Array<Record<string, unknown>>;
      parallel: {
        parallel_groups: Record<string, string[]>;
        steps: Record<string, Record<string, unknown>>;
        total_steps: number;
        ready_steps: number;
      };
      schema_version: number;
    };
    expect(s.root.issue_type).toBe('molecule');
    expect(s.issues.length).toBe(5);
    expect(s.parallel.total_steps).toBe(5);
    expect(Object.keys(s.parallel.parallel_groups)).toContain('group-1');
    const step = Object.values(s.parallel.steps)[0];
    for (const key of ['step_id', 'status', 'is_ready', 'parallel_group', 'blocked_by', 'blocks']) {
      expect(key in step, key).toBe(true);
    }
    expect(s.dependencies.every((d) => d.type === 'parent-child' || d.type === 'blocks')).toBe(
      true
    );
  });

  it('bd mol current: array of {current_step, next_step, steps[], completed, total}', () => {
    const rows = load('mol-current.json') as Array<{
      molecule_id: string;
      current_step: { id: string };
      next_step: { id: string };
      steps: Array<{ issue: { id: string }; status: string; is_current: boolean }>;
      completed: number;
      total: number;
    }>;
    expect(Array.isArray(rows)).toBe(true);
    const m = rows[0];
    expect(typeof m.molecule_id).toBe('string');
    expect(typeof m.current_step.id).toBe('string');
    expect(m.completed).toBe(1);
    expect(m.total).toBe(4);
    const states = new Set(m.steps.map((s) => s.status));
    // Measured on 1.2.2: gate-blocked steps still report "ready"; only these
    // four states were observable ("blocked" never appeared).
    expect(states).toEqual(new Set(['done', 'ready', 'current', 'pending']));
    expect(m.steps.filter((s) => s.is_current).length).toBe(1);
  });

  it('bd mol wisp list: {count, wisps[]} — rows use "type", never wisp_type', () => {
    const w = load('wisp-list.json') as {
      count: number;
      schema_version: number;
      wisps: Array<Record<string, unknown>>;
    };
    expect(w.count).toBe(5);
    expect(w.wisps.length).toBe(w.count);
    const root = w.wisps.find((r) => r.type === 'molecule');
    expect(root).toBeDefined();
    for (const row of w.wisps) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.status).toBe('string');
      expect('wisp_type' in row).toBe(false);
    }
  });

  it('bd mol stale: populated stale_molecules rows carry child counters', () => {
    const s = load('mol-stale.json') as {
      total_count: number;
      blocking_count: number;
      stale_molecules: Array<Record<string, unknown>>;
    };
    expect(s.total_count).toBe(1);
    const row = s.stale_molecules[0];
    expect(typeof row.id).toBe('string');
    expect(row.total_children).toBe(1);
    expect(row.closed_children).toBe(1);
    expect(typeof row.blocking_count).toBe('number');
  });

  it('bd gate list: await_type always; await_id/timeout per gate type; no waiters', () => {
    const gates = load('gate-list.json') as Array<Record<string, unknown>>;
    expect(gates.length).toBe(3);
    const byAwait = new Map(gates.map((g) => [g.await_type as string, g]));
    expect([...byAwait.keys()].sort()).toEqual(['gh:pr', 'human', 'timer']);
    for (const g of gates) {
      expect(g.issue_type).toBe('gate');
      expect(g.status).toBe('open');
      expect('waiters' in g).toBe(false);
    }
    expect(byAwait.get('gh:pr')?.await_id).toBe('42');
    // Measured: timeout is Go nanoseconds (2h).
    expect(byAwait.get('timer')?.timeout).toBe(7_200_000_000_000);
    expect('timeout' in (byAwait.get('human') ?? {})).toBe(false);
    expect('await_id' in (byAwait.get('human') ?? {})).toBe(false);
  });

  it('bd gate show: single object, same fields + schema_version, no waiters', () => {
    for (const [file, awaitType] of [
      ['gate-show-human.json', 'human'],
      ['gate-show-timer.json', 'timer'],
      ['gate-show-ghpr.json', 'gh:pr'],
    ] as const) {
      const g = load(file) as Record<string, unknown>;
      expect(g.await_type, file).toBe(awaitType);
      expect(g.schema_version, file).toBe(1);
      expect('waiters' in g, file).toBe(false);
    }
  });

  it('resolved gates appear only in gate list --all, closed with closed_at', () => {
    const all = load('gate-list-all-with-resolved.json') as Array<Record<string, unknown>>;
    const resolved = all.find((g) => g.status === 'closed');
    expect(resolved).toBeDefined();
    expect(typeof resolved?.closed_at).toBe('string');
    const open = load('gate-list.json') as Array<Record<string, unknown>>;
    expect(open.every((g) => g.status === 'open')).toBe(true);
  });

  it('watermark: plain bd list --all contains mol issues but NO wisps or gates', () => {
    const rows = load('list-all.json') as Array<Record<string, unknown>>;
    // Captured with 1 poured mol (5 issues), 1 wisp (5 issues), 1 proto and
    // 3 gates in the DB — only the 5 persistent molecule issues surface.
    expect(rows.length).toBe(5);
    expect(rows.some((r) => r.issue_type === 'molecule')).toBe(true);
    expect(rows.some((r) => r.issue_type === 'gate')).toBe(false);
    expect(rows.some((r) => (r.id as string).includes('-wisp-'))).toBe(false);

    const top = load('list-watermark.json') as Array<Record<string, unknown>>;
    expect(top.length).toBe(1);
    // Gates were updated AFTER this row, yet a task row tops --sort updated:
    // gate writes do not move the plain-list watermark.
    expect(top[0].issue_type).toBe('task');
  });
});
