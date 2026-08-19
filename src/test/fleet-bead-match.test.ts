import { describe, expect, it } from 'vitest';

import { matchWorktreesToBeads, worktreeNameMatchesBeadId } from '../extension/fleet/lib/bead-match';

describe('worktreeNameMatchesBeadId', () => {
  it('matches a worktree name that has lost its dot separator, via suffix-match after normalizing', () => {
    // Observed on this machine: `git worktree list` shows directory
    // `wt-19r1` (no dot) for a bead whose short id is `19r.1` (with dot).
    expect(worktreeNameMatchesBeadId('wt-19r1', '19r.1')).toBe(true);
  });

  it('matches when the dot is kept on both sides', () => {
    expect(worktreeNameMatchesBeadId('wt-beads-ui-vscode-ext-43p.3', 'beads-ui-vscode-ext-43p.3')).toBe(true);
  });

  it('matches a short worktree name against a fully-qualified bead id via suffix', () => {
    expect(worktreeNameMatchesBeadId('wt-19r1', 'beads-ui-vscode-ext-19r.1')).toBe(true);
  });

  it('does not match an unrelated worktree and bead id', () => {
    expect(worktreeNameMatchesBeadId('wt-19r1', 'beads-ui-vscode-ext-7pi')).toBe(false);
  });

  it('does not match when the worktree name is a prefix rather than a suffix of the bead id', () => {
    expect(worktreeNameMatchesBeadId('wt-beads', 'beads-ui-vscode-ext-7pi')).toBe(false);
  });

  it('returns false rather than throwing on empty or missing input', () => {
    expect(() => worktreeNameMatchesBeadId('', '')).not.toThrow();
    expect(worktreeNameMatchesBeadId('', '')).toBe(false);
    expect(worktreeNameMatchesBeadId('wt-19r1', '')).toBe(false);
  });
});

describe('matchWorktreesToBeads', () => {
  it('matches a worktree to a worker by exact path first', () => {
    const result = matchWorktreesToBeads(
      [{ path: 'C:\\ws\\wt-7pi', dirName: 'wt-7pi' }],
      [{ agentId: 'a1', beadId: 'beads-ui-vscode-ext-7pi', worktreePath: 'C:\\ws\\wt-7pi' }],
    );
    expect(result.worktreeToBeadId.get('C:\\ws\\wt-7pi')).toBe('beads-ui-vscode-ext-7pi');
    expect(result.orphanWorktrees).toEqual([]);
  });

  it('falls back to a directory-name match when no worker names the exact path', () => {
    const result = matchWorktreesToBeads(
      [{ path: 'C:\\ws\\wt-19r1', dirName: 'wt-19r1' }],
      [{ agentId: 'a1', beadId: '19r.1', worktreePath: null }],
    );
    expect(result.worktreeToBeadId.get('C:\\ws\\wt-19r1')).toBe('19r.1');
  });

  it('reports a worktree with no matching worker as an orphan', () => {
    const result = matchWorktreesToBeads(
      [{ path: 'C:\\ws\\wt-stale', dirName: 'wt-stale' }],
      [{ agentId: 'a1', beadId: 'beads-ui-vscode-ext-7pi', worktreePath: 'C:\\ws\\wt-7pi' }],
    );
    expect(result.orphanWorktrees).toEqual(['C:\\ws\\wt-stale']);
    expect(result.worktreeToBeadId.size).toBe(0);
  });

  it('matches worktree path across backslash/forward-slash and trailing-slash differences', () => {
    const result = matchWorktreesToBeads(
      [{ path: 'C:/ws/wt-7pi/', dirName: 'wt-7pi' }],
      [{ agentId: 'a1', beadId: 'beads-ui-vscode-ext-7pi', worktreePath: 'C:\\ws\\wt-7pi' }],
    );
    expect(result.worktreeToBeadId.get('C:/ws/wt-7pi/')).toBe('beads-ui-vscode-ext-7pi');
  });
});
