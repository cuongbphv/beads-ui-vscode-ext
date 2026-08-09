/**
 * Resize maths for the Roadmap gutter and the detail pane.
 *
 * Pure and DOM-free on purpose: the failure mode of a resize bug is a pane the
 * user cannot drag back, so the clamping rules are worth testing directly.
 */

/** Matches today's `w-96`, so nothing moves until the user drags. */
export const DETAIL_DEFAULT_PX = 384;
export const DETAIL_MIN_PX = 320;
export const DETAIL_MAX_SHARE = 0.7;
export const ROADMAP_GUTTER_MIN_PX = 120;
export const ROADMAP_GUTTER_MAX_SHARE = 0.6;

export interface Range {
  min: number;
  max: number;
}

/** Keyboard nudge in px. Shift multiplies it. */
export const STEP = 16;
export const STEP_LARGE = 64;

/**
 * `max` can legitimately fall below `min` — a percentage-derived maximum in a
 * container narrower than the minimum. Returning `min` keeps the pane usable
 * instead of inverting the range.
 */
export function clamp(px: number, range: Range): number {
  if (range.max < range.min) return range.min;
  return Math.min(Math.max(Math.round(px), range.min), range.max);
}

/**
 * Calculate the maximum width for the detail pane as a share of the container.
 *
 * If the container is narrower than the minimum width, returns the minimum
 * to prevent an inverted range (consistent with `clamp`'s convention).
 */
export function detailMaxWidth(containerWidth: number): number {
  const max = Math.round(containerWidth * DETAIL_MAX_SHARE);
  // Ensure max >= min to prevent inverted range (consistent with clamp's pattern)
  return Math.max(max, DETAIL_MIN_PX);
}

/** A valid gutter range before and after the Roadmap pane is measured. */
export function roadmapGutterRange(containerWidth: number): Range {
  return {
    min: ROADMAP_GUTTER_MIN_PX,
    max: Math.max(
      Math.round(containerWidth * ROADMAP_GUTTER_MAX_SHARE),
      ROADMAP_GUTTER_MIN_PX,
    ),
  };
}

/**
 * `sign` is the direction the size grows in relative to the pointer: 1 for a
 * pane that lives to the left of its handle, -1 for one that lives to the right.
 */
export function sizeFromDrag(
  startSize: number,
  deltaX: number,
  sign: 1 | -1,
  range: Range,
): number {
  return clamp(startSize + sign * deltaX, range);
}

/** `undefined` means the key is not ours — leave the event alone. */
export function keyResize(
  key: string,
  shift: boolean,
  current: number,
  range: Range,
  sign: 1 | -1 = 1,
): number | undefined {
  const step = (shift ? STEP_LARGE : STEP) * sign;
  switch (key) {
    case 'ArrowRight':
      return clamp(current + step, range);
    case 'ArrowLeft':
      return clamp(current - step, range);
    case 'Home':
      return clamp(range.min, range);
    case 'End':
      return clamp(range.max, range);
    default:
      return undefined;
  }
}

/**
 * Guard for a splitter's pointermove.
 *
 * `dragging` alone is not enough: the browser can fire `pointercancel` (window
 * blur, an OS gesture) and silently drop the capture, after which every hover
 * over the handle would keep resizing. Requiring live capture as well means a
 * drag we no longer own cannot move anything.
 *
 * It lives here rather than beside the hook so the test can reach it without
 * pulling a DOM-typed module into the extension-host tsconfig, whose `lib` is
 * ES2023 with no DOM.
 */
export function shouldActOnPointerMove(dragging: boolean, captureStillHeld: boolean): boolean {
  return dragging && captureStillHeld;
}
