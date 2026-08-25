/**
 * Integration suite: drives BdService/BdQueries against the *real* `bd` CLI and
 * cross-checks every read against raw `bd --json` output.
 *
 * This is the layer that proves the extension reports the truth. It needs no
 * VSCode, no display and no window reload, so it runs unattended.
 *
 * Read-only by construction, with one deliberate exception: the "dependency
 * edges" describe block below creates throwaway issues and wires/unwires real
 * `bd dep add`/`bd dep remove` edges between them to settle an [Unverified]
 * question against the live CLI. Those mutations run against a fresh,
 * throwaway `bd` project created in a temp directory for that block alone —
 * never against this repo's own shared board — and the temp project is
 * deleted afterwards regardless of how the tests end. See that block's doc
 * comment for why: `bd` does not scope its database lookup to whatever `cwd`
 * happens to be passed to it in the general case; a workspace's `.beads/`
 * has to actually exist under that `cwd` (or a parent of it) for the lookup
 * to land there instead of on whatever project a shared git checkout
 * otherwise resolves to. Every other describe block in this file still
 * mutates nothing. See CLAUDE.md cardinal sin #4.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BdError, BdService } from '../extension/bd/BdService';
import { BdMutations } from '../extension/bd/mutations';
import { BdQueries } from '../extension/bd/queries';
import { PARENT_CHILD, toCategory } from '../shared/types';
import type { Bead } from '../shared/types';
import {
  fetchWithConsistencyRetry,
  isDashboardConsistent,
  isStatsConsistent,
} from './support/dashboard-consistency';
import { removeScratchDirBestEffort } from './support/scratch-cleanup';

/**
 * This file's own timeout, not the suite's.
 *
 * Every test here spawns the real `bd`, which opens Dolt; under a full
 * `vitest run` it competes for CPU with 29 other files and a single spawn can
 * take several seconds. Vitest's 5s default is right for those 29 files and
 * raising it globally would hide a genuinely slow unit test, so the cost is
 * paid only where it is real. `vi.setConfig` is scoped to this file — vitest
 * resets the runtime config between files.
 */
const BD_SPAWN_TIMEOUT_MS = 30_000;
vi.setConfig({ testTimeout: BD_SPAWN_TIMEOUT_MS, hookTimeout: BD_SPAWN_TIMEOUT_MS });

const execFileAsync = promisify(execFile);

/** The repo root — `src/test/` is two levels down. */
const CWD = path.resolve(__dirname, '..', '..');

/**
 * A second, deliberately independent path to bd, so the assertions compare two
 * different code paths rather than one implementation with itself. Mirrors the
 * Windows `.cmd` shim fallback that BdService performs internally.
 */
async function rawJson<T>(args: string[]): Promise<T> {
  const options = {
    cwd: CWD,
    encoding: 'utf8' as const,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, BD_JSON_ENVELOPE: '0' },
  };
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('bd', [...args, '--json'], options));
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
    ({ stdout } = await execFileAsync('bd', [...args, '--json'], { ...options, shell: true }));
  }
  return JSON.parse(stdout) as T;
}

function rows<T>(payload: unknown, key = 'issues'): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const value = (payload as Record<string, unknown> | null)?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * `bd list --all` excludes `issue_type: 'gate'` issues entirely — open or
 * closed (verified on bd 1.2.2: gate lifecycle issues are workflow plumbing,
 * not board items) — but `bd stats`' `total_issues` and `closed_issues` both
 * count every issue including gates. A board with zero gates never notices;
 * this one does, since `beads-ui-vscode-ext-43p.2` carries a closed ad-hoc
 * gate from an earlier capture step. `queries.list` has no reason to grow a
 * "gates" mode just for this cross-check, so gate counts are fetched
 * directly, the same way `rawJson` already bypasses `BdQueries` for the
 * other independent-path assertions in this file.
 */
async function gateIssueCounts(): Promise<{ total: number; closed: number }> {
  const gates = rows<{ id: string; status: string }>(
    await rawJson(['gate', 'list', '--all']),
    'gates',
  );
  return { total: gates.length, closed: gates.filter((g) => g.status === 'closed').length };
}

/**
 * The checkout whose `.beads/` directory bd is expected to resolve to.
 *
 * Usually that is `CWD`. Inside a *linked git worktree* it is not: the worktree
 * has no `.beads/` of its own, and bd deliberately resolves the workspace of
 * the main checkout that owns the shared git directory, so `bd context` reports
 * a path that has nothing to do with `path.basename(CWD)`. Asserting on the
 * worktree's own name therefore failed for a workspace bd had resolved
 * *correctly* — the bug this helper exists to remove.
 *
 * `git rev-parse --git-common-dir` names that shared git directory, so its
 * parent is the owning checkout. Same rule, and the same fallbacks, as
 * `findBeadsWorkspaceRoot()` in `scripts/run-webview-test.mjs`.
 */
async function beadsWorkspaceRoot(): Promise<string> {
  if (existsSync(path.join(CWD, '.beads'))) return CWD;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], {
      cwd: CWD,
      encoding: 'utf8',
    });
    // `--git-common-dir` answers relatively from a plain checkout and
    // absolutely from a worktree; `path.resolve` accepts both.
    return path.dirname(path.resolve(CWD, stdout.trim()));
  } catch {
    return CWD; // Not a git checkout at all; nothing further to resolve against.
  }
}

const service = new BdService({ cwd: CWD });
const queries = new BdQueries(service);
// No module-level `BdMutations` on `service`: every mutating test in this file
// now builds its own `BdMutations` on an isolated scratch project instead (see
// the "dependency edges" describe block below) — nothing here has a reason to
// mutate the shared board `service`/`queries` are built on.

/**
 * Deletes a throwaway pair permanently — the cleanup step for the
 * dependency-edge tests below. `cwd` is always the isolated scratch
 * project those tests create, never the shared `CWD` the rest of this file
 * uses: nothing in this function's callers is allowed to touch the real
 * board.
 */
async function deleteScratchIssues(cwd: string, ...ids: string[]): Promise<void> {
  await execFileAsync('bd', ['delete', ...ids, '--force'], { cwd });
}

describe('bd CLI is reachable', () => {
  it('spawns bd and reports a version', async () => {
    const context = await queries.context();
    expect(context.bd_version).toMatch(/\d+\.\d+/);
  });

  it('resolves this repo as the beads workspace', async () => {
    const context = await queries.context();
    expect(context.beads_dir).toBeTruthy();
    // Compare case- and separator-insensitively: Windows hands back either.
    const normalise = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    // The whole parent path, not just a directory name: a bare name also
    // matches a sibling checkout ("…-ext-2/.beads") or any stale redirect that
    // happens to mention it, and those are precisely the wrong workspaces this
    // test exists to catch.
    expect(normalise(path.dirname(context.beads_dir))).toBe(normalise(await beadsWorkspaceRoot()));
  });
});

describe('vocabulary is loaded, never hardcoded', () => {
  it('returns statuses whose categories all normalise to a known column', async () => {
    const { statuses } = await queries.vocabulary();
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(status.name).toBeTruthy();
      expect(status.category).toBe(toCategory(status.category));
    }
  });

  it('covers every status actually in use by an issue', async () => {
    const [{ statuses }, beads] = await Promise.all([
      queries.vocabulary(),
      queries.list({ all: true }),
    ]);
    const known = new Set(statuses.map((s) => s.name));
    const used = new Set(beads.map((b) => b.status));
    // A status on an issue but absent from the vocabulary would silently drop
    // that issue off the board.
    expect([...used].filter((s) => !known.has(s))).toEqual([]);
  });

  it('returns issue types and includes the ones in use', async () => {
    const [{ types }, beads] = await Promise.all([
      queries.vocabulary(),
      queries.list({ all: true }),
    ]);
    expect(types.length).toBeGreaterThan(0);
    const known = new Set(types.map((t) => t.name));
    expect([...new Set(beads.map((b) => b.issue_type))].filter((t) => !known.has(t))).toEqual([]);
  });

  it('caches: a second call returns the identical object', async () => {
    const first = await queries.vocabulary();
    const second = await queries.vocabulary();
    expect(second).toBe(first);
  });
});

describe('stats match the CLI', () => {
  it('reproduces every counter from `bd stats --json`', async () => {
    const [parsed, raw] = await Promise.all([
      queries.stats(),
      rawJson<{ summary?: Record<string, number> }>(['stats']),
    ]);
    const summary = raw.summary ?? (raw as unknown as Record<string, number>);

    expect(parsed.total_issues).toBe(summary.total_issues);
    expect(parsed.open_issues).toBe(summary.open_issues);
    expect(parsed.in_progress_issues).toBe(summary.in_progress_issues);
    expect(parsed.blocked_issues).toBe(summary.blocked_issues);
    expect(parsed.closed_issues).toBe(summary.closed_issues);
    expect(parsed.ready_issues).toBe(summary.ready_issues);
  });

  it('agrees with the issue list it will be shown next to', async () => {
    // beads-ui-vscode-ext-3yq: `queries.stats()`, `queries.list({ all: true
    // })`, and `gateIssueCounts()` are three independent `bd` calls against
    // this repo's real, live board — the same race shape bead l2o fixed for
    // the "dashboard snapshot" test above, structurally identical but with a
    // genuinely different invariant (this fan-out has no ready/blocked ids to
    // cross-check, and additionally compares closed-count totals, which
    // `isDashboardConsistent` has no fields for). See `isStatsConsistent`'s
    // own doc comment in `dashboard-consistency.ts` for why it is a separate
    // check function rather than a reuse of `isDashboardConsistent`.
    const { stats, all, gates } = await fetchWithConsistencyRetry(
      async () => {
        const [stats, all, gates] = await Promise.all([
          queries.stats(),
          queries.list({ all: true }),
          gateIssueCounts(),
        ]);
        return { stats, all, gates };
      },
      ({ stats, all, gates }) => ({
        allLength: all.length,
        allClosedLength: all.filter((b) => b.status === 'closed').length,
        gatesTotal: gates.total,
        gatesClosed: gates.closed,
        statsTotalIssues: stats.total_issues,
        statsClosedIssues: stats.closed_issues,
      }),
      isStatsConsistent,
    );
    // The dashboard prints both; a mismatch means one of them is lying. `all`
    // undercounts both totals by exactly the gate issues on the board — see
    // `gateIssueCounts`'s doc comment.
    expect(all.length + gates.total).toBe(stats.total_issues);
    expect(all.filter((b) => b.status === 'closed').length + gates.closed).toBe(
      stats.closed_issues,
    );
  });
});

describe('issue list', () => {
  let all: Bead[];

  beforeAll(async () => {
    all = await queries.list({ all: true });
  });

  it('returns the same ids as raw `bd list --flat --all --json`', async () => {
    const raw = rows<Bead>(await rawJson(['list', '--flat', '--all', '--limit', '2000']));
    expect(all.map((b) => b.id).sort()).toEqual(raw.map((b) => b.id).sort());
  });

  it('gives every issue the fields the UI renders', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const bead of all) {
      expect(bead.id).toBeTruthy();
      expect(bead.title).toBeTruthy();
      expect(bead.status).toBeTruthy();
      expect(bead.issue_type).toBeTruthy();
      expect(typeof bead.priority).toBe('number');
      expect(bead.priority).toBeGreaterThanOrEqual(0);
      expect(bead.priority).toBeLessThanOrEqual(4);
    }
  });

  it('hides closed issues without --all', async () => {
    const open = await queries.list({});
    expect(open.every((b) => b.status !== 'closed')).toBe(true);
    expect(open.length).toBeLessThanOrEqual(all.length);
  });

  it('filters by a single status', async () => {
    const [{ statuses }] = await Promise.all([queries.vocabulary()]);
    const target = statuses.find((s) => all.some((b) => b.status === s.name));
    expect(target, 'no status in the vocabulary is in use').toBeDefined();

    const filtered = await queries.list({ status: [target!.name], all: true });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((b) => b.status === target!.name)).toBe(true);
    expect(filtered.length).toBe(all.filter((b) => b.status === target!.name).length);
  });

  it('filters by a multi-status list (the comma form bd needs)', async () => {
    const used = [...new Set(all.map((b) => b.status))];
    if (used.length < 2) return; // nothing to prove on a single-status project
    const pair = used.slice(0, 2);
    const filtered = await queries.list({ status: pair, all: true });
    const expected = all.filter((b) => pair.includes(b.status));
    expect(filtered.map((b) => b.id).sort()).toEqual(expected.map((b) => b.id).sort());
  });

  it('applies a multi-type filter client-side, since bd rejects a type list', async () => {
    const used = [...new Set(all.map((b) => b.issue_type))];
    if (used.length < 2) return;
    const pair = used.slice(0, 2);
    const filtered = await queries.list({ type: pair, all: true });
    expect(filtered.every((b) => pair.includes(b.issue_type))).toBe(true);
    expect(filtered.length).toBe(all.filter((b) => pair.includes(b.issue_type)).length);
  });

  it('honours the limit', async () => {
    const limited = await queries.list({ all: true, limit: 3 });
    expect(limited.length).toBeLessThanOrEqual(3);
  });
});

describe('single issue', () => {
  it('round-trips a real id through show()', async () => {
    const all = await queries.list({ all: true });
    const sample = all[0];
    const { bead } = await queries.show(sample.id);
    expect(bead).not.toBeNull();
    expect(bead!.id).toBe(sample.id);
    expect(bead!.title).toBe(sample.title);
    expect(bead!.status).toBe(sample.status);
  });

  it('reports a missing id as a BdError rather than an empty success', async () => {
    // A silent empty result here would render as a blank detail pane.
    await expect(queries.show('definitely-not-an-issue-000')).rejects.toBeInstanceOf(BdError);
  });
});

describe('epic hierarchy', () => {
  it('children() includes closed issues, so epic progress is not under-reported', async () => {
    const all = await queries.list({ all: true });
    const parents = [...new Set(all.map((b) => b.parent).filter(Boolean))] as string[];
    if (parents.length === 0) return;

    const parent = parents[0];
    const children = await queries.children(parent);
    const expected = all.filter((b) => b.parent === parent);

    expect(children.map((b) => b.id).sort()).toEqual(expected.map((b) => b.id).sort());
  });

  it('every inlined parent matches a parent-child edge', async () => {
    const all = await queries.list({ all: true });
    const byId = new Map(all.map((b) => [b.id, b]));

    for (const bead of all) {
      if (!bead.parent) continue;
      // The parent must exist, or the tree renders an orphan under nothing.
      expect(byId.has(bead.parent), `${bead.id} points at missing parent ${bead.parent}`).toBe(true);
      const edge = bead.dependencies?.find(
        (d) => d.type === PARENT_CHILD && d.depends_on_id === bead.parent,
      );
      expect(edge, `${bead.id} has parent ${bead.parent} but no ${PARENT_CHILD} edge`).toBeDefined();
    }
  });

  it('has no parent cycles', () => {
    // Guarded separately: a cycle would hang the tree provider's recursion.
    return queries.list({ all: true }).then((all) => {
      const parentOf = new Map(all.map((b) => [b.id, b.parent]));
      for (const bead of all) {
        const seen = new Set<string>([bead.id]);
        let cursor = bead.parent;
        while (cursor) {
          expect(seen.has(cursor), `parent cycle through ${cursor}`).toBe(false);
          seen.add(cursor);
          cursor = parentOf.get(cursor);
        }
      }
    });
  });
});

describe('dependency edges (mutating: runs against an isolated scratch `bd` project, never the shared board)', () => {
  /**
   * The one exception to this file's read-only rule (see the file doc
   * comment). `addDependency`/`removeDependency` route straight to `bd dep
   * add`/`bd dep remove`, which only a real spawn of the live CLI can prove
   * out. Those spawns still must not land on the repo's own shared board, so
   * this block creates its own throwaway `bd` project in a temp directory —
   * completely separate Dolt database, separate `.beads/` — runs every test
   * below against *that* project's `cwd`, and deletes the temp directory
   * again in `afterAll` no matter how the tests end.
   *
   * Earlier revisions of these tests called `mutations.create`/
   * `addDependency`/`removeDependency` — built on a `BdService` pointed at
   * this file's shared `CWD` — directly, on the theory that a linked git
   * worktree with no local `.beads/` would make `bd` treat it as its own,
   * separate, empty workspace. MEASURED to be false: `bd` does not require a
   * `.beads/` under `cwd` to resolve a workspace there; from a worktree with
   * no local `.beads/` at all, `bd list` still returns the real shared
   * project's issues (this repo's own `beadsWorkspaceRoot()` helper above
   * documents exactly why — bd deliberately resolves worktree checkouts back
   * to the workspace of the main checkout that owns the shared git
   * directory). Running these tests that way created real throwaway issues
   * on the actual shared project board every single `npm test` run. A fresh
   * `mkdtemp` directory that a plain `bd init --non-interactive` initializes
   * from scratch has its own `.beads/` sitting directly under the `cwd` it
   * is given, with no shared git directory for `bd` to resolve past it —
   * `bd context --json` run there reports `beads_dir` inside the temp
   * directory itself, confirmed by hand before writing this — so this is a
   * genuinely separate project, not the shared one.
   */
  let scratchDir: string;
  let scratchMutations: BdMutations;

  beforeAll(async () => {
    scratchDir = await mkdtemp(path.join(tmpdir(), 'bd-live-dep-edge-'));
    // `--non-interactive`: skip every interactive prompt (bd's own --help:
    // "Skips all interactive prompts, using sensible defaults"). `--skip-hooks`
    // and `--skip-agents`: this scratch project only ever needs a Dolt
    // database to exist; it has no reason to install git hooks or generate
    // AGENTS.md/CLAUDE.md/Claude-Code-skill files into a directory that is
    // about to be deleted.
    const initArgs = ['init', '--non-interactive', '--skip-hooks', '--skip-agents'];
    const initOptions = { cwd: scratchDir, windowsHide: true };
    try {
      await execFileAsync('bd', initArgs, initOptions);
    } catch (error) {
      // Same Windows `.cmd` shim fallback `rawJson` above already relies on.
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      await execFileAsync('bd', initArgs, { ...initOptions, shell: true });
    }
    const scratchService = new BdService({ cwd: scratchDir });
    scratchMutations = new BdMutations(scratchService);
  });

  afterAll(async () => {
    // The embedded Dolt engine can still hold a file lock for a moment
    // after the `bd` process that opened it has exited, which turns an
    // immediate `rm` into a transient Windows EBUSY. `fs.rm`'s own
    // maxRetries/retryDelay retry that with a linear backoff (worst case
    // retryDelay * maxRetries * (maxRetries + 1) / 2 ms — ~48s at these
    // values), which is a much bigger budget than the ~3s this hook used to
    // give it. Under heavy concurrent load — many scratch bd/Dolt projects
    // spinning up at once across parallel bead-fleet batch runs — even that
    // budget has been observed to run out (beads-ui-vscode-ext-iy3): every
    // assertion in this suite had already passed, but the bare `rm` still
    // threw and failed the whole run. removeScratchDirBestEffort keeps the
    // retry (the mkdtemp+bd-init isolation itself is untouched — this is
    // only the cleanup step afterwards) but warns instead of throwing if
    // the directory is still locked once the budget is exhausted, so a
    // transient Windows lock can no longer turn an all-green suite red.
    await removeScratchDirBestEffort(scratchDir, { maxRetries: 15, retryDelay: 400 });
  }, 60_000);

  /** Raw `bd --json`, scoped to the isolated scratch project rather than this file's shared `CWD`. */
  async function scratchJson<T>(args: string[]): Promise<T> {
    const options = {
      cwd: scratchDir,
      encoding: 'utf8' as const,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, BD_JSON_ENVELOPE: '0' },
    };
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('bd', [...args, '--json'], options));
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      ({ stdout } = await execFileAsync('bd', [...args, '--json'], { ...options, shell: true }));
    }
    return JSON.parse(stdout) as T;
  }

  it('dep add wires an edge dep list reports, and dep remove un-wires it — against the isolated scratch project', async () => {
    const { id: a } = await scratchMutations.create({ title: 'bd-live dep-edge scratch (isolated project, temp, safe to delete)' });
    const { id: b } = await scratchMutations.create({ title: 'bd-live dep-edge scratch (isolated project, temp, safe to delete)' });
    try {
      await scratchMutations.addDependency(a, b, 'blocks');
      const wired = rows<{ id?: string; dependency_type?: string }>(await scratchJson(['dep', 'list', a]));
      expect(wired.some((d) => d.id === b && d.dependency_type === 'blocks')).toBe(true);

      await scratchMutations.removeDependency(a, b);
      const unwired = rows<{ id?: string }>(await scratchJson(['dep', 'list', a]));
      expect(unwired.some((d) => d.id === b)).toBe(false);
    } finally {
      await deleteScratchIssues(scratchDir, a, b);
    }
  });

  /**
   * Settles the [Unverified] question this bead exists to close: does `bd
   * dep remove <id> <dependsOn>` with no `-t` remove every edge kind between
   * the pair, or only one (e.g. the default `blocks` kind)?
   *
   * MEASURED against bd 1.2.2, by hand, before writing this assertion (run
   * against the isolated scratch project, not the shared board):
   *   $ bd dep add <a> <b> --type blocks     # succeeds
   *   $ bd dep add <a> <b> --type related    # Error: dependency <a> -> <b>
   *     already exists with type "blocks" (requested "related"); remove it
   *     first with 'bd dep remove' then re-add
   *   $ bd dep remove --help                 # lists no -t/--type flag at all
   *   $ bd dep remove <a> <b>                 # ✓ Removed dependency ...
   *   $ bd dep list <a> --json                # []
   *
   * ANSWER: the question is moot for a single ordered (id, dependsOn) pair —
   * `bd dep add` enforces at most one edge per ordered pair regardless of
   * type (a second `--type` on the same pair is REJECTED, not merged or
   * added alongside the first), so there is structurally never more than one
   * edge kind to remove. `bd dep remove` with no `-t` therefore always
   * removes "every edge kind between the pair" in the trivial sense that
   * there is only ever one. This test proves the "second type is rejected,
   * not stacked" half of that, since it is the half a router/mutations
   * change could actually get wrong (e.g. by retrying with a different type).
   */
  it('a second dep add with a different type is rejected, not stacked alongside the first — against the isolated scratch project', async () => {
    const { id: a } = await scratchMutations.create({ title: 'bd-live dep-edge scratch (isolated project, temp, safe to delete)' });
    const { id: b } = await scratchMutations.create({ title: 'bd-live dep-edge scratch (isolated project, temp, safe to delete)' });
    try {
      await scratchMutations.addDependency(a, b, 'blocks');
      await expect(scratchMutations.addDependency(a, b, 'related')).rejects.toBeInstanceOf(BdError);

      // Only the original edge exists — the rejected second `dep add` left
      // no second, differently-typed edge sitting alongside it.
      const wired = rows<{ id?: string; dependency_type?: string }>(await scratchJson(['dep', 'list', a]));
      expect(wired.filter((d) => d.id === b)).toHaveLength(1);
      expect(wired.find((d) => d.id === b)?.dependency_type).toBe('blocks');

      await scratchMutations.removeDependency(a, b);
      const unwired = rows<{ id?: string }>(await scratchJson(['dep', 'list', a]));
      expect(unwired.some((d) => d.id === b)).toBe(false);
    } finally {
      await deleteScratchIssues(scratchDir, a, b);
    }
  });
});

describe('ready / blocked', () => {
  it('ready ids are real issues and none of them are closed', async () => {
    const [ready, all] = await Promise.all([queries.ready(), queries.list({ all: true })]);
    const byId = new Map(all.map((b) => [b.id, b]));
    for (const bead of ready) {
      expect(byId.has(bead.id), `${bead.id} is ready but not in the list`).toBe(true);
      expect(byId.get(bead.id)!.status).not.toBe('closed');
    }
  });

  it('ready count matches the stats counter', async () => {
    const [ready, stats] = await Promise.all([queries.ready(), queries.stats()]);
    expect(ready.length).toBe(stats.ready_issues);
  });

  it('blocked ids are real issues and disjoint from ready', async () => {
    const [ready, blocked, all] = await Promise.all([
      queries.ready(),
      queries.blocked(),
      queries.list({ all: true }),
    ]);
    const ids = new Set(all.map((b) => b.id));
    const readyIds = new Set(ready.map((b) => b.id));
    for (const bead of blocked) {
      expect(ids.has(bead.id), `${bead.id} is blocked but not in the list`).toBe(true);
      // An issue cannot be simultaneously actionable and blocked; if bd ever
      // says both, the board would draw it in two columns.
      expect(readyIds.has(bead.id), `${bead.id} is both ready and blocked`).toBe(false);
    }
  });
});

describe('dashboard snapshot', () => {
  it('is internally consistent — this is exactly what the webview receives', async () => {
    // beads-ui-vscode-ext-l2o: `queries.snapshot()` is itself a seven-way
    // fan-out of independent `bd` calls, and `gateIssueCounts()` is an eighth,
    // still-separate one. All of them hit this repo's real, live board on
    // purpose (see this describe block's own point — "this is exactly what
    // the webview receives" from the real CLI), so a genuine concurrent write
    // from anywhere else between any two of those calls can transiently skew
    // the invariants below even though nothing is actually broken.
    //
    // Chose option (a) (bounded retry) over (b) (isolated scratch project):
    // migrating to a scratch project would lose exactly the coverage this
    // test exists for — organically-grown, real project data — to fix a race
    // that a single re-fetch already resolves. `fetchWithConsistencyRetry`
    // re-runs the *entire* fetch (not just one leg of it) up to once; a
    // mismatch that survives the retry is a real bug and still fails below.
    // See `dashboard-consistency.ts` for the retry itself and
    // `dashboard-consistency.test.ts` for proof it doesn't loop or mask a
    // persistent disagreement.
    const { snapshot, gates } = await fetchWithConsistencyRetry(
      async () => {
        const [snapshot, gates] = await Promise.all([queries.snapshot(), gateIssueCounts()]);
        return { snapshot, gates };
      },
      ({ snapshot, gates }) => ({
        beadIds: new Set(snapshot.beads.map((b) => b.id)),
        beadsLength: snapshot.beads.length,
        gatesTotal: gates.total,
        statsTotalIssues: snapshot.stats.total_issues,
        readyIds: snapshot.readyIds,
        blockedIds: snapshot.blockedIds,
      }),
      isDashboardConsistent,
    );
    const ids = new Set(snapshot.beads.map((b) => b.id));

    expect(snapshot.context.bd_version).toMatch(/\d+\.\d+/);
    expect(snapshot.vocabulary.statuses.length).toBeGreaterThan(0);
    // snapshot.beads comes from `bd list --all`, which excludes gate issues —
    // see `gateIssueCounts`'s doc comment above.
    expect(snapshot.beads.length + gates.total).toBe(snapshot.stats.total_issues);
    expect(snapshot.truncated).toBe(false);
    expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);

    for (const id of snapshot.readyIds) expect(ids.has(id), `ready ${id} missing`).toBe(true);
    for (const id of snapshot.blockedIds) expect(ids.has(id), `blocked ${id} missing`).toBe(true);
  });

  it('flags truncation when the limit bites', async () => {
    // A hardcoded small limit (e.g. 2) only proves truncation while the live
    // board happens to hold more issues than that at the moment the test
    // runs — a board that coincidentally shrank to 2 or fewer real issues
    // would flip this red with zero code being wrong. Measuring the board's
    // own current size first and deriving the limit from it removes that
    // coincidence entirely: `total - 1` is by construction smaller than
    // whatever `bd` is about to hand back, so `beads.length >= limit` (the
    // condition `queries.snapshot` uses to set `truncated`) holds regardless
    // of how large or small the live board is right now.
    const total = (await queries.list({ all: true })).length;
    const limit = Math.max(1, total - 1);
    const snapshot = await queries.snapshot(limit);
    expect(snapshot.beads.length).toBe(limit);
    expect(snapshot.truncated).toBe(true);
  });

  it('every bead lands in exactly one board column', async () => {
    const snapshot = await queries.snapshot();
    const categoryOf = new Map(snapshot.vocabulary.statuses.map((s) => [s.name, s.category]));
    for (const bead of snapshot.beads) {
      // Falls back to 'unspecified' rather than vanishing — assert it is not
      // silently relying on that fallback.
      expect(categoryOf.get(bead.status), `status "${bead.status}" has no column`).toBeDefined();
    }
  });
});

describe('failure handling', () => {
  it('surfaces a missing binary as bd-not-found, not a crash', async () => {
    const broken = new BdService({ cwd: CWD, bdPath: 'bd-does-not-exist-xyz' });
    try {
      await new BdQueries(broken).context();
      expect.unreachable('expected a BdError');
    } catch (error) {
      expect(error).toBeInstanceOf(BdError);
      expect((error as BdError).rpcError.kind).toBe('bd-not-found');
    }
  });

  it('coalesces identical concurrent reads into a single spawn', async () => {
    // Against the real CLI, not the mock: one Dolt open, not three.
    const spawns: string[] = [];
    const bd = new BdService({ cwd: CWD, log: (line) => spawns.push(line) });

    await Promise.all([
      bd.jsonShared(['stats']),
      bd.jsonShared(['stats']),
      bd.jsonShared(['stats']),
    ]);

    expect(spawns.filter((line) => line.startsWith('bd stats'))).toHaveLength(1);
  });
});
