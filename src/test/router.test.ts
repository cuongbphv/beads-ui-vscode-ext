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

const host: RouterHost = { revealBead: vi.fn() };

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
