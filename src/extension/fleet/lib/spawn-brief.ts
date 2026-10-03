/**
 * Extracting a bead id and worktree path from a fleet worker's spawn brief —
 * the first user message sent to spawn a subagent (see `bead-fleet`, `bead-take`).
 *
 * Briefs are free text written in Vietnamese or English, not a structured
 * format, so this is heuristic pattern matching rather than a strict parser:
 * it looks for the phrase "bead <id>" and the nearest absolute path that
 * looks like a worktree directory (`wt-*`).
 */

export interface SpawnBriefMatch {
  beadId: string;
  worktreePath: string;
}

// "bead <id>" / "bead `<id>`" — Vietnamese briefs say "nhận bead X", English
// briefs say "implementing bead `X`"; both put the id right after the word.
const BEAD_ID_RE = /\bbeads?\s+`?([A-Za-z][A-Za-z0-9._-]*)`?/i;

// An absolute Windows (`C:\...`) or POSIX (`/...`) path. Matches are trimmed
// of trailing punctuation separately, since a brief's prose often runs a
// path straight into a comma or period.
const PATH_RE = /`?([A-Za-z]:[\\/][^\s`]+|\/[^\s`]+)`?/g;

function stripTrailingPunctuation(path: string): string {
  return path.replace(/[.,;:)]+$/, '');
}

/**
 * Parse a spawn brief for the bead id and worktree path it names.
 *
 * Returns `null` when either piece cannot be found — the caller then leaves
 * the worker unmatched rather than guessing at a bead or path.
 */
export function parseSpawnBrief(text: string): SpawnBriefMatch | null {
  if (typeof text !== 'string' || !text.trim()) return null;

  const beadMatch = BEAD_ID_RE.exec(text);
  if (!beadMatch) return null;

  const paths = Array.from(text.matchAll(PATH_RE), (match) => stripTrailingPunctuation(match[1]));
  if (paths.length === 0) return null;

  // Prefer a path whose last segment is a `wt-*` worktree directory; fall
  // back to the first absolute path in the brief.
  const worktreePath = paths.find((path) => /[\\/]wt-[^\\/]+$/i.test(path)) ?? paths[0];

  return { beadId: beadMatch[1], worktreePath };
}

/** Codex task names can carry an issue ID even when the free-text brief only
 * names a worktree. This narrow prefix is intentional: generic names such as
 * `ready` or `workspace` are not ownership evidence. */
function beadFromCodexTaskName(taskName: string): string | null {
  const match = /^(?:work[_-])?bead[_-]([a-z][a-z0-9]*)(?:[._-](\d+))?$/i.exec(taskName);
  return match ? `${match[1]}${match[2] ? `.${match[2]}` : ''}` : null;
}

function identity(value: string): string {
  return value.toLowerCase().replace(/[._-]/g, '');
}

function matchesBead(worktreePath: string, beadId: string): boolean {
  const dirName = worktreePath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? '';
  if (!/^wt-/i.test(dirName)) return false;
  const worktreeId = identity(dirName.slice(3));
  const bead = identity(beadId);
  return worktreeId.length > 0 && (bead === worktreeId || bead.endsWith(worktreeId) || worktreeId.endsWith(bead));
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
    b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Resolve only evidence-backed Codex assignments. A brief may name the bead
 * and omit its path, or use a structured `bead_mk0_15` task name and name the
 * worktree. In either case exactly one worktree must match; generic tasks and
 * ambiguous candidates remain unclaimed.
 *
 * Claude's existing `parseSpawnBrief` contract is deliberately untouched.
 */
export function parseCodexAssignment(
  brief: string,
  taskName: string,
  worktreePaths: readonly string[],
): SpawnBriefMatch | null {
  const explicitIds = [...brief.matchAll(/\bbeads?\s+`?([A-Za-z][A-Za-z0-9._-]*)`?/gi)]
    .map((match) => stripTrailingPunctuation(match[1]));
  const distinctIds = [...new Set(explicitIds.map(identity))];
  if (distinctIds.length > 1) return null;

  const namedId = beadFromCodexTaskName(taskName);
  const beadId = explicitIds[0] ?? namedId;
  if (!beadId) return null;
  if (namedId && !identity(beadId).endsWith(identity(namedId))) return null;

  const explicitPaths = [...brief.matchAll(PATH_RE)]
    .map((match) => stripTrailingPunctuation(match[1]))
    .filter((candidate) => /[\\/]wt-[^\\/]+$/i.test(candidate));
  const uniqueExplicit = explicitPaths.filter((candidate, index) =>
    explicitPaths.findIndex((other) => samePath(candidate, other)) === index);
  if (uniqueExplicit.length > 1) return null;

  if (uniqueExplicit.length === 1) {
    return matchesBead(uniqueExplicit[0], beadId)
      ? { beadId, worktreePath: uniqueExplicit[0] } : null;
  }

  const candidates = worktreePaths.filter((candidate) => matchesBead(candidate, beadId));
  return candidates.length === 1 ? { beadId, worktreePath: candidates[0] } : null;
}
