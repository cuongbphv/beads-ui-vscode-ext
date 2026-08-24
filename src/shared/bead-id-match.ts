/**
 * Normalizing and suffix-matching bead ids against short or loosely
 * formatted strings — a worktree directory name (`wt-19r1` for bead
 * `19r.1`, `src/extension/fleet/lib/bead-match.ts`), or a fleet worker's
 * spawn-brief `beadId`, which can itself be a short id
 * (beads-ui-vscode-ext-ayq.5).
 *
 * Normalization case-folds and strips `.` and `_` so `19r.1`, `19R_1`, and
 * `19r1` all normalize to the same token; suffix-matching then treats an
 * exact match as the suffix case where the two normalized strings are equal
 * length.
 *
 * Framework-free (`src/shared/` rule): no `vscode`, no `react`. Both
 * `src/extension/fleet/lib/bead-match.ts` (extension host) and the
 * webview's lease-badge lookup (`worker-list.tsx`) import from here, so
 * there is one normalizer, not two.
 */

export function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[._]/g, '');
}

/**
 * True when `candidate`, once normalized, is a suffix of `target`'s
 * normalized form (an exact match is just the equal-length suffix case).
 * False on empty input rather than throwing.
 */
export function isSuffixMatch(candidate: string, target: string): boolean {
  const normCandidate = normalizeToken(candidate);
  const normTarget = normalizeToken(target);
  if (!normCandidate || !normTarget) return false;

  return normTarget === normCandidate || normTarget.endsWith(normCandidate);
}

/**
 * Resolve `id` (possibly a short id) against the full bead ids keyed in
 * `beadsById`.
 *
 * An exact key hit short-circuits before any scan. Otherwise `id` is
 * suffix-matched (see {@link isSuffixMatch}) against every key, and a match
 * is only accepted when EXACTLY ONE key matches — zero or two-or-more
 * candidates resolve to `undefined` rather than guessing
 * (beads-ui-vscode-ext-ayq.5, DECISION option C: unique-suffix match). An
 * ambiguous short id shared by two beads with different prefixes must never
 * attach to the wrong one.
 */
export function resolveBeadBySuffix<T>(id: string, beadsById: ReadonlyMap<string, T>): T | undefined {
  const exact = beadsById.get(id);
  if (exact !== undefined) return exact;

  const candidates: T[] = [];
  for (const [beadId, value] of beadsById) {
    if (isSuffixMatch(id, beadId)) candidates.push(value);
  }

  return candidates.length === 1 ? candidates[0] : undefined;
}
