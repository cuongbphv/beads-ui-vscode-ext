/**
 * T405 — the states the extension has to survive rather than crash in.
 *
 * Every fixture string here was copied from a real `bd` 1.1.2 run, not invented:
 * the point of this file is that the classification keeps matching what bd
 * actually prints, so a wording change fails a test instead of silently
 * downgrading "you have no workspace" to "something went wrong".
 */
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusIndex, buildColumns, groupByEpic } from '../shared/model';
import { buildTimeline } from '../shared/schedule';
import type { Bead, StatusDef } from '../shared/types';

type ExecResult = { stdout: string; stderr: string };
type ExecImpl = (file: string, args: string[]) => Promise<ExecResult>;

let impl: ExecImpl;

vi.mock('node:child_process', () => {
  const execFile = (): never => {
    throw new Error('callback form is not used');
  };
  Object.defineProperty(execFile, promisify.custom, {
    value: (file: string, args: string[]) => impl(file, args),
  });
  return { execFile };
});

const { BdService } = await import('../extension/bd/BdService');

function service(): InstanceType<typeof BdService> {
  return new BdService({ cwd: '/repo' });
}

function fails(stderr: string, code: number | string = 1): ExecImpl {
  return async () => {
    throw Object.assign(new Error('exec failed'), { stdout: '', stderr, code });
  };
}

beforeEach(() => {
  impl = async () => ({ stdout: '[]', stderr: '' });
});

describe('bd is missing or the workspace is not initialised', () => {
  it('classifies bd 1.1.2’s "no beads database found" as no-workspace', async () => {
    // Verbatim from running `bd list --json` in an empty directory.
    impl = fails(
      [
        'Error: no beads database found',
        "Hint: run 'bd where' to inspect the resolved workspace, or 'bd init' to create a new database",
        '      or set BEADS_DIR to point to your .beads directory',
      ].join('\n'),
    );

    await expect(service().json(['list'])).rejects.toMatchObject({
      rpcError: { kind: 'no-workspace' },
    });
  });

  it('keeps the older wording working too', async () => {
    impl = fails('Error: no .beads directory found');
    await expect(service().json(['list'])).rejects.toMatchObject({
      rpcError: { kind: 'no-workspace' },
    });
  });

  it('does not mistake an ordinary refusal for a missing workspace', async () => {
    impl = fails('Error: invalid status "done": not a registered status');
    await expect(service().json(['list'])).rejects.toMatchObject({
      rpcError: { kind: 'bd-error' },
    });
  });

  it('reports an absent executable as bd-not-found', async () => {
    impl = fails('', 'ENOENT');
    await expect(service().json(['list'])).rejects.toMatchObject({
      rpcError: { kind: 'bd-not-found' },
    });
  });
});

describe('BD_JSON_ENVELOPE=1', () => {
  it('unwraps the envelope bd 2.0 will default to', async () => {
    // Shape taken from `BD_JSON_ENVELOPE=1 bd stats --json`.
    impl = async () => ({
      stdout: JSON.stringify({ schema_version: 1, data: { summary: { total_issues: 45 } } }),
      stderr: '',
    });

    await expect(service().json(['stats'])).resolves.toEqual({ summary: { total_issues: 45 } });
  });

  it('leaves a payload that merely has a data key alone', async () => {
    impl = async () => ({ stdout: JSON.stringify({ data: 'a field called data' }), stderr: '' });
    await expect(service().json(['show', 'x'])).resolves.toEqual({ data: 'a field called data' });
  });
});

describe('empty and unusual projects', () => {
  const statuses: StatusDef[] = [
    { name: 'open', category: 'active' },
    { name: 'in_progress', category: 'wip' },
    { name: 'closed', category: 'done' },
  ];
  const index = new StatusIndex(statuses);

  function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
    return { title: partial.id, status: 'open', priority: 2, issue_type: 'task', ...partial };
  }

  it('an empty project produces no groups, no columns and a valid timeline', () => {
    expect(groupByEpic([], index)).toEqual([]);
    expect(buildColumns([], index).every((column) => column.beads.length === 0)).toBe(true);

    const timeline = buildTimeline([], () => false, Date.parse('2026-08-04T00:00:00Z'));
    expect(timeline.end).toBeGreaterThan(timeline.start);
  });

  it('a project with no epics still shows every issue, under Unassigned', () => {
    const groups = groupByEpic([bead({ id: 'a' }), bead({ id: 'b' })], index);
    expect(groups).toHaveLength(1);
    expect(groups[0].epic.id).toBe('__unassigned__');
    expect(groups[0].children).toHaveLength(2);
  });

  it('an unknown status still lands in a column rather than vanishing', () => {
    const columns = buildColumns([bead({ id: 'a', status: 'quantum' })], index);
    const total = columns.reduce((sum, column) => sum + column.beads.length, 0);
    expect(total).toBe(1);
  });

  it('handles a 2000-issue project without quadratic grouping', () => {
    const many: Bead[] = [];
    for (let epic = 0; epic < 20; epic += 1) {
      many.push(bead({ id: `e${epic}`, issue_type: 'epic' }));
      for (let child = 0; child < 99; child += 1) {
        many.push(bead({ id: `e${epic}-${child}`, parent: `e${epic}` }));
      }
    }
    expect(many).toHaveLength(2000);

    const started = performance.now();
    const groups = groupByEpic(many, index);
    const timeline = buildTimeline(groups, () => false, Date.now());
    const elapsed = performance.now() - started;

    expect(groups).toHaveLength(20);
    expect(timeline.epics).toHaveLength(20);
    // Generous: this is a smoke check against an accidental O(n²), not a benchmark.
    expect(elapsed).toBeLessThan(1000);
  });
});
