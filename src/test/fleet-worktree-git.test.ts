/**
 * `worktree-git.ts` against a real, throwaway git repository — the process
 * spawn and its argv shape are the subject here, not the text parsing (that
 * is `fleet-git-parse.test.ts`'s job, over `./lib/git-parse.ts`).
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listWorktrees, WorktreeGitProbe } from '../extension/fleet/worktree-git';

let root: string;
let repo: string;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fleet-worktree-git-test-'));
  repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });

  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'a.txt'), 'one\n', 'utf8');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'initial']);
});

afterEach(async () => {
  // Windows can briefly hold a directory handle open right after it served as
  // a spawned git process's cwd; `maxRetries`/`retryDelay` are Node's own
  // remedy for exactly that EBUSY/ENOTEMPTY race, rather than this file
  // inventing its own retry loop.
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('listWorktrees', () => {
  it('lists the primary checkout with its branch', async () => {
    const worktrees = await listWorktrees(repo);

    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]).toMatchObject({ path: repo.replace(/\\/g, '/'), branch: 'refs/heads/main', bare: false });
    // `path`'s own last segment is the dir name, regardless of separator style.
    expect(worktrees[0].dirName).toBe('repo');
  });

  it('lists an added worktree alongside the primary checkout', async () => {
    const wtPath = join(root, 'wt-x');
    git(repo, ['worktree', 'add', '-q', '-b', 'work/x', wtPath, 'main']);

    const worktrees = await listWorktrees(repo);

    expect(worktrees.map((w) => w.dirName).sort()).toEqual(['repo', 'wt-x']);
    const added = worktrees.find((w) => w.dirName === 'wt-x');
    expect(added?.branch).toBe('refs/heads/work/x');
    expect(added?.bare).toBe(false);
  });
});

describe('WorktreeGitProbe.statusFor', () => {
  it('reports a clean worktree as zero changed files with no error', async () => {
    const probe = new WorktreeGitProbe();
    const status = await probe.statusFor(repo, 'main');

    expect(status).toMatchObject({ branch: 'main', changedFiles: 0, insertions: 0, deletions: 0 });
    expect(status.error).toBeUndefined();
  });

  it('counts an untracked file as one changed file', async () => {
    await writeFile(join(repo, 'untracked.txt'), 'x\n', 'utf8');

    const probe = new WorktreeGitProbe();
    const status = await probe.statusFor(repo, 'main');

    expect(status.changedFiles).toBe(1);
  });

  it('sums insertions/deletions from a tracked-file edit via diff HEAD --numstat', async () => {
    await writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\n', 'utf8');

    const probe = new WorktreeGitProbe();
    const status = await probe.statusFor(repo, 'main');

    expect(status.insertions).toBe(2);
    expect(status.deletions).toBe(0);
    expect(status.changedFiles).toBe(1);
  });

  it('reports git.error inline, rather than throwing, for a path that is not a git repo', async () => {
    const notARepo = join(root, 'not-a-repo');
    await mkdir(notARepo, { recursive: true });

    const probe = new WorktreeGitProbe();
    const status = await probe.statusFor(notARepo, null);

    expect(status.error).toBeTruthy();
    expect(status.changedFiles).toBe(0);
    expect(status.insertions).toBe(0);
    expect(status.deletions).toBe(0);
  });

  it('rate-limits: a second call inside the window reuses the cached reading', async () => {
    let clock = 0;
    const probe = new WorktreeGitProbe(3_000, () => clock);

    const first = await probe.statusFor(repo, 'main');
    expect(first.changedFiles).toBe(0);

    await writeFile(join(repo, 'new-since-first-read.txt'), 'x\n', 'utf8');
    clock += 1_000; // inside the 3s window

    const second = await probe.statusFor(repo, 'main');
    expect(second).toBe(first); // same cached object, not a fresh measurement
    expect(second.changedFiles).toBe(0); // still blind to the new file
  });

  it('re-measures once the rate-limit window has passed', async () => {
    let clock = 0;
    const probe = new WorktreeGitProbe(3_000, () => clock);

    await probe.statusFor(repo, 'main');

    await writeFile(join(repo, 'new-since-first-read.txt'), 'x\n', 'utf8');
    clock += 3_001; // past the 3s window

    const second = await probe.statusFor(repo, 'main');
    expect(second.changedFiles).toBe(1);
  });

  it('caches independently per worktree path', async () => {
    const wtPath = join(root, 'wt-y');
    git(repo, ['worktree', 'add', '-q', '-b', 'work/y', wtPath, 'main']);

    const clock = 0;
    const probe = new WorktreeGitProbe(3_000, () => clock);

    await probe.statusFor(repo, 'main');
    await writeFile(join(wtPath, 'only-in-y.txt'), 'x\n', 'utf8');

    // Measuring the *other* worktree at the same clock time must not be
    // suppressed by the first worktree's cache entry.
    const yStatus = await probe.statusFor(wtPath, 'work/y');
    expect(yStatus.changedFiles).toBe(1);
  });
});
