import { describe, expect, it } from 'vitest';

import { parseNumstat, parseStatusPorcelainZ, parseWorktreeList } from '../extension/fleet/lib/git-parse';

describe('parseWorktreeList', () => {
  it('parses multiple worktrees, including a detached one and the bare main entry', () => {
    const output = [
      'worktree C:/Users/me/repo',
      'HEAD abc123',
      'branch refs/heads/develop',
      '',
      'worktree C:/Users/me/wt-19r1',
      'HEAD def456',
      'branch refs/heads/feature/19r1',
      '',
      'worktree C:/Users/me/wt-detached',
      'HEAD ff0011',
      'detached',
      '',
    ].join('\n');

    const entries = parseWorktreeList(output);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      path: 'C:/Users/me/repo',
      head: 'abc123',
      branch: 'refs/heads/develop',
      bare: false,
      detached: false,
      locked: false,
    });
    expect(entries[1].branch).toBe('refs/heads/feature/19r1');
    expect(entries[2].detached).toBe(true);
    expect(entries[2].branch).toBeNull();
  });

  it('marks a locked worktree', () => {
    const output = 'worktree C:/ws/wt-locked\nHEAD abc\nbranch refs/heads/x\nlocked reason here\n';
    const entries = parseWorktreeList(output);
    expect(entries[0].locked).toBe(true);
  });

  it('returns an empty array for empty or malformed input, without throwing', () => {
    expect(() => parseWorktreeList('')).not.toThrow();
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('garbage\nnot a worktree listing at all')).toEqual([]);
  });
});

describe('parseStatusPorcelainZ', () => {
  it('parses simple modified/untracked entries', () => {
    const output = [' M src/a.ts', '?? src/new.ts'].join('\0') + '\0';
    const entries = parseStatusPorcelainZ(output);
    expect(entries).toEqual([
      { path: 'src/a.ts', indexStatus: ' ', worktreeStatus: 'M' },
      { path: 'src/new.ts', indexStatus: '?', worktreeStatus: '?' },
    ]);
  });

  it('consumes the extra NUL-terminated field for a rename entry', () => {
    const output = ['R  src/b.ts', 'src/old.ts', ' M src/c.ts'].join('\0') + '\0';
    const entries = parseStatusPorcelainZ(output);
    expect(entries).toEqual([
      { path: 'src/b.ts', indexStatus: 'R', worktreeStatus: ' ' },
      { path: 'src/c.ts', indexStatus: ' ', worktreeStatus: 'M' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseStatusPorcelainZ('')).toEqual([]);
  });
});

describe('parseNumstat', () => {
  it('parses added/deleted line counts', () => {
    const output = '3\t1\tsrc/foo.ts\n0\t5\tsrc/bar.ts\n';
    expect(parseNumstat(output)).toEqual([
      { path: 'src/foo.ts', insertions: 3, deletions: 1, binary: false },
      { path: 'src/bar.ts', insertions: 0, deletions: 5, binary: false },
    ]);
  });

  it('marks a binary file (`-\\t-\\t<path>`) without treating "-" as a number', () => {
    const output = '-\t-\tassets/logo.png\n';
    expect(parseNumstat(output)).toEqual([{ path: 'assets/logo.png', insertions: 0, deletions: 0, binary: true }]);
  });

  it('returns an empty array for empty or unparseable input', () => {
    expect(parseNumstat('')).toEqual([]);
    expect(parseNumstat('not a numstat line')).toEqual([]);
  });
});
