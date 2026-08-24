/**
 * Router coverage for the two new comment/notes RPC methods.
 *
 * `router.ts` imports the real `vscode` module for `copyText` only, which does
 * not exist outside an editor host — this file stubs just that one entry
 * point (see the `store-watcher.test.ts` precedent) so `handleRequest` can be
 * exercised directly with a fake `BeadsStore`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { RouterHost } from '../extension/panel/router';
import type { BeadsStore } from '../extension/store';
import type { TranscriptBackfill } from '../shared/fleet';
import type { CreateBeadParams, RpcRequest, TextField } from '../shared/protocol';

vi.mock('vscode', () => ({
  env: { clipboard: { writeText: vi.fn() } },
}));

const { handleRequest } = await import('../extension/panel/router');

/** Records every call so a test can assert on the argv-shaped params. */
class FakeMutations {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async comment(id: string, text: string): Promise<void> {
    this.calls.push({ method: 'comment', args: [id, text] });
  }

  async appendNotes(id: string, text: string): Promise<void> {
    this.calls.push({ method: 'appendNotes', args: [id, text] });
  }

  async create(input: CreateBeadParams): Promise<{ id: string }> {
    this.calls.push({ method: 'create', args: [input] });
    return { id: 'bd-new-1' };
  }

  async updateText(id: string, field: TextField, text: string): Promise<void> {
    this.calls.push({ method: 'updateText', args: [id, field, text] });
  }

  async addDependency(id: string, dependsOn: string, type: string): Promise<void> {
    this.calls.push({ method: 'addDependency', args: [id, dependsOn, type] });
  }

  async removeDependency(id: string, dependsOn: string): Promise<void> {
    this.calls.push({ method: 'removeDependency', args: [id, dependsOn] });
  }

  async addLabel(id: string, label: string): Promise<void> {
    this.calls.push({ method: 'addLabel', args: [id, label] });
  }

  async removeLabel(id: string, label: string): Promise<void> {
    this.calls.push({ method: 'removeLabel', args: [id, label] });
  }

  async defer(id: string, until?: string, reason?: string): Promise<void> {
    this.calls.push({ method: 'defer', args: [id, until, reason] });
  }

  async undefer(id: string): Promise<void> {
    this.calls.push({ method: 'undefer', args: [id] });
  }

  async reopen(id: string, reason?: string): Promise<void> {
    this.calls.push({ method: 'reopen', args: [id, reason] });
  }
}

/** Records every call so a test can assert on the argv-shaped params. */
class FakeQueries {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  historyResult: unknown = [];
  molSnapshotResult: unknown = {
    molecules: [],
    wisps: [],
    gates: [],
    fetchedAt: '2026-08-24T00:00:00Z',
    degraded: false,
  };
  doltStatusResult: unknown = { mode: 'embedded', server_running: false };
  healthReportResult: unknown = {
    stale: { ok: true, items: [] },
    orphans: { ok: true, items: [] },
    lint: { ok: true, items: [] },
    cycles: { ok: true, items: [] },
    staleDays: 30,
    fetchedAt: '2026-08-25T00:00:00Z',
  };

  async history(id: string, limit?: number): Promise<unknown> {
    this.calls.push({ method: 'history', args: [id, limit] });
    return this.historyResult;
  }

  async molSnapshot(): Promise<unknown> {
    this.calls.push({ method: 'molSnapshot', args: [] });
    return this.molSnapshotResult;
  }

  async doltStatus(): Promise<unknown> {
    this.calls.push({ method: 'doltStatus', args: [] });
    return this.doltStatusResult;
  }

  async healthReport(staleDays?: number): Promise<unknown> {
    this.calls.push({ method: 'healthReport', args: [staleDays] });
    return this.healthReportResult;
  }

  searchResult: unknown = [];

  async search(text: string, limit?: number): Promise<unknown> {
    this.calls.push({ method: 'search', args: [text, limit] });
    return this.searchResult;
  }
}

function makeStore(mutations: FakeMutations, queries: FakeQueries = new FakeQueries()): BeadsStore {
  return { mutations, queries } as unknown as BeadsStore;
}

function makeHost(overrides: Partial<RouterHost> = {}): RouterHost {
  return {
    revealBead: vi.fn(),
    fleetSubscribe: vi.fn(),
    fleetUnsubscribe: vi.fn(),
    transcriptSubscribe: vi.fn(async () => ({
      target: 'agent:worker-1',
      events: [],
      offset: 0,
      truncated: false,
      totalBytes: 0,
    })) as RouterHost['transcriptSubscribe'],
    transcriptUnsubscribe: vi.fn(),
    ...overrides,
  };
}

const host = makeHost();

function request(method: string, params: Record<string, unknown>): RpcRequest {
  return { kind: 'request', id: 1, method, params } as unknown as RpcRequest;
}

describe('router addComment', () => {
  it('calls mutations.comment with the trimmed-by-bd text and returns ok', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addComment', { id: 'bd-1', text: 'looks good' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'comment', args: ['bd-1', 'looks good'] }]);
  });

  it('rejects an empty text before it ever reaches the mutation', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addComment', { id: 'bd-1', text: '' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a whitespace-only text', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addComment', { id: 'bd-1', text: '   ' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a missing text param', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addComment', { id: 'bd-1' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router appendNotes', () => {
  it('calls mutations.appendNotes and returns ok', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('appendNotes', { id: 'bd-1', text: 'second line' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'appendNotes', args: ['bd-1', 'second line'] }]);
  });

  it('rejects an empty text', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('appendNotes', { id: 'bd-1', text: '' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router updateText', () => {
  it('calls mutations.updateText with the exact narrowed args and returns ok', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('updateText', { id: 'bd-1', field: 'description', text: 'Updated description.' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([
      { method: 'updateText', args: ['bd-1', 'description', 'Updated description.'] },
    ]);
  });

  it('allows an empty text for notes — bd\'s documented "clear"', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('updateText', { id: 'bd-1', field: 'notes', text: '' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'updateText', args: ['bd-1', 'notes', ''] }]);
  });

  it('rejects an empty text for field "title" before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('updateText', { id: 'bd-1', field: 'title', text: '' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a field outside the allowlist before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('updateText', { id: 'bd-1', field: 'assignee', text: 'ana' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a missing id before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('updateText', { field: 'notes', text: 'x' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router createBead', () => {
  it('calls mutations.create with the exact narrowed params and returns the new id', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('createBead', {
        title: '  New task  ',
        type: 'bug',
        priority: '1',
        labels: ['ui', ' backend ', ''],
        due: '2026-09-01',
        estimate: 45,
        status: 'in_progress',
        bogus: 'ignored',
      }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { id: 'bd-new-1' } });
    expect(mutations.calls).toEqual([
      {
        method: 'create',
        args: [
          {
            title: 'New task',
            type: 'bug',
            priority: '1',
            labels: ['ui', 'backend'],
            due: '2026-09-01',
            estimate: 45,
            status: 'in_progress',
          },
        ],
      },
    ]);
  });

  it('rejects a missing title before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(makeStore(mutations), host, request('createBead', {}));

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a whitespace-only title before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('createBead', { title: '   ' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a malformed due date before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('createBead', { title: 'ok', due: 'someday' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a non-positive estimate before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('createBead', { title: 'ok', estimate: -5 }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router addDependency', () => {
  it('calls mutations.addDependency with the default type "blocks" when none is given', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addDependency', { id: 'bd-1', dependsOn: 'bd-2' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'addDependency', args: ['bd-1', 'bd-2', 'blocks'] }]);
  });

  it('calls mutations.addDependency with an explicit, allowlisted type', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addDependency', { id: 'bd-1', dependsOn: 'bd-2', type: 'tracks' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'addDependency', args: ['bd-1', 'bd-2', 'tracks'] }]);
  });

  it('rejects a self-edge before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addDependency', { id: 'bd-1', dependsOn: 'bd-1' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a type outside the allowlist before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addDependency', { id: 'bd-1', dependsOn: 'bd-2', type: 'bogus' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a missing dependsOn before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addDependency', { id: 'bd-1' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router removeDependency', () => {
  it('calls mutations.removeDependency with the exact narrowed args and returns ok', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('removeDependency', { id: 'bd-1', dependsOn: 'bd-2' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'removeDependency', args: ['bd-1', 'bd-2'] }]);
  });

  it('rejects a self-edge before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('removeDependency', { id: 'bd-1', dependsOn: 'bd-1' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a missing id before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('removeDependency', { dependsOn: 'bd-2' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router addLabel', () => {
  it('calls mutations.addLabel with the exact narrowed args and returns ok', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addLabel', { id: 'bd-1', label: 'ui' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'addLabel', args: ['bd-1', 'ui'] }]);
  });

  it('trims the label before it reaches the mutation', async () => {
    const mutations = new FakeMutations();
    await handleRequest(
      makeStore(mutations),
      host,
      request('addLabel', { id: 'bd-1', label: '  ui  ' }),
    );

    expect(mutations.calls).toEqual([{ method: 'addLabel', args: ['bd-1', 'ui'] }]);
  });

  it('rejects an empty or whitespace-only label before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addLabel', { id: 'bd-1', label: '   ' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });

  it('rejects a missing id before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('addLabel', { label: 'ui' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router removeLabel', () => {
  it('calls mutations.removeLabel with the exact narrowed args and returns ok', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('removeLabel', { id: 'bd-1', label: 'ui' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'removeLabel', args: ['bd-1', 'ui'] }]);
  });

  it('rejects a missing label before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('removeLabel', { id: 'bd-1' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router deferBead', () => {
  it('calls mutations.defer with id only when until/reason are omitted', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('deferBead', { id: 'bd-1' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'defer', args: ['bd-1', undefined, undefined] }]);
  });

  it('calls mutations.defer with the exact narrowed until/reason', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('deferBead', { id: 'bd-1', until: 'tomorrow', reason: 'waiting on API access' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([
      { method: 'defer', args: ['bd-1', 'tomorrow', 'waiting on API access'] },
    ]);
  });

  it('accepts a free-form relative "until" expression, unlike setDue\'s strict YYYY-MM-DD', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('deferBead', { id: 'bd-1', until: '+1h' }),
    );

    expect(response.ok).toBe(true);
    expect(mutations.calls).toEqual([{ method: 'defer', args: ['bd-1', '+1h', undefined] }]);
  });

  it('narrows a blank until/reason to undefined rather than passing an empty string', async () => {
    const mutations = new FakeMutations();
    await handleRequest(
      makeStore(mutations),
      host,
      request('deferBead', { id: 'bd-1', until: '   ', reason: '' }),
    );

    expect(mutations.calls).toEqual([{ method: 'defer', args: ['bd-1', undefined, undefined] }]);
  });

  it('rejects a missing id before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('deferBead', { until: 'tomorrow' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router undeferBead', () => {
  it('calls mutations.undefer with just the id and returns ok', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('undeferBead', { id: 'bd-1' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'undefer', args: ['bd-1'] }]);
  });

  it('rejects a missing id before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(makeStore(mutations), host, request('undeferBead', {}));

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router reopenBead', () => {
  it('calls mutations.reopen with id only when reason is omitted', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('reopenBead', { id: 'bd-1' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'reopen', args: ['bd-1', undefined] }]);
  });

  it('calls mutations.reopen with the exact narrowed reason', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('reopenBead', { id: 'bd-1', reason: 'regression found' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(mutations.calls).toEqual([{ method: 'reopen', args: ['bd-1', 'regression found'] }]);
  });

  it('rejects a missing id before the mutation is ever called', async () => {
    const mutations = new FakeMutations();
    const response = await handleRequest(
      makeStore(mutations),
      host,
      request('reopenBead', { reason: 'oops' }),
    );

    expect(response.ok).toBe(false);
    expect(mutations.calls).toEqual([]);
  });
});

describe('router getHistory', () => {
  it('calls queries.history with the id and an omitted limit when none is given', async () => {
    const queries = new FakeQueries();
    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHistory', { id: 'bd-1' }),
    );

    expect(response.ok).toBe(true);
    expect(queries.calls).toEqual([{ method: 'history', args: ['bd-1', undefined] }]);
  });

  it('passes a positive integer limit through to queries.history', async () => {
    const queries = new FakeQueries();
    await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHistory', { id: 'bd-1', limit: 10 }),
    );

    expect(queries.calls).toEqual([{ method: 'history', args: ['bd-1', 10] }]);
  });

  it('floors a fractional limit before it reaches the query', async () => {
    const queries = new FakeQueries();
    await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHistory', { id: 'bd-1', limit: 10.9 }),
    );

    expect(queries.calls).toEqual([{ method: 'history', args: ['bd-1', 10] }]);
  });

  it('ignores a non-positive limit, falling back to the default (undefined)', async () => {
    const queries = new FakeQueries();
    await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHistory', { id: 'bd-1', limit: -5 }),
    );

    expect(queries.calls).toEqual([{ method: 'history', args: ['bd-1', undefined] }]);
  });

  it('returns the events queries.history resolves with', async () => {
    const queries = new FakeQueries();
    queries.historyResult = [{ field: 'status', kind: 'value', from: 'open', to: 'closed', actor: 'ana', at: 't' }];

    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHistory', { id: 'bd-1' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: queries.historyResult });
  });

  it('rejects a missing id before the query is ever called', async () => {
    const queries = new FakeQueries();
    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHistory', {}),
    );

    expect(response.ok).toBe(false);
    expect(queries.calls).toEqual([]);
  });
});

describe('router getMolSnapshot', () => {
  it('calls queries.molSnapshot with no params and returns its result', async () => {
    const queries = new FakeQueries();
    queries.molSnapshotResult = {
      molecules: [{ root: { id: 'mol-1' }, progress: null, stale: false, degraded: false }],
      wisps: [],
      gates: [],
      fetchedAt: '2026-08-24T12:00:00Z',
      degraded: false,
    };

    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getMolSnapshot', {}),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: queries.molSnapshotResult });
    expect(queries.calls).toEqual([{ method: 'molSnapshot', args: [] }]);
  });
});

describe('router getSyncStatus', () => {
  it('calls queries.doltStatus (read-only) and returns its result', async () => {
    const queries = new FakeQueries();
    queries.doltStatusResult = { mode: 'embedded', server_running: false, data_dir_exists: true };

    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getSyncStatus', {}),
    );

    expect(response).toEqual({
      kind: 'response',
      id: 1,
      ok: true,
      data: { mode: 'embedded', server_running: false, data_dir_exists: true },
    });
    expect(queries.calls).toEqual([{ method: 'doltStatus', args: [] }]);
  });
});

describe('router getHealthReport', () => {
  it('calls queries.healthReport with no staleDays when none is given, and returns its result', async () => {
    const queries = new FakeQueries();

    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHealthReport', {}),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: queries.healthReportResult });
    expect(queries.calls).toEqual([{ method: 'healthReport', args: [undefined] }]);
  });

  it('narrows a positive finite staleDays through to queries.healthReport', async () => {
    const queries = new FakeQueries();

    await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHealthReport', { staleDays: 7 }),
    );

    expect(queries.calls).toEqual([{ method: 'healthReport', args: [7] }]);
  });

  it('ignores a non-numeric/zero/negative staleDays and falls back to the default', async () => {
    const queries = new FakeQueries();

    await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('getHealthReport', { staleDays: -3 }),
    );

    expect(queries.calls).toEqual([{ method: 'healthReport', args: [undefined] }]);
  });
});

describe('router searchBeads', () => {
  it('calls queries.search with no limit when none is given, and returns its result', async () => {
    const queries = new FakeQueries();
    queries.searchResult = [{ id: 'bd-9', title: 'found it' }];

    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('searchBeads', { text: 'found' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: queries.searchResult });
    expect(queries.calls).toEqual([{ method: 'search', args: ['found', undefined] }]);
  });

  it('narrows a positive finite limit through to queries.search', async () => {
    const queries = new FakeQueries();

    await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('searchBeads', { text: 'found', limit: 10 }),
    );

    expect(queries.calls).toEqual([{ method: 'search', args: ['found', 10] }]);
  });

  it('ignores a non-numeric/zero/negative limit and falls back to the default', async () => {
    const queries = new FakeQueries();

    await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('searchBeads', { text: 'found', limit: -5 }),
    );

    expect(queries.calls).toEqual([{ method: 'search', args: ['found', undefined] }]);
  });

  it('rejects a missing text param before any argv is built', async () => {
    const queries = new FakeQueries();

    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('searchBeads', {}),
    );

    expect(response.ok).toBe(false);
    expect(queries.calls).toEqual([]);
  });

  it('rejects a whitespace-only text before any argv is built', async () => {
    const queries = new FakeQueries();

    const response = await handleRequest(
      makeStore(new FakeMutations(), queries),
      host,
      request('searchBeads', { text: '   ' }),
    );

    expect(response.ok).toBe(false);
    expect(queries.calls).toEqual([]);
  });
});

describe('router Fleet wiring', () => {
  it('subscribeFleet calls host.fleetSubscribe and returns ok', async () => {
    const response = await handleRequest(
      makeStore(new FakeMutations()),
      host,
      request('subscribeFleet', {}),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(host.fleetSubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribeFleet calls host.fleetUnsubscribe and returns ok', async () => {
    const response = await handleRequest(
      makeStore(new FakeMutations()),
      host,
      request('unsubscribeFleet', {}),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(host.fleetUnsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('router transcript wiring', () => {
  it('subscribeTranscript calls host.transcriptSubscribe with the targetId and returns its backfill', async () => {
    const backfill: TranscriptBackfill = {
      target: 'agent:worker-1',
      events: [],
      offset: 42,
      truncated: false,
      totalBytes: 42,
    };
    const localHost = makeHost({ transcriptSubscribe: vi.fn(async () => backfill) });

    const response = await handleRequest(
      makeStore(new FakeMutations()),
      localHost,
      request('subscribeTranscript', { targetId: 'agent:worker-1' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: backfill });
    expect(localHost.transcriptSubscribe).toHaveBeenCalledWith('agent:worker-1');
  });

  it('subscribeTranscript surfaces a rejection from host.transcriptSubscribe (e.g. an unknown target) as an RpcError', async () => {
    const localHost = makeHost({
      transcriptSubscribe: vi.fn(async () => {
        throw new Error('Unknown transcript target: agent:ghost');
      }),
    });

    const response = await handleRequest(
      makeStore(new FakeMutations()),
      localHost,
      request('subscribeTranscript', { targetId: 'agent:ghost' }),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toMatch(/unknown transcript target/i);
  });

  it('subscribeTranscript rejects a targetId containing a space, before the host is ever called', async () => {
    const localHost = makeHost();
    const response = await handleRequest(
      makeStore(new FakeMutations()),
      localHost,
      request('subscribeTranscript', { targetId: 'agent: bad id' }),
    );

    expect(response.ok).toBe(false);
    expect(localHost.transcriptSubscribe).not.toHaveBeenCalled();
  });

  it('subscribeTranscript rejects a targetId containing a path traversal segment, before the host is ever called', async () => {
    const localHost = makeHost();
    const response = await handleRequest(
      makeStore(new FakeMutations()),
      localHost,
      request('subscribeTranscript', { targetId: '../../etc/passwd' }),
    );

    expect(response.ok).toBe(false);
    expect(localHost.transcriptSubscribe).not.toHaveBeenCalled();
  });

  it('unsubscribeTranscript calls host.transcriptUnsubscribe with the targetId and returns ok', async () => {
    const localHost = makeHost();
    const response = await handleRequest(
      makeStore(new FakeMutations()),
      localHost,
      request('unsubscribeTranscript', { targetId: 'session:abc123' }),
    );

    expect(response).toEqual({ kind: 'response', id: 1, ok: true, data: { ok: true } });
    expect(localHost.transcriptUnsubscribe).toHaveBeenCalledWith('session:abc123');
  });

  it('unsubscribeTranscript rejects a missing targetId, before the host is ever called', async () => {
    const localHost = makeHost();
    const response = await handleRequest(
      makeStore(new FakeMutations()),
      localHost,
      request('unsubscribeTranscript', {}),
    );

    expect(response.ok).toBe(false);
    expect(localHost.transcriptUnsubscribe).not.toHaveBeenCalled();
  });
});
