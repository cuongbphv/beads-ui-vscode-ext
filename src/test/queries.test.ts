import { describe, expect, it } from 'vitest';

import { BdQueries } from '../extension/bd/queries';
import { BdMutations } from '../extension/bd/mutations';
import type { BdService } from '../extension/bd/BdService';

/**
 * A stand-in for BdService that records argv and replays canned payloads —
 * these are the exact shapes bd 1.1.2 emits, captured from a real workspace.
 */
class FakeBd {
  readonly argv: string[][] = [];
  responses: Record<string, unknown> = {};

  async json<T>(args: string[]): Promise<T> {
    this.argv.push(args);
    const key = args[0];
    return (this.responses[key] ?? []) as T;
  }

  jsonShared<T>(args: string[]): Promise<T> {
    return this.json<T>(args);
  }

  async exec(args: string[]): Promise<string> {
    this.argv.push(args);
    return '';
  }
}

function queries(fake: FakeBd): BdQueries {
  return new BdQueries(fake as unknown as BdService);
}

describe('BdQueries.vocabulary', () => {
  it('reads the keyed payloads bd returns and normalises categories', async () => {
    const fake = new FakeBd();
    fake.responses = {
      statuses: {
        schema_version: 1,
        built_in_statuses: [
          { name: 'open', category: 'active', icon: '○' },
          { name: 'closed', category: 'done', icon: '✓' },
        ],
      },
      types: { schema_version: 1, core_types: [{ name: 'task' }, { name: 'epic' }] },
    };

    const vocabulary = await queries(fake).vocabulary();

    expect(vocabulary.statuses.map((s) => s.name)).toEqual(['open', 'closed']);
    expect(vocabulary.types.map((t) => t.name)).toEqual(['task', 'epic']);
  });

  it('marks project-defined statuses as custom and keeps built-ins first', async () => {
    const fake = new FakeBd();
    fake.responses = {
      statuses: {
        built_in_statuses: [{ name: 'open', category: 'active' }],
        custom_statuses: [{ name: 'in_review', category: 'wip' }],
      },
      types: { core_types: [] },
    };

    const vocabulary = await queries(fake).vocabulary();

    expect(vocabulary.statuses.map((s) => s.name)).toEqual(['open', 'in_review']);
    expect(vocabulary.statuses[1].custom).toBe(true);
  });

  it('fetches the vocabulary once per session', async () => {
    const fake = new FakeBd();
    fake.responses = { statuses: { built_in_statuses: [] }, types: { core_types: [] } };

    const q = queries(fake);
    await q.vocabulary();
    await q.vocabulary();

    expect(fake.argv.filter(([command]) => command === 'statuses')).toHaveLength(1);
  });
});

describe('BdQueries.stats', () => {
  it('unwraps the summary object and defaults missing counters to zero', async () => {
    const fake = new FakeBd();
    fake.responses = { stats: { schema_version: 1, summary: { total_issues: 41, ready_issues: 11 } } };

    const stats = await queries(fake).stats();

    expect(stats.total_issues).toBe(41);
    expect(stats.ready_issues).toBe(11);
    expect(stats.blocked_issues).toBe(0);
  });
});

describe('BdQueries.list', () => {
  it('passes a multi-status filter as one comma-separated flag', async () => {
    const fake = new FakeBd();

    await queries(fake).list({ status: ['open', 'in_progress'] });

    expect(fake.argv[0]).toContain('--status');
    expect(fake.argv[0][fake.argv[0].indexOf('--status') + 1]).toBe('open,in_progress');
  });

  it('sends a single type to bd but filters multiple types in process', async () => {
    const fake = new FakeBd();
    fake.responses = {
      list: [
        { id: 'a', issue_type: 'epic' },
        { id: 'b', issue_type: 'task' },
        { id: 'c', issue_type: 'bug' },
      ],
    };

    const single = await queries(fake).list({ type: ['epic'] });
    expect(fake.argv[0]).toContain('--type');
    expect(single).toHaveLength(3); // the fake does not filter; bd would

    const multi = await queries(fake).list({ type: ['epic', 'task'] });
    // bd rejects "epic,task" outright, so the flag must not be sent.
    expect(fake.argv[1]).not.toContain('--type');
    expect(multi.map((bead) => bead.id)).toEqual(['a', 'b']);
  });

  it('always sets an explicit limit, because bd defaults to 50 rows', async () => {
    const fake = new FakeBd();

    await queries(fake).list({});

    expect(fake.argv[0]).toContain('--limit');
    expect(fake.argv[0][fake.argv[0].indexOf('--limit') + 1]).toBe('2000');
  });
});

describe('BdQueries.show and children', () => {
  it('takes the first row, since bd show returns an array even for one id', async () => {
    const fake = new FakeBd();
    fake.responses = { show: [{ id: 'bd-1', title: 'one' }] };

    const { bead } = await queries(fake).show('bd-1');

    expect(bead?.id).toBe('bd-1');
  });

  it('returns null rather than throwing when the issue is absent', async () => {
    const fake = new FakeBd();
    fake.responses = { show: [] };

    const { bead, comments } = await queries(fake).show('nope');

    expect(bead).toBeNull();
    expect(comments).toEqual([]);
  });

  it('asks for closed children too — bd hides them by default', async () => {
    const fake = new FakeBd();

    await queries(fake).children('epic-1');

    expect(fake.argv[0]).toContain('--all');
    expect(fake.argv[0]).toContain('--parent');
  });
});

describe('BdMutations', () => {
  it('builds the argv for each quick action', async () => {
    const fake = new FakeBd();
    const mutations = new BdMutations(fake as unknown as BdService);

    await mutations.setStatus('bd-1', 'in_review');
    await mutations.setPriority('bd-1', 0);
    await mutations.setAssignee('bd-1', 'ana');
    await mutations.close('bd-1', ' shipped ');
    await mutations.claim('bd-1');

    expect(fake.argv).toEqual([
      ['update', 'bd-1', '--status', 'in_review'],
      ['update', 'bd-1', '--priority', '0'],
      ['update', 'bd-1', '--assignee', 'ana'],
      ['close', 'bd-1', '--reason', 'shipped'],
      ['update', 'bd-1', '--claim'],
    ]);
  });

  it('omits an empty close reason instead of passing a blank flag', async () => {
    const fake = new FakeBd();
    const mutations = new BdMutations(fake as unknown as BdService);

    await mutations.close('bd-1', '   ');

    expect(fake.argv[0]).toEqual(['close', 'bd-1']);
  });

  it('passes an empty assignee through, which is how bd unassigns', async () => {
    const fake = new FakeBd();
    const mutations = new BdMutations(fake as unknown as BdService);

    await mutations.setAssignee('bd-1', '');

    expect(fake.argv[0]).toEqual(['update', 'bd-1', '--assignee', '']);
  });

  it('notifies listeners with the changed id after a successful write', async () => {
    const fake = new FakeBd();
    const mutations = new BdMutations(fake as unknown as BdService);
    const seen: string[][] = [];
    mutations.onChanged((ids) => seen.push(ids));

    await mutations.setStatus('bd-7', 'closed');

    expect(seen).toEqual([['bd-7']]);
  });
});
