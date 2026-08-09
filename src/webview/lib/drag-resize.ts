/**
 * Resize maths for the Roadmap gutter and the detail pane.
 *
 * Pure and DOM-free on purpose: the failure mode of a resize bug is a pane the
 * user cannot drag back, so the clamping rules are worth testing directly.
 */

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
