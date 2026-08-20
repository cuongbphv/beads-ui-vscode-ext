/**
 * Parsing the raw stdout of the three git invocations the Fleet tab's
 * worktree-git-status probe uses: `git worktree list --porcelain`,
 * `git status --porcelain=v1 -z`, and `git diff HEAD --numstat`.
 *
 * All three are plain text parsers with no knowledge of git itself — the
 * process spawn and its error handling belong to `worktree-git.ts` (P3), not
 * here. Malformed or empty input yields an empty array rather than a throw.
 */

export interface ParsedWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
}

/** Parse `git worktree list --porcelain` output into one entry per worktree. */
export function parseWorktreeList(output: string): ParsedWorktree[] {
  if (typeof output !== 'string' || !output.trim()) return [];

  // Entries are separated by a blank line.
  const entries = output.split(/\r?\n\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  const result: ParsedWorktree[] = [];

  for (const entry of entries) {
    let path = '';
    let head: string | null = null;
    let branch: string | null = null;
    let bare = false;
    let detached = false;
    let locked = false;

    for (const line of entry.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim();
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim();
      else if (line === 'bare') bare = true;
      else if (line === 'detached') detached = true;
      else if (line.startsWith('locked')) locked = true;
    }

    if (path) result.push({ path, head, branch, bare, detached, locked });
  }

  return result;
}

export interface StatusEntry {
  path: string;
  /** First status column — the index (staged) state. */
  indexStatus: string;
  /** Second status column — the working-tree state. */
  worktreeStatus: string;
}

/**
 * Parse `git status --porcelain=v1 -z` output. Entries are NUL-separated;
 * a rename or copy entry (`R`/`C` in the index column) carries the original
 * path as its own following NUL-terminated field, which is consumed and
 * dropped since only the current path is needed here.
 */
export function parseStatusPorcelainZ(output: string): StatusEntry[] {
  if (typeof output !== 'string' || !output) return [];

  const parts = output.split('\0').filter((part) => part.length > 0);
  const entries: StatusEntry[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length < 3) continue;

    const indexStatus = part[0];
    const worktreeStatus = part[1];
    const path = part.slice(3);
    entries.push({ path, indexStatus, worktreeStatus });

    if ((indexStatus === 'R' || indexStatus === 'C') && i + 1 < parts.length) i += 1;
  }

  return entries;
}

export interface NumstatEntry {
  path: string;
  insertions: number;
  deletions: number;
  /** True for a binary file, which `--numstat` reports as `-\t-\t<path>`. */
  binary: boolean;
}

/** Parse `git diff --numstat` output. */
export function parseNumstat(output: string): NumstatEntry[] {
  if (typeof output !== 'string' || !output.trim()) return [];

  const entries: NumstatEntry[] = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!match) continue;

    const [, added, deleted, path] = match;
    const binary = added === '-' || deleted === '-';
    entries.push({
      path,
      insertions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(deleted),
      binary,
    });
  }

  return entries;
}
