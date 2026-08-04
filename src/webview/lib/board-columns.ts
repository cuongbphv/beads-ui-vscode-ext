/**
 * Which board columns are folded away, and what an empty one has to say.
 *
 * Kept out of the view so both are testable: "done starts collapsed" is a
 * product decision with an off-by-one waiting in it (an empty stored list is
 * not the same as no stored list), and the empty-state sentences are content.
 */
import type { StatusCategory } from '../../shared/types';

/**
 * Finished work is the one column that only ever grows, so it is the one column
 * least worth scrolling. It starts folded until the user says otherwise.
 *
 * This is a status *category*, never a status name — a project whose custom
 * `shipped` status is categorised `done` folds away with it.
 */
export const DEFAULT_COLLAPSED: readonly StatusCategory[] = ['done'];

/**
 * `undefined` means the user has never touched a column and gets the default.
 * An empty array means they deliberately unfolded everything, which is why the
 * two cannot be collapsed into one falsy check.
 */
export function collapsedSet(stored: StatusCategory[] | undefined): Set<StatusCategory> {
  return new Set(stored ?? DEFAULT_COLLAPSED);
}

/** The next stored value after folding or unfolding one column. */
export function toggleCollapsed(
  stored: StatusCategory[] | undefined,
  category: StatusCategory,
): StatusCategory[] {
  const next = collapsedSet(stored);
  if (!next.delete(category)) next.add(category);
  return [...next];
}

/**
 * An empty column is a fact about the project, not a gap in the UI. "Nobody is
 * working on anything" and "nothing is on hold" are different answers and read
 * as different sentences; one generic "Drop an issue here" throws that away.
 */
export const CATEGORY_EMPTY_TEXT: Record<StatusCategory, string> = {
  active: 'Nothing waiting to start',
  wip: 'No work in flight',
  frozen: 'Nothing on hold',
  done: 'Nothing finished yet',
  unspecified: 'Nothing here',
};
