/** Opt-in qualification against a downloaded CLI; only mutates a throwaway workspace. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BdService } from '../extension/bd/BdService';
import { BdQueries } from '../extension/bd/queries';
import { ChangeProbeStrategy } from '../extension/bd/change-probe';

// Real CLI tests spawn several Dolt processes per case; match bd-live.test.ts.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const executable = process.env.BEADS_COMPAT_BD;

describe.skipIf(!executable)('Beads 1.3 journal CLI qualification (isolated embedded workspace)', () => {
  let cwd: string;
  let bd: BdService;
  let queries: BdQueries;
  beforeAll(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'beads-events-compat-'));
    execFileSync('git', ['init', '-q'], { cwd, windowsHide: true });
    vi.stubEnv('BEADS_DIR', path.join(cwd, '.beads'));
    vi.stubEnv('BD_EVENTS_JOURNAL', '0');
    bd = new BdService({ cwd, bdPath: executable });
    await bd.exec(['init', '--prefix', 'compat', '--quiet', '--non-interactive']);
    queries = new BdQueries(bd);
  }, 30_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (cwd) await rm(cwd, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
  });

  it('keeps journal-off workspaces on watermark and detects outside changes', async () => {
    const probe = new ChangeProbeStrategy(queries);
    await bd.exec(['create', 'first', '--silent']);
    expect(await probe.shouldRefresh()).toBe(false);
    await bd.exec(['create', 'second', '--silent']);
    expect(await probe.shouldRefresh()).toBe(true);
  });

  it('baselines history, parses multiple real JSON Lines and resumes at the newest seq', async () => {
    vi.stubEnv('BD_EVENTS_JOURNAL', '1');
    await bd.exec(['create', 'historical', '--silent']);
    const probe = new ChangeProbeStrategy(queries);
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
    await bd.exec(['create', 'outside one', '--silent']);
    await bd.exec(['create', 'outside two', '--silent']);
    const page = await queries.eventsTail(1, 50);
    expect(page.events).toHaveLength(2);
    expect(page.latestSeq).toBe(3);
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
  });

  it('refreshes immediately when the journal is disabled mid-session', async () => {
    const probe = new ChangeProbeStrategy(queries);
    await probe.shouldRefresh();
    probe.reset();
    vi.stubEnv('BD_EVENTS_JOURNAL', '0');
    await bd.exec(['create', 'unjournaled', '--silent']);
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
    await bd.exec(['create', 'watermark still works', '--silent']);
    expect(await probe.shouldRefresh()).toBe(true);
  });

  it('recovers from a real retention truncation and baselines already-pruned history', async () => {
    vi.stubEnv('BD_EVENTS_JOURNAL', '1');
    const probe = new ChangeProbeStrategy(queries);
    await probe.shouldRefresh();
    probe.reset();
    await bd.exec(['create', 'to prune one', '--silent']);
    await bd.exec(['create', 'to prune two', '--silent']);
    await bd.exec(['config', 'set', 'events-journal-auto-prune', 'false']);
    await bd.exec(['config', 'set', 'events-journal-retain-days', '0']);
    await bd.exec(['config', 'set', 'events-journal-retain-rows', '0']);
    await bd.exec(['events', 'prune', '--before', '5', '--json']);
    await expect(queries.eventsTail(3, 50)).rejects.toMatchObject({ rpcError: { code: 'events_journal_truncated' }, output: { head: 5 } });
    expect(await probe.shouldRefresh()).toBe(true);
    probe.reset();
    expect(await probe.shouldRefresh()).toBe(false);
    expect(await queries.eventsHead()).toBe(5);
    await bd.exec(['create', 'after recovery', '--silent']);
    expect(await probe.shouldRefresh()).toBe(true);
  });

  it('uses the expanded native ready set for custom active statuses', async () => {
    await bd.exec(['config', 'set', 'status.custom', 'triaged:active']);
    const id = (await bd.exec(['create', 'custom active status', '--silent'])).trim();
    await bd.exec(['update', id, '--status', 'triaged']);
    expect((await queries.ready()).map((issue) => issue.id)).toContain(id);
  });

  it('loads the real 1.3.1 vocabulary including custom string types and server status', async () => {
    await bd.exec(['config', 'set', 'types.custom', 'incident']);
    const vocabulary = await queries.vocabulary();
    expect(vocabulary.types).toContainEqual(expect.objectContaining({ name: 'molecule' }));
    expect(vocabulary.types).toContainEqual(expect.objectContaining({ name: 'incident', custom: true }));
    expect(await queries.doltStatus()).toMatchObject({ mode: 'embedded', server_running: false });
    expect((await queries.snapshot()).vocabulary.types).toEqual(vocabulary.types);
  });
  it.each(['--server', '--proxied-server'])('qualifies journal and status on an owned %s workspace', async (mode) => {
    const owned = await mkdtemp(path.join(tmpdir(), 'beads-events-server-'));
    const server = new BdService({ cwd: owned, bdPath: executable });
    vi.stubEnv('BEADS_DIR', path.join(owned, '.beads'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: owned, windowsHide: true });
      await server.exec(['init', '--prefix', 'owned', '--quiet', '--non-interactive', mode]);
      const q = new BdQueries(server);
      await server.exec(['create', 'server history', '--silent']);
      expect(await q.eventsHead()).toBe(1);
      const probe = new ChangeProbeStrategy(q);
      expect(await probe.shouldRefresh()).toBe(true);
      probe.reset();
      expect(await probe.shouldRefresh()).toBe(false);
      await server.exec(['create', 'server outside change', '--silent']);
      expect(await probe.shouldRefresh()).toBe(true);
      expect(await q.doltStatus()).toMatchObject({ server_running: true });
      expect((await q.snapshot()).beads).toHaveLength(2);
    } finally {
      try { await server.exec(['dolt', 'stop']); } finally {
        await rm(owned, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
        vi.stubEnv('BEADS_DIR', path.join(cwd, '.beads'));
      }
    }
  }, 60_000);

});
