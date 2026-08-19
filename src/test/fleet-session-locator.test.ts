import { describe, expect, it } from 'vitest';

import {
  encodeProjectDirName,
  findProjectDirFor,
  isProjectDirFor,
} from '../extension/fleet/lib/session-locator';

describe('encodeProjectDirName', () => {
  it('replaces path separators and the drive-letter colon with "-"', () => {
    expect(encodeProjectDirName('C:\\Users\\CuongBPV\\Workspace\\AI\\beads-ui-vscode-ext')).toBe(
      'C--Users-CuongBPV-Workspace-AI-beads-ui-vscode-ext',
    );
  });

  it('handles a POSIX path the same way', () => {
    expect(encodeProjectDirName('/Users/cuongbpv/Projects/beads-ui-vscode-ext')).toBe(
      '-Users-cuongbpv-Projects-beads-ui-vscode-ext',
    );
  });

  it('returns an empty string for empty input, without throwing', () => {
    expect(() => encodeProjectDirName('')).not.toThrow();
    expect(encodeProjectDirName('')).toBe('');
  });
});

describe('isProjectDirFor', () => {
  // Ground truth from this machine's ~/.claude/projects: two transcripts with
  // the identical `cwd` "C:\Users\CuongBPV\Workspace\AI\...engine" and the
  // same Claude Code version produced directory names differing only in the
  // drive letter's case (`C--...` vs `c--...`). The encoded case is
  // therefore not trustworthy, so matching must be case-insensitive to work
  // for both observed forms — this is what the test below checks.
  it('matches regardless of the drive letter or directory name casing', () => {
    expect(
      isProjectDirFor(
        'c--Users-CuongBPV-Workspace-AI-beads-ui-vscode-ext',
        'C:\\Users\\CuongBPV\\Workspace\\AI\\beads-ui-vscode-ext',
      ),
    ).toBe(true);
    expect(
      isProjectDirFor(
        'C--Users-CuongBPV-Workspace-AI-beads-ui-vscode-ext',
        'C:\\Users\\CuongBPV\\Workspace\\AI\\beads-ui-vscode-ext',
      ),
    ).toBe(true);
  });

  it('rejects an unrelated directory name', () => {
    expect(isProjectDirFor('c--Users-someone-else-repo', 'C:\\Users\\CuongBPV\\Workspace\\AI\\beads-ui-vscode-ext')).toBe(
      false,
    );
  });

  it('returns false rather than throwing on an empty directory name', () => {
    expect(() => isProjectDirFor('', 'C:\\Users\\CuongBPV\\Workspace\\AI\\beads-ui-vscode-ext')).not.toThrow();
    expect(isProjectDirFor('', 'C:\\Users\\CuongBPV\\Workspace\\AI\\beads-ui-vscode-ext')).toBe(false);
  });
});

describe('findProjectDirFor', () => {
  it('picks the matching name out of a list seen on disk, case-insensitively', () => {
    const names = [
      'C--Users-CuongBPV-Workspace-AI-ai-sdlc-dev-engine',
      'c--Users-CuongBPV-Workspace-AI-beads-ui-vscode-ext',
      'c--Users-CuongBPV-Workspace-AI-wt-7pi',
    ];
    expect(findProjectDirFor(names, 'C:\\Users\\CuongBPV\\Workspace\\AI\\beads-ui-vscode-ext')).toBe(
      'c--Users-CuongBPV-Workspace-AI-beads-ui-vscode-ext',
    );
  });

  it('returns null when nothing matches', () => {
    expect(findProjectDirFor(['c--Users-a-b'], 'C:\\Users\\CuongBPV\\Workspace\\AI\\beads-ui-vscode-ext')).toBeNull();
  });
});
