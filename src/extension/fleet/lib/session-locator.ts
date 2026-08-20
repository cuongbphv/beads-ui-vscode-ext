/**
 * The pure half of locating which `~/.claude/projects/<dir>` corresponds to a
 * given absolute path (a repo root or a worktree). The impure half — listing
 * that directory and reading session files inside it — belongs to
 * `FleetService` (P3), not here.
 *
 * Claude Code encodes a cwd into a project directory name by replacing every
 * path separator and `:` with `-` — e.g. `C:\Users\me\repo` becomes
 * `C--Users-me-repo`. That transform is lossy (a real `-` in a folder name
 * is indistinguishable from an encoded separator), so a directory name is
 * never decoded back into a path here; instead, a candidate path is
 * re-encoded the same way and compared.
 *
 * The drive letter's case in the *encoded name* is not reliable: two
 * transcripts observed on this machine, from the same Claude Code version
 * and with an identically-cased `cwd` field, produced one project directory
 * starting `C--` and one starting `c--`. [Unverified] why the two differ —
 * this file does not depend on it, since every comparison here is
 * case-insensitive.
 */

/** Mirror Claude Code's own project-directory encoding for a cwd (separators only; case is left as-is). */
export function encodeProjectDirName(absolutePath: string): string {
  if (typeof absolutePath !== 'string' || absolutePath.length === 0) return '';

  const withForwardSlashes = absolutePath.replace(/\\/g, '/');
  return withForwardSlashes.replace(/[/:]/g, '-');
}

/** True when `dirName` is plausibly the encoded project directory for `absolutePath`. */
export function isProjectDirFor(dirName: string, absolutePath: string): boolean {
  if (typeof dirName !== 'string' || !dirName) return false;
  const encoded = encodeProjectDirName(absolutePath);
  return encoded.length > 0 && dirName.toLowerCase() === encoded.toLowerCase();
}

/**
 * Pick the directory name in `dirNames` (as seen on disk) that matches
 * `absolutePath`. Returns `null` when none do.
 */
export function findProjectDirFor(dirNames: string[], absolutePath: string): string | null {
  const encoded = encodeProjectDirName(absolutePath).toLowerCase();
  if (!encoded) return null;
  return dirNames.find((name) => name.toLowerCase() === encoded) ?? null;
}
