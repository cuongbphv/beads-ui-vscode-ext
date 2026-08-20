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
