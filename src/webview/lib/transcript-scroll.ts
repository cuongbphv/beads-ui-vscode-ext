/**
 * Pure scroll-position helpers for the Fleet transcript viewer's "follow"
 * mode: stick to the bottom while new events stream in, but stop the moment
 * the user scrolls up to read something older. No React, no DOM — the
 * component passes in the numbers it already reads off the scroll container.
 */

/** Within `threshold` px of the bottom counts as "at the bottom". */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 40,
): boolean {
  const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
  return distanceFromBottom <= threshold;
}

export interface NextScrollTopParams {
  /** Whether follow mode is currently on. */
  following: boolean;
  scrollTop: number;
  previousScrollHeight: number;
  nextScrollHeight: number;
  clientHeight: number;
}

/**
 * The `scrollTop` to apply after the content's height changes — new events
 * appended, or the oldest ones dropped off the front of the 500-event
 * window.
 *
 * Following: always jump to the new bottom. Not following: keep whatever the
 * reader was looking at pinned in place by carrying the height delta into
 * `scrollTop`, rather than letting the browser's default anchoring (or lack
 * of it) yank the view.
 */
export function nextScrollTop(params: NextScrollTopParams): number {
  const { following, scrollTop, previousScrollHeight, nextScrollHeight, clientHeight } = params;

  if (following) {
    return Math.max(0, nextScrollHeight - clientHeight);
  }

  const delta = nextScrollHeight - previousScrollHeight;
  return Math.max(0, scrollTop + delta);
}
