import { describe, expect, it } from 'vitest';

import { parseSpawnBrief } from '../extension/fleet/lib/spawn-brief';

describe('parseSpawnBrief', () => {
  it('parses a Vietnamese brief and keeps its diacritics — bead id and worktree path with a dot preserved', () => {
    // Modeled on a real bead-take/bead-fleet spawn brief observed on this
    // machine (~/.claude/projects/.../subagents/agent-*.jsonl): Vietnamese
    // prose around an ASCII bead id and an absolute Windows worktree path.
    const brief =
      'Bạn nhận bead beads-ui-vscode-ext-43p.3 trong dự án beads-ui-vscode-ext. ' +
      'Làm việc TRONG worktree đã tạo sẵn tại đường dẫn tuyệt đối:\n' +
      '  C:\\Users\\CuongBPV\\Workspace\\AI\\wt-beads-ui-vscode-ext-43p.3\n' +
      '(nhánh git: fix/43p-something, đã checkout từ develop). TUYỆT ĐỐI không chạm cây chính.';

    const result = parseSpawnBrief(brief);

    expect(result).not.toBeNull();
    // The dot in "43p.3" must survive — it is significant (a subtask id),
    // not punctuation to be stripped.
    expect(result?.beadId).toBe('beads-ui-vscode-ext-43p.3');
    expect(result?.worktreePath).toBe('C:\\Users\\CuongBPV\\Workspace\\AI\\wt-beads-ui-vscode-ext-43p.3');
  });

  it('parses an English spawn brief', () => {
    const brief =
      'You are implementing bead `beads-ui-vscode-ext-7pi` in a dedicated worktree: ' +
      '`c:\\Users\\CuongBPV\\Workspace\\AI\\wt-7pi`. ONLY this bead.';

    const result = parseSpawnBrief(brief);

    expect(result).toEqual({
      beadId: 'beads-ui-vscode-ext-7pi',
      worktreePath: 'c:\\Users\\CuongBPV\\Workspace\\AI\\wt-7pi',
    });
  });

  it('returns null when no bead id is mentioned', () => {
    expect(parseSpawnBrief('Please review the file at C:\\Users\\me\\repo\\src\\index.ts.')).toBeNull();
  });

  it('returns null when no absolute path is present', () => {
    expect(parseSpawnBrief('You are implementing bead abc-123 somewhere.')).toBeNull();
  });

  it('returns null for empty or non-string input, without throwing', () => {
    expect(() => parseSpawnBrief('')).not.toThrow();
    expect(parseSpawnBrief('')).toBeNull();
    // @ts-expect-error deliberately passing a non-string to prove no throw on bad input
    expect(parseSpawnBrief(null)).toBeNull();
  });

  it('prefers the wt-* worktree path over an unrelated absolute path mentioned earlier', () => {
    const brief =
      'Dùng Python venv chung của repo qua đường dẫn tuyệt đối: C:\\Users\\me\\repo\\.venv\\Scripts\\python.exe. ' +
      'Bạn nhận bead velox-bez trong dự án velox. Làm việc TRONG worktree tại: C:\\Users\\me\\Workspace\\wt-velox-bez';

    const result = parseSpawnBrief(brief);

    expect(result?.worktreePath).toBe('C:\\Users\\me\\Workspace\\wt-velox-bez');
  });
});
