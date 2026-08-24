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

describe('BdQueries.doltStatus', () => {
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
