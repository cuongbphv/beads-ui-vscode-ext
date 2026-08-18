import { describe, expect, it } from 'vitest';

import { BdMutations } from '../extension/bd/mutations';
import { BdQueries } from '../extension/bd/queries';
import type { BdService } from '../extension/bd/BdService';
import { humanGates } from '../shared/model';
import type { BdGate } from '../shared/types';

/**
 * Same role as queries.test.ts's FakeBd — records argv, replays canned
 * payloads — but keys with `in` rather than `??` so an explicit `null` in
 * `responses` survives to `pickArray`. That distinction matters here: bd
 * genuinely emits `null` (not `[]`) for `bd gate list --json` on a project
 * with no gates (verified on bd 1.2.2, see this bead's NOTES).
 */
class FakeBd {
  readonly argv: string[][] = [];
  responses: Record<string, unknown> = {};

  async json<T>(args: string[]): Promise<T> {
    this.argv.push(args);
    const key = args[0];
    return (key in this.responses ? this.responses[key] : []) as T;
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

function mutations(fake: FakeBd): BdMutations {
  return new BdMutations(fake as unknown as BdService);
}

describe('BdQueries.gates', () => {
  it('asks for gate list (BdService appends --json itself)', async () => {
    const fake = new FakeBd();
    fake.responses = { gate: [] };

    await queries(fake).gates();

    expect(fake.argv).toEqual([['gate', 'list']]);
  });

  it('reads the bare-array shape bd 1.2.2 emits for gate list', async () => {
    const fake = new FakeBd();
    fake.responses = {
      gate: [
        {
          id: 'harbor-2',
          title: 'Needs sign-off',
          description: 'Ad-hoc gate blocking harbor-1',
          status: 'open',
          priority: 1,
          issue_type: 'gate',
          owner: 'ana',
          created_at: '2026-08-18T04:00:00Z',
          created_by: 'ana',
          updated_at: '2026-08-18T04:00:00Z',
          await_type: 'human',
        },
      ],
    };

    const gates = await queries(fake).gates();

    expect(gates).toHaveLength(1);
    expect(gates[0].id).toBe('harbor-2');
    // `await_type` is the real field name — bd does not use `type` here.
    expect(gates[0].await_type).toBe('human');
  });

  it('turns a null payload into an empty array — bd emits null for an empty gate list', async () => {
    const fake = new FakeBd();
    fake.responses = { gate: null };

    expect(await queries(fake).gates()).toEqual([]);
  });

  it('unwraps a keyed payload if bd ever wraps gates in an object', async () => {
    const fake = new FakeBd();
    fake.responses = { gate: { gates: [{ id: 'g-1', await_type: 'human' }] } };

    const gates = await queries(fake).gates();

    expect(gates.map((g) => g.id)).toEqual(['g-1']);
  });
});

describe('BdQueries.snapshot', () => {
  it('fans gates() into the snapshot alongside the other five calls', async () => {
    const fake = new FakeBd();
    fake.responses = {
      context: { bd_version: '1.2.2' },
      statuses: { built_in_statuses: [] },
      types: { core_types: [] },
      stats: { summary: {} },
      list: [],
      ready: [],
      blocked: [],
      gate: [{ id: 'g-1', title: 't', status: 'open', priority: 1, issue_type: 'gate', await_type: 'human' }],
    };

    const snapshot = await queries(fake).snapshot();

    expect(snapshot.gates.map((g) => g.id)).toEqual(['g-1']);
  });
});

function gate(id: string, overrides: Partial<BdGate> = {}): BdGate {
  return {
    id,
    title: `Gate ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'gate',
    await_type: 'human',
    ...overrides,
  };
}

describe('humanGates', () => {
  it('keeps only human gates — the ones a person can act on from the sidebar', () => {
    const gates = [
      gate('g-human', { await_type: 'human' }),
      gate('g-timer', { await_type: 'timer' }),
      gate('g-run', { await_type: 'gh:run' }),
      gate('g-pr', { await_type: 'gh:pr' }),
      gate('g-bead', { await_type: 'bead' }),
    ];

    expect(humanGates(gates).map((g) => g.id)).toEqual(['g-human']);
  });

  it('drives the "Gates (N)" count the sidebar section shows', () => {
    const gates = [gate('g-1'), gate('g-2'), gate('g-3', { await_type: 'timer' })];

    // Only the human ones count — this is exactly the array the tree
    // provider maps into "Gates (N)" leaf nodes.
    expect(humanGates(gates)).toHaveLength(2);
  });

  it('answers with an empty array — and the section stays hidden — when there are no gates', () => {
    expect(humanGates([])).toEqual([]);
  });
});

describe('BdMutations.resolveGate', () => {
  it('runs bd gate resolve <id> with no flags when there is no reason', async () => {
    const fake = new FakeBd();

    await mutations(fake).resolveGate('g-1');

    expect(fake.argv).toEqual([['gate', 'resolve', 'g-1']]);
  });

  it('adds a trimmed --reason when one is given', async () => {
    const fake = new FakeBd();

    await mutations(fake).resolveGate('g-1', '  approved in review  ');

    expect(fake.argv).toEqual([['gate', 'resolve', 'g-1', '--reason', 'approved in review']]);
  });

  it('omits --reason for a blank string, same as close()', async () => {
    const fake = new FakeBd();

    await mutations(fake).resolveGate('g-1', '   ');

    expect(fake.argv).toEqual([['gate', 'resolve', 'g-1']]);
  });

  it('notifies listeners with the changed id after a successful resolve', async () => {
    const fake = new FakeBd();
    const bd = mutations(fake);
    const seen: string[][] = [];
    bd.onChanged((ids) => seen.push(ids));

    await bd.resolveGate('g-1', 'done');

    expect(seen).toEqual([['g-1']]);
  });
});
