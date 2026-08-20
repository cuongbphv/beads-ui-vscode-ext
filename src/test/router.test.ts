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
import type { RpcRequest } from '../shared/protocol';

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
}

function makeStore(mutations: FakeMutations): BeadsStore {
  return { mutations, queries: {} } as unknown as BeadsStore;
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
