import { describe, expect, it, vi } from 'vitest';

import { BdError } from '../extension/bd/BdService';
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

  async jsonLines<T>(args: string[]): Promise<T[]> {
    this.argv.push(args);
    return (this.responses[args[0]] ?? []) as T[];
  }

  jsonShared<T>(args: string[]): Promise<T> {
    return this.json<T>(args);
  }

  /** Canned stdout for `exec`, keyed by the first argv word (e.g. `create`). */
  execResults: Record<string, string> = {};

  async exec(args: string[]): Promise<string> {
    this.argv.push(args);
    return this.execResults[args[0]] ?? '';
  }
}

function queries(fake: FakeBd): BdQueries {
  return new BdQueries(fake as unknown as BdService);
}

describe('BdQueries.vocabulary', () => {
  it('includes 1.3.1 system types and normalizes custom type names', async () => {
    const fake = new FakeBd();
    fake.responses = {
      statuses: { built_in_statuses: [] },
      types: { core_types: [{ name: 'task' }], system_types: [{ name: 'gate' }, { name: 'molecule' }], custom_types: ['incident', { name: 'review' }, 'task'] },
    };
    expect((await queries(fake).vocabulary()).types).toEqual([
      { name: 'task' }, { name: 'gate' }, { name: 'molecule' },
      { name: 'incident', custom: true }, { name: 'review', custom: true },
    ]);
  });

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

  it('leaves absent lease fields undefined — never epoch/empty defaults (beads-ui-vscode-ext-ayq.1)', async () => {
    const fake = new FakeBd();
    // The shape every sampled issue on this machine had: no lease fields at all.
    fake.responses = { list: { issues: [{ id: 'a', title: 't', status: 'open', priority: 2, issue_type: 'task' }] } };

    const [bead] = await queries(fake).list({});

    expect(bead.lease_expires_at).toBeUndefined();
    expect(bead.heartbeat_at).toBeUndefined();
    expect(bead.lease_granted_node).toBeUndefined();
  });

  it('passes lease fields through untouched when bd reports an active lease', async () => {
    const fake = new FakeBd();
    fake.responses = {
      list: {
        issues: [
          {
            id: 'a',
            lease_expires_at: '2026-08-24T12:05:00Z',
            heartbeat_at: '2026-08-24T12:01:00Z',
            lease_granted_node: 'node-a',
          },
        ],
      },
    };

    const [bead] = await queries(fake).list({});

    expect(bead.lease_expires_at).toBe('2026-08-24T12:05:00Z');
    expect(bead.heartbeat_at).toBe('2026-08-24T12:01:00Z');
    expect(bead.lease_granted_node).toBe('node-a');
  });
});

describe('BdQueries.watermark', () => {
  it('asks bd for exactly one row, newest first, including closed issues', async () => {
    const fake = new FakeBd();
    fake.responses = { list: { issues: [{ id: 'harbor-9', updated_at: '2026-08-04T09:00:00Z' }] } };

    await queries(fake).watermark();

    const argv = fake.argv[0];
    expect(argv[argv.indexOf('--sort') + 1]).toBe('updated');
    expect(argv[argv.indexOf('--limit') + 1]).toBe('1');
    // A close is the single most likely external change; without --all the
    // issue leaves the list and the fingerprint moves backwards.
    expect(argv).toContain('--all');
  });

  it('fingerprints the newest row by id and timestamp together', async () => {
    const fake = new FakeBd();
    fake.responses = { list: { issues: [{ id: 'harbor-9', updated_at: '2026-08-04T09:00:00Z' }] } };

    expect(await queries(fake).watermark()).toBe('harbor-9@2026-08-04T09:00:00Z');
  });

  it('answers with an empty fingerprint for an empty project', async () => {
    const fake = new FakeBd();
    fake.responses = { list: { issues: [] } };

    expect(await queries(fake).watermark()).toBe('');
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

describe('BdQueries.history', () => {
  it('sends the exact argv including --limit, and appends --json via bd.json', async () => {
    const fake = new FakeBd();
    fake.responses = { history: [] };

    await queries(fake).history('bd-1', 50);

    expect(fake.argv[0]).toEqual(['history', 'bd-1', '--limit', '50']);
  });

  it('omits --limit when none is given, defaulting to bd history --limit 50 in the argv', async () => {
    const fake = new FakeBd();
    fake.responses = { history: [] };

    await queries(fake).history('bd-1');

    // The default is applied by the query itself, so the argv always carries it.
    expect(fake.argv[0]).toEqual(['history', 'bd-1', '--limit', '50']);
  });

  it('translates the real bd 1.2.2 shape (bare array, PascalCase, newest first) into diff events', async () => {
    const fake = new FakeBd();
    fake.responses = {
      history: [
        {
          CommitHash: 'c2',
          Committer: 'cuongbphv',
          CommitDate: '2026-08-24T15:23:18Z',
          Issue: { id: 'bd-1', status: 'in_progress', priority: 2, issue_type: 'task', title: 't' },
        },
        {
          CommitHash: 'c1',
          Committer: 'cuongbphv',
          CommitDate: '2026-08-24T14:58:05Z',
          Issue: { id: 'bd-1', status: 'open', priority: 2, issue_type: 'task', title: 't' },
        },
      ],
    };

    const events = await queries(fake).history('bd-1');

    expect(events).toEqual([
      {
        field: 'status',
        kind: 'value',
        from: 'open',
        to: 'in_progress',
        actor: 'cuongbphv',
        at: '2026-08-24T15:23:18Z',
      },
    ]);
  });

  it('returns zero events for a single-commit history without throwing', async () => {
    const fake = new FakeBd();
    fake.responses = {
      history: [
        {
          CommitHash: 'c1',
          Committer: 'cuongbphv',
          CommitDate: '2026-08-24T14:58:05Z',
          Issue: { id: 'bd-1', status: 'open' },
        },
      ],
    };

    expect(await queries(fake).history('bd-1')).toEqual([]);
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

describe('BdMutations.create', () => {
  function mutations(fake: FakeBd): BdMutations {
    return new BdMutations(fake as unknown as BdService);
  }

  it('builds the full argv with --silent and every optional flag, labels comma-joined', async () => {
    const fake = new FakeBd();
    fake.execResults = { create: 'bd-42\n' };

    const { id } = await mutations(fake).create({
      title: 'Fix the flaky poll',
      type: 'bug',
      priority: '1',
      parent: 'bd-epic-1',
      labels: ['ui', 'backend'],
      due: '2026-09-01',
      estimate: 90,
      description: 'It polls too eagerly.',
      design: 'Debounce it.',
      acceptance: 'No duplicate polls.',
    });

    expect(id).toBe('bd-42');
    expect(fake.argv).toEqual([
      [
        'create',
        'Fix the flaky poll',
        '--silent',
        '-t',
        'bug',
        '-p',
        '1',
        '--parent',
        'bd-epic-1',
        '-l',
        'ui,backend',
        '--due',
        '2026-09-01',
        '-e',
        '90',
        '-d',
        'It polls too eagerly.',
        '--design',
        'Debounce it.',
        '--acceptance',
        'No duplicate polls.',
      ],
    ]);
  });

  it('runs exactly one exec for a title-only create and trims the returned id', async () => {
    const fake = new FakeBd();
    fake.execResults = { create: '  bd-7  \n' };

    const { id } = await mutations(fake).create({ title: 'Just a title' });

    expect(id).toBe('bd-7');
    expect(fake.argv).toEqual([['create', 'Just a title', '--silent']]);
  });

  it('follows up with bd update --status when a status is requested — create has no --status flag', async () => {
    const fake = new FakeBd();
    fake.execResults = { create: 'bd-9\n' };

    const { id } = await mutations(fake).create({ title: 'With status', status: 'in_progress' });

    expect(id).toBe('bd-9');
    expect(fake.argv).toEqual([
      ['create', 'With status', '--silent'],
      ['update', 'bd-9', '--status', 'in_progress'],
    ]);
  });

  it('sends the estimate as whole minutes, same contract as setEstimate', async () => {
    const fake = new FakeBd();
    fake.execResults = { create: 'bd-11\n' };

    await mutations(fake).create({ title: 'Rounded', estimate: 89.6 });

    expect(fake.argv[0]).toEqual(['create', 'Rounded', '--silent', '-e', '90']);
  });

  it('notifies listeners once, with the new id, after every write has succeeded', async () => {
    const fake = new FakeBd();
    fake.execResults = { create: 'bd-13\n' };
    const bd = mutations(fake);
    const changed: string[][] = [];
    bd.onChanged((ids) => changed.push(ids));

    await bd.create({ title: 'Notify me', status: 'in_progress' });

    expect(changed).toEqual([['bd-13']]);
  });

  it('throws instead of returning a blank id when bd prints nothing', async () => {
    const fake = new FakeBd();
    fake.execResults = { create: '   \n' };
    const bd = mutations(fake);
    const changed: string[][] = [];
    bd.onChanged((ids) => changed.push(ids));

    await expect(bd.create({ title: 'Silent failure' })).rejects.toThrow(/no id/);
    expect(changed).toEqual([]);
  });
});

describe('BdMutations schedule writes', () => {
  function mutations(fake: FakeBd): BdMutations {
    return new BdMutations(fake as unknown as BdService);
  }

  it('sets a due date in the format bd documents', async () => {
    const fake = new FakeBd();
    await mutations(fake).setDue('bd-a1', '2026-09-01');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--due', '2026-09-01']]);
  });

  it('clears a due date with an empty string', async () => {
    const fake = new FakeBd();
    await mutations(fake).setDue('bd-a1', '');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--due', '']]);
  });

  it('sends the estimate as whole minutes', async () => {
    const fake = new FakeBd();
    await mutations(fake).setEstimate('bd-a1', 89.6);
    expect(fake.argv).toEqual([['update', 'bd-a1', '--estimate', '90']]);
  });

  it('notifies listeners with the changed id', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.setEstimate('bd-a1', 30);

    expect(changed).toEqual([['bd-a1']]);
  });
});

describe('BdMutations comment and notes writes', () => {
  function mutations(fake: FakeBd): BdMutations {
    return new BdMutations(fake as unknown as BdService);
  }

  it('posts a comment as a positional argv, not a flag', async () => {
    const fake = new FakeBd();
    await mutations(fake).comment('bd-a1', 'looks good');
    expect(fake.argv).toEqual([['comment', 'bd-a1', 'looks good']]);
  });

  it('appends to notes with --append-notes, which bd joins with a newline', async () => {
    const fake = new FakeBd();
    await mutations(fake).appendNotes('bd-a1', 'second line');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--append-notes', 'second line']]);
  });

  it('notifies listeners with the changed id after a comment', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.comment('bd-a1', 'hi');

    expect(changed).toEqual([['bd-a1']]);
  });

  it('notifies listeners with the changed id after an append-notes', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.appendNotes('bd-a1', 'more context');

    expect(changed).toEqual([['bd-a1']]);
  });
});

describe('BdMutations dependency writes', () => {
  function mutations(fake: FakeBd): BdMutations {
    return new BdMutations(fake as unknown as BdService);
  }

  it('adds a dependency with --type', async () => {
    const fake = new FakeBd();
    await mutations(fake).addDependency('bd-1', 'bd-2', 'blocks');
    expect(fake.argv).toEqual([['dep', 'add', 'bd-1', 'bd-2', '--type', 'blocks']]);
  });

  it('passes through a non-default type verbatim', async () => {
    const fake = new FakeBd();
    await mutations(fake).addDependency('bd-1', 'bd-2', 'tracks');
    expect(fake.argv).toEqual([['dep', 'add', 'bd-1', 'bd-2', '--type', 'tracks']]);
  });

  it('removes a dependency with no --type flag', async () => {
    const fake = new FakeBd();
    await mutations(fake).removeDependency('bd-1', 'bd-2');
    expect(fake.argv).toEqual([['dep', 'remove', 'bd-1', 'bd-2']]);
  });

  it('notifies listeners with both ids after adding a dependency', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.addDependency('bd-1', 'bd-2', 'blocks');

    expect(changed).toEqual([['bd-1', 'bd-2']]);
  });

  it('notifies listeners with both ids after removing a dependency', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.removeDependency('bd-1', 'bd-2');

    expect(changed).toEqual([['bd-1', 'bd-2']]);
  });
});

describe('BdMutations.updateText', () => {
  function mutations(fake: FakeBd): BdMutations {
    return new BdMutations(fake as unknown as BdService);
  }

  it('sets the title with --title', async () => {
    const fake = new FakeBd();
    await mutations(fake).updateText('bd-a1', 'title', 'New title');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--title', 'New title']]);
  });

  it('sets the description with --description', async () => {
    const fake = new FakeBd();
    await mutations(fake).updateText('bd-a1', 'description', 'New description.');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--description', 'New description.']]);
  });

  it('sets the design with --design', async () => {
    const fake = new FakeBd();
    await mutations(fake).updateText('bd-a1', 'design', 'New design.');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--design', 'New design.']]);
  });

  it('sets the acceptance criteria with --acceptance', async () => {
    const fake = new FakeBd();
    await mutations(fake).updateText('bd-a1', 'acceptance', 'New acceptance.');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--acceptance', 'New acceptance.']]);
  });

  it('sets notes with --notes', async () => {
    const fake = new FakeBd();
    await mutations(fake).updateText('bd-a1', 'notes', 'New notes.');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--notes', 'New notes.']]);
  });

  it('clears a clearable field with an empty string', async () => {
    const fake = new FakeBd();
    await mutations(fake).updateText('bd-a1', 'notes', '');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--notes', '']]);
  });

  it('notifies listeners with the changed id after a successful update', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.updateText('bd-a1', 'description', 'Updated.');

    expect(changed).toEqual([['bd-a1']]);
  });
});

describe('BdMutations label writes', () => {
  function mutations(fake: FakeBd): BdMutations {
    return new BdMutations(fake as unknown as BdService);
  }

  it('adds a label with --add-label', async () => {
    const fake = new FakeBd();
    await mutations(fake).addLabel('bd-a1', 'ui');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--add-label', 'ui']]);
  });

  it('removes a label with --remove-label', async () => {
    const fake = new FakeBd();
    await mutations(fake).removeLabel('bd-a1', 'ui');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--remove-label', 'ui']]);
  });

  it('notifies listeners with the changed id after adding a label', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.addLabel('bd-a1', 'ui');

    expect(changed).toEqual([['bd-a1']]);
  });

  it('notifies listeners with the changed id after removing a label', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.removeLabel('bd-a1', 'ui');

    expect(changed).toEqual([['bd-a1']]);
  });
});

describe('BdMutations defer/undefer/reopen writes', () => {
  function mutations(fake: FakeBd): BdMutations {
    return new BdMutations(fake as unknown as BdService);
  }

  it('defers with just the id when until/reason are omitted', async () => {
    const fake = new FakeBd();
    await mutations(fake).defer('bd-a1');
    expect(fake.argv).toEqual([['defer', 'bd-a1']]);
  });

  it('defers with --until and --reason when both are given', async () => {
    const fake = new FakeBd();
    await mutations(fake).defer('bd-a1', 'tomorrow', 'waiting on API access');
    expect(fake.argv).toEqual([
      ['defer', 'bd-a1', '--until', 'tomorrow', '--reason', 'waiting on API access'],
    ]);
  });

  it('defers with only --until when reason is omitted', async () => {
    const fake = new FakeBd();
    await mutations(fake).defer('bd-a1', '+1h');
    expect(fake.argv).toEqual([['defer', 'bd-a1', '--until', '+1h']]);
  });

  it('defers with only --reason when until is omitted', async () => {
    const fake = new FakeBd();
    await mutations(fake).defer('bd-a1', undefined, 'blocked externally');
    expect(fake.argv).toEqual([['defer', 'bd-a1', '--reason', 'blocked externally']]);
  });

  it('trims until/reason and omits either flag entirely when it trims to blank', async () => {
    const fake = new FakeBd();
    await mutations(fake).defer('bd-a1', '  tomorrow  ', '   ');
    expect(fake.argv).toEqual([['defer', 'bd-a1', '--until', 'tomorrow']]);
  });

  it('undefers with just the id — bd undefer takes no flags', async () => {
    const fake = new FakeBd();
    await mutations(fake).undefer('bd-a1');
    expect(fake.argv).toEqual([['undefer', 'bd-a1']]);
  });

  it('reopens with just the id when reason is omitted', async () => {
    const fake = new FakeBd();
    await mutations(fake).reopen('bd-a1');
    expect(fake.argv).toEqual([['reopen', 'bd-a1']]);
  });

  it('reopens with --reason when given', async () => {
    const fake = new FakeBd();
    await mutations(fake).reopen('bd-a1', 'regression found');
    expect(fake.argv).toEqual([['reopen', 'bd-a1', '--reason', 'regression found']]);
  });

  it('omits an empty/whitespace-only reopen reason instead of passing a blank flag', async () => {
    const fake = new FakeBd();
    await mutations(fake).reopen('bd-a1', '   ');
    expect(fake.argv).toEqual([['reopen', 'bd-a1']]);
  });

  it('notifies listeners with the changed id after each of defer/undefer/reopen', async () => {
    const fake = new FakeBd();
    const bd = mutations(fake);
    const changed: string[][] = [];
    bd.onChanged((ids) => changed.push(ids));

    await bd.defer('bd-a1', 'tomorrow');
    await bd.undefer('bd-a1');
    await bd.reopen('bd-a1');

    expect(changed).toEqual([['bd-a1'], ['bd-a1'], ['bd-a1']]);
  });
});

/**
 * `FakeBd` above keys canned responses by `args[0]` only, which is fine when
 * every fixture in a describe block hits a distinct top-level command. Every
 * `mol` read shares `args[0] === 'mol'` (`mol progress`, `mol show`, `mol
 * wisp list`, `mol stale`), so the mol tests need a fake keyed by the full
 * argv instead, or every one of those calls would answer with the same
 * canned payload.
 */
class FakeArgvBd {
  readonly argv: string[][] = [];
  responses = new Map<string, unknown>();
  failing = new Set<string>();

  private key(args: string[]): string {
    return args.join(' ');
  }

  async json<T>(args: string[]): Promise<T> {
    this.argv.push(args);
    const key = this.key(args);
    if (this.failing.has(key)) throw new Error(`bd ${args.join(' ')} failed`);
    return (this.responses.has(key) ? this.responses.get(key) : null) as T;
  }

  jsonShared<T>(args: string[]): Promise<T> {
    return this.json<T>(args);
  }

  async exec(args: string[]): Promise<string> {
    this.argv.push(args);
    return '';
  }
}

function molQueries(fake: FakeArgvBd): BdQueries {
  return new BdQueries(fake as unknown as BdService);
}

describe('BdQueries molecule reads', () => {
  it('molRoots: bd list --flat --type molecule, unwraps the issues array', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('list --flat --type molecule', [
      { id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' },
    ]);

    const roots = await molQueries(fake).molRoots();

    expect(fake.argv).toEqual([['list', '--flat', '--type', 'molecule']]);
    expect(roots.map((r) => r.id)).toEqual(['mol-1']);
  });

  it('molProgress: bd mol progress <id>, translates the bare object', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('mol progress mol-1', {
      molecule_id: 'mol-1',
      molecule_title: 'fixdemo',
      total: 4,
      completed: 1,
      in_progress: 1,
      percent: 25,
      current_step_id: 'mol-25d',
      schema_version: 1,
    });

    const progress = await molQueries(fake).molProgress('mol-1');

    expect(fake.argv).toEqual([['mol', 'progress', 'mol-1']]);
    expect(progress).toEqual({
      molecule_id: 'mol-1',
      molecule_title: 'fixdemo',
      total: 4,
      completed: 1,
      in_progress: 1,
      percent: 25,
      current_step_id: 'mol-25d',
      schema_version: 1,
    });
  });

  it('molShow: bd mol show <id> --parallel', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('mol show mol-1 --parallel', {
      root: { id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' },
      issues: [{ id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' }],
      parallel: { parallel_groups: {}, steps: {} },
    });

    await molQueries(fake).molShow('mol-1');

    expect(fake.argv).toEqual([['mol', 'show', 'mol-1', '--parallel']]);
  });

  it('wisps: bd mol wisp list, unwraps the wisps array and keeps the "type" field', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('mol wisp list', {
      count: 1,
      wisps: [{ id: 'w-1', title: 'Design healthcheck', status: 'open', priority: 2, type: 'task' }],
    });

    const wisps = await molQueries(fake).wisps();

    expect(fake.argv).toEqual([['mol', 'wisp', 'list']]);
    expect(wisps).toEqual([
      {
        id: 'w-1',
        title: 'Design healthcheck',
        status: 'open',
        priority: 2,
        type: 'task',
        created_at: undefined,
        updated_at: undefined,
      },
    ]);
  });

  it('molStaleIds: bd mol stale, extracts ids from stale_molecules', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('mol stale', {
      stale_molecules: [
        { id: 'epic-1', title: 'x', total_children: 1, closed_children: 1, blocking_count: 0 },
      ],
    });

    const ids = await molQueries(fake).molStaleIds();

    expect(fake.argv).toEqual([['mol', 'stale']]);
    expect(ids).toEqual(['epic-1']);
  });

  it('molStaleIds: a null stale_molecules (bd\'s empty shape) settles to []', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('mol stale', { stale_molecules: null });

    expect(await molQueries(fake).molStaleIds()).toEqual([]);
  });
});

describe('BdQueries.molSnapshot', () => {
  it('short-circuits at zero molecule roots: no progress/wisp/stale/gate reads happen', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('list --flat --type molecule', []);

    const snapshot = await molQueries(fake).molSnapshot();

    expect(snapshot.molecules).toEqual([]);
    expect(snapshot.wisps).toEqual([]);
    expect(snapshot.gates).toEqual([]);
    expect(snapshot.degraded).toBe(false);
    expect(typeof snapshot.fetchedAt).toBe('string');
    // The one and only bd call was the roots list — no mol/gate fan-out at all.
    expect(fake.argv).toEqual([['list', '--flat', '--type', 'molecule']]);
  });

  it('degrades only the molecule whose progress call throws; the rest of the snapshot still populates', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('list --flat --type molecule', [
      { id: 'mol-1', title: 'Good', status: 'open', priority: 2, issue_type: 'molecule' },
      { id: 'mol-2', title: 'Broken', status: 'open', priority: 2, issue_type: 'molecule' },
    ]);
    fake.responses.set('mol progress mol-1', {
      molecule_id: 'mol-1',
      molecule_title: 'Good',
      total: 4,
      completed: 1,
      in_progress: 1,
      percent: 25,
    });
    fake.failing.add('mol progress mol-2');
    fake.responses.set('mol stale', { stale_molecules: null });
    fake.responses.set('mol wisp list', { wisps: [] });
    fake.responses.set('gate list', []);

    const snapshot = await molQueries(fake).molSnapshot();

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.molecules).toHaveLength(2);
    const good = snapshot.molecules.find((m) => m.root.id === 'mol-1');
    const broken = snapshot.molecules.find((m) => m.root.id === 'mol-2');
    expect(good?.degraded).toBe(false);
    expect(good?.progress?.total).toBe(4);
    expect(broken?.degraded).toBe(true);
    expect(broken?.progress).toBeNull();
  });

  it('reuses the existing gates() read, so molecule cards can show open gates for free', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('list --flat --type molecule', [
      { id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' },
    ]);
    fake.responses.set('mol progress mol-1', {
      molecule_id: 'mol-1',
      molecule_title: 'fixdemo',
      total: 4,
      completed: 1,
      in_progress: 1,
      percent: 25,
    });
    fake.responses.set('mol stale', { stale_molecules: null });
    fake.responses.set('mol wisp list', { wisps: [] });
    fake.responses.set('gate list', [
      { id: 'gate-1', title: 'Gate: human', status: 'open', priority: 2, issue_type: 'gate', await_type: 'human' },
    ]);

    const snapshot = await molQueries(fake).molSnapshot();

    expect(snapshot.gates.map((g) => g.id)).toEqual(['gate-1']);
  });
});

describe('BdQueries.showMolecule', () => {
  function withRootAndTwoSteps(fake: FakeArgvBd): void {
    fake.responses.set('mol show mol-1 --parallel', {
      root: { id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' },
      issues: [
        { id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' },
        { id: 'step-a', title: 'Step A', status: 'open', priority: 2, issue_type: 'task' },
        { id: 'step-b', title: 'Step B', status: 'open', priority: 2, issue_type: 'task' },
      ],
      parallel: {
        parallel_groups: { 'group-1': ['step-a', 'step-b'] },
        steps: {
          'step-a': { status: 'open', is_ready: true, parallel_group: 'group-1' },
          'step-b': { status: 'open', is_ready: true, parallel_group: 'group-1' },
        },
      },
    });
  }

  it('composes mol show, a batched step gate lookup and mol progress into one MolDetail', async () => {
    const fake = new FakeArgvBd();
    withRootAndTwoSteps(fake);
    fake.responses.set('show step-a step-b', [
      {
        id: 'step-a',
        dependencies: [
          { id: 'gate-1', status: 'open', issue_type: 'gate', await_type: 'human', dependency_type: 'blocks' },
        ],
      },
      { id: 'step-b', dependencies: [] },
    ]);
    fake.responses.set('mol progress mol-1', {
      molecule_id: 'mol-1',
      molecule_title: 'fixdemo',
      total: 2,
      completed: 0,
      in_progress: 0,
      percent: 0,
    });

    const detail = await molQueries(fake).showMolecule('mol-1');

    expect(fake.argv).toEqual([
      ['mol', 'show', 'mol-1', '--parallel'],
      ['show', 'step-a', 'step-b'],
      ['mol', 'progress', 'mol-1'],
    ]);
    expect(detail.root.id).toBe('mol-1');
    expect(detail.parallelAvailable).toBe(true);
    expect(detail.progress?.total).toBe(2);
    const stepA = detail.steps.find((s) => s.issue.id === 'step-a');
    const stepB = detail.steps.find((s) => s.issue.id === 'step-b');
    expect(stepA?.gate).toEqual({ gateId: 'gate-1', awaitType: 'human', awaitId: undefined, timeout: undefined });
    expect(stepB?.gate).toBeUndefined();
  });

  it('skips the batched step-gate lookup entirely for a root-only molecule (no steps)', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('mol show mol-1 --parallel', {
      root: { id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' },
      issues: [{ id: 'mol-1', title: 'fixdemo', status: 'open', priority: 2, issue_type: 'molecule' }],
      parallel: { parallel_groups: {}, steps: {} },
    });
    fake.failing.add('mol progress mol-1');

    const detail = await molQueries(fake).showMolecule('mol-1');

    expect(fake.argv).toEqual([
      ['mol', 'show', 'mol-1', '--parallel'],
      ['mol', 'progress', 'mol-1'],
    ]);
    expect(detail.steps).toEqual([]);
    expect(detail.progress).toBeNull();
  });

  it('degrades progress to null when mol progress fails, without losing the already-parsed steps', async () => {
    const fake = new FakeArgvBd();
    withRootAndTwoSteps(fake);
    fake.responses.set('show step-a step-b', [{ id: 'step-a' }, { id: 'step-b' }]);
    fake.failing.add('mol progress mol-1');

    const detail = await molQueries(fake).showMolecule('mol-1');

    expect(detail.progress).toBeNull();
    expect(detail.steps).toHaveLength(2);
  });

  it('degrades gate badging to "no badges" when the batched bd show call fails, without losing steps or progress', async () => {
    const fake = new FakeArgvBd();
    withRootAndTwoSteps(fake);
    fake.failing.add('show step-a step-b');
    fake.responses.set('mol progress mol-1', {
      molecule_id: 'mol-1',
      molecule_title: 'fixdemo',
      total: 2,
      completed: 0,
      in_progress: 0,
      percent: 0,
    });

    const detail = await molQueries(fake).showMolecule('mol-1');

    expect(detail.steps).toHaveLength(2);
    expect(detail.steps.every((s) => s.gate === undefined)).toBe(true);
    expect(detail.progress?.total).toBe(2);
  });

  it('propagates a real failure from mol show itself (e.g. an unknown molecule id)', async () => {
    const fake = new FakeArgvBd();
    fake.failing.add('mol show bad-id --parallel');

    await expect(molQueries(fake).showMolecule('bad-id')).rejects.toThrow();
  });
});

describe('BdQueries.doltStatus', () => {
  it('recognizes the direct server State payload that omits mode', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({ running: true, pid: 222, port: 3307, data_dir: '/workspace/.beads/dolt' });
    expect(await queries(fake).doltStatus()).toEqual({ mode: 'local-server', server_running: true, pid: 222, port: 3307, data_dir: '/workspace/.beads/dolt' });
  });

  it('uses reachability and version from external server status', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({ mode: 'external', running: true, host: 'example.local', port: 3306, version: '8.0.33' });
    expect(await queries(fake).doltStatus()).toEqual({ mode: 'external', server_running: true, host: 'example.local', port: 3306, server_version: '8.0.33' });
  });

  it.each([
    { running: true, backend_managed: true, backend_running: true, expected: true },
    { running: true, backend_managed: true, backend_running: false, expected: false },
    { running: true, backend_managed: false, backend_running: false, expected: true },
    { running: false, backend_managed: true, backend_running: true, expected: false },
  ])('reads 1.3.1 proxy and backend health $expected', async ({ expected, ...fields }) => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({ mode: 'proxied-server', proxy_pid: 111, proxy_port: 40001, ...fields });
    expect(await queries(fake).doltStatus()).toMatchObject({ mode: 'proxied-server', server_running: expected, pid: 111, port: 40001 });
  });

  it('sends the exact argv, with --json as a literal element rather than one bd.json would append', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({
      data_dir: 'C:\\repo\\.beads\\embeddeddolt',
      data_dir_exists: true,
      mode: 'embedded',
      schema_version: 1,
      server_running: false,
    });

    await queries(fake).doltStatus();

    expect(fake.argv).toEqual([['dolt', 'status', '--json']]);
  });

  it('parses the verified embedded-mode shape, tolerating the absence of ahead/behind/last-sync', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({
      data_dir: 'C:\\repo\\.beads\\embeddeddolt',
      data_dir_exists: true,
      mode: 'embedded',
      schema_version: 1,
      server_running: false,
    });

    const status = await queries(fake).doltStatus();

    expect(status).toEqual({
      mode: 'embedded',
      server_running: false,
      data_dir: 'C:\\repo\\.beads\\embeddeddolt',
      data_dir_exists: true,
      schema_version: 1,
    });
  });

  it('copies ahead/behind/lastSyncAt through only when bd actually sends them (unverified remote-mode fields)', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({
      mode: 'local-server',
      server_running: true,
      ahead: 2,
      behind: 0,
      lastSyncAt: '2026-08-24T10:00:00Z',
    });

    const status = await queries(fake).doltStatus();

    expect(status).toEqual({
      mode: 'local-server',
      server_running: true,
      ahead: 2,
      behind: 0,
      lastSyncAt: '2026-08-24T10:00:00Z',
    });
  });

  it('never fabricates ahead/behind when bd omits them', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({ mode: 'embedded', server_running: false });

    const status = await queries(fake).doltStatus();

    expect(status.ahead).toBeUndefined();
    expect(status.behind).toBeUndefined();
    expect(status.lastSyncAt).toBeUndefined();
  });

  it('degrades to a safe fallback shape on malformed JSON, without throwing', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = 'not json {{{';

    await expect(queries(fake).doltStatus()).resolves.toEqual({
      mode: 'unknown',
      server_running: false,
      degraded: true,
    });
  });

  it('degrades to a safe fallback shape when the payload is an unexpected shape (bare array)', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify([1, 2, 3]);

    await expect(queries(fake).doltStatus()).resolves.toEqual({
      mode: 'unknown',
      server_running: false,
      degraded: true,
    });
  });

  it('degrades to a safe fallback shape when mode is missing entirely', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({ server_running: true });

    await expect(queries(fake).doltStatus()).resolves.toEqual({
      mode: 'unknown',
      server_running: false,
      degraded: true,
    });
  });

  it('never runs bd dolt push or bd dolt pull', async () => {
    const fake = new FakeBd();
    fake.execResults.dolt = JSON.stringify({ mode: 'embedded', server_running: false });

    await queries(fake).doltStatus();

    for (const argv of fake.argv) {
      expect(argv).not.toContain('push');
      expect(argv).not.toContain('pull');
    }
  });
});

describe('BdQueries events journal contracts', () => {
  function enabled() {
    const fake = new FakeBd();
    fake.responses.config = { value: 'true' };
    return fake;
  }

  it('checks the effective config and reads JSON Lines with bounded argv', async () => {
    const fake = enabled();
    fake.responses.events = [{ seq: 8 }, { seq: 9 }];
    expect(await queries(fake).eventsTail(7, 50)).toEqual({ events: [{ seq: 8 }, { seq: 9 }], latestSeq: 9 });
    expect(fake.argv).toEqual([['config', 'get', 'events-journal'], ['events', 'tail', '--since', '7', '--limit', '50']]);
  });

  it.each(['1', 1, true, 'TRUE', ' true '])('accepts effective enabled value %s', async (value) => {
    const fake = enabled();
    fake.responses.config = { value };
    expect(await queries(fake).eventsTail(12, 10)).toEqual({ events: [], latestSeq: 12 });
  });

  it.each(['false', '0', false, '', undefined])('does not mistake disabled value %s for a quiet journal', async (value) => {
    const fake = enabled();
    fake.responses.config = { value };
    await expect(queries(fake).eventsTail(0, 1)).rejects.toMatchObject({ rpcError: { code: 'events_journal_disabled' } });
    expect(fake.argv).toHaveLength(1);
  });

  it.each([[{}], [{ seq: '3' }], [{ seq: 1.5 }], [{ seq: -1 }], [{ seq: 2 }, { seq: 2 }], [{ seq: 3 }, { seq: 2 }], [null]].map((events) => ({ events })))('rejects invalid records $events', async ({ events }) => {
    const fake = enabled();
    fake.responses.events = events;
    await expect(queries(fake).eventsTail(0, 10)).rejects.toMatchObject({ rpcError: { kind: 'bad-output' } });
  });

  it('reads the counter head through readonly CLI SQL in server mode', async () => {
    const fake = enabled();
    fake.responses.sql = [{ head: 300 }];
    expect(await queries(fake).eventsHead()).toBe(300);
    expect(fake.argv[1]).toEqual(['sql', '--readonly', 'SELECT next_seq AS head FROM bd_events_seq WHERE id = 0']);
    expect(fake.argv.some(([command]) => command === 'events')).toBe(false);
  });

  it('drains bounded pages to baseline embedded mode without replay', async () => {
    const fake = enabled();
    const tail = vi.spyOn(fake, 'jsonLines');
    tail.mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => ({ seq: i + 1 }))).mockResolvedValueOnce([{ seq: 1001 }]);
    expect(await queries(fake).eventsHead()).toBe(1001);
    expect(tail).toHaveBeenLastCalledWith(['events', 'tail', '--since', '1000', '--limit', '1000']);
  });

  it('uses the structured truncation head when initial history has been pruned', async () => {
    const fake = enabled();
    vi.spyOn(fake, 'jsonLines').mockRejectedValueOnce(new BdError({ kind: 'bd-error', code: 'events_journal_truncated', message: 'pruned' }, { head: 80 }));
    expect(await queries(fake).eventsHead()).toBe(80);
  });

  it('refuses an incomplete baseline rather than reading indefinitely', async () => {
    const fake = enabled();
    let seq = 0;
    vi.spyOn(fake, 'jsonLines').mockImplementation(async () => Array.from({ length: 1000 }, () => ({ seq: ++seq })));
    await expect(queries(fake).eventsHead()).rejects.toThrow('page budget');
  });
});

/**
 * BdQueries.healthReport (bead beads-ui-vscode-ext-72m.2): the four
 * `bd stale`/`bd orphans`/`bd lint`/`bd dep cycles` argvs, fanned out via
 * `Promise.allSettled`, and the degradation guarantee that one check
 * throwing degrades only that check's card.
 */
describe('BdQueries.healthReport', () => {
  it('sends the exact argv for each of the four checks, with staleDays as --days', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('stale --days 30', []);
    fake.responses.set('orphans', []);
    fake.responses.set('lint', { total: 0, issues: 0, results: [] });
    fake.responses.set('dep cycles', []);

    await molQueries(fake).healthReport();

    expect(fake.argv).toEqual([
      ['stale', '--days', '30'],
      ['orphans'],
      ['lint'],
      ['dep', 'cycles'],
    ]);
  });

  it('passes a custom staleDays through to --days', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('stale --days 7', []);
    fake.responses.set('orphans', []);
    fake.responses.set('lint', { results: [] });
    fake.responses.set('dep cycles', []);

    const report = await molQueries(fake).healthReport(7);

    expect(fake.argv[0]).toEqual(['stale', '--days', '7']);
    expect(report.staleDays).toBe(7);
  });

  it('unwraps the verified real shapes: bare arrays for stale/cycles, null for orphans, keyed results for lint', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('stale --days 30', [
      { id: 'bd-1', title: 'Stale one', status: 'open', priority: 2, issue_type: 'task' },
    ]);
    // `bd orphans --json` answers `null`, not `[]`, when there is nothing to report.
    fake.responses.set('orphans', null);
    fake.responses.set('lint', {
      total: 1,
      issues: 1,
      results: [
        {
          id: 'bd-2',
          title: 'Missing acceptance criteria',
          type: 'task',
          missing: ['## Acceptance Criteria'],
          warnings: 1,
        },
      ],
    });
    fake.responses.set('dep cycles', []);

    const report = await molQueries(fake).healthReport();

    expect(report.stale).toEqual({ ok: true, items: [expect.objectContaining({ id: 'bd-1' })] });
    expect(report.orphans).toEqual({ ok: true, items: [] });
    expect(report.lint.items).toHaveLength(1);
    expect(report.lint.items[0]).toMatchObject({ id: 'bd-2', missing: ['## Acceptance Criteria'] });
    expect(report.cycles).toEqual({ ok: true, items: [] });
    expect(typeof report.fetchedAt).toBe('string');
  });

  it('degrades only the check that throws — the other three still populate (Promise.allSettled, per-check, never one try/catch around all four)', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('stale --days 30', [
      { id: 'bd-1', title: 'Stale one', status: 'open', priority: 2, issue_type: 'task' },
    ]);
    fake.responses.set('orphans', []);
    fake.failing.add('lint');
    fake.responses.set('dep cycles', []);

    const report = await molQueries(fake).healthReport();

    expect(report.stale).toEqual({ ok: true, items: [expect.objectContaining({ id: 'bd-1' })] });
    expect(report.orphans).toEqual({ ok: true, items: [] });
    expect(report.cycles).toEqual({ ok: true, items: [] });
    expect(report.lint.ok).toBe(false);
    expect(report.lint.items).toEqual([]);
    expect(report.lint.error).toContain('lint failed');
  });

  it('never spawns bd preflight or bd doctor', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('stale --days 30', []);
    fake.responses.set('orphans', []);
    fake.responses.set('lint', { results: [] });
    fake.responses.set('dep cycles', []);

    await molQueries(fake).healthReport();

    expect(fake.argv.some((argv) => argv[0] === 'preflight')).toBe(false);
    expect(fake.argv.some((argv) => argv[0] === 'doctor')).toBe(false);
  });
});

describe('BdQueries.search', () => {
  it('builds the argv exactly, including the default limit', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('search roadmap --status all --limit 50', [
      { id: 'bd-1', title: 'Roadmap polish', status: 'open', priority: 2, issue_type: 'task' },
    ]);

    const results = await molQueries(fake).search('roadmap');

    expect(fake.argv).toEqual([['search', 'roadmap', '--status', 'all', '--limit', '50']]);
    expect(results).toEqual([
      { id: 'bd-1', title: 'Roadmap polish', status: 'open', priority: 2, issue_type: 'task' },
    ]);
  });

  it('threads a caller-supplied limit through to the argv', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('search roadmap --status all --limit 10', []);

    await molQueries(fake).search('roadmap', 10);

    expect(fake.argv).toEqual([['search', 'roadmap', '--status', 'all', '--limit', '10']]);
  });

  it('always passes --status all, so the client-side includeClosed toggle keeps working on the results', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('search bug --status all --limit 50', []);

    await molQueries(fake).search('bug');

    expect(fake.argv[0]).toContain('--status');
    expect(fake.argv[0][fake.argv[0].indexOf('--status') + 1]).toBe('all');
  });

  it('accepts the real bare-array shape measured against a live bd search (bd 1.2.2)', async () => {
    const fake = new FakeArgvBd();
    fake.responses.set('search beads --status all --limit 50', [
      {
        id: 'beads-ui-vscode-ext-ayq.1',
        title: 'Lease/claim liveness badges',
        status: 'closed',
        priority: 1,
        issue_type: 'task',
      },
    ]);

    const results = await molQueries(fake).search('beads');

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('beads-ui-vscode-ext-ayq.1');
  });
});
