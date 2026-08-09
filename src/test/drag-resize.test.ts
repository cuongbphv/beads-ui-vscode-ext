import { describe, expect, it } from 'vitest';

import {
  clamp,
  DETAIL_MIN_PX,
  detailMaxWidth,
  keyResize,
  roadmapGutterRange,
  shouldActOnPointerMove,
  sizeFromDrag,
} from '../webview/lib/drag-resize';

const RANGE = { min: 120, max: 400 };

describe('clamp', () => {
  it('holds the value inside the range', () => {
    expect(clamp(50, RANGE)).toBe(120);
    expect(clamp(300, RANGE)).toBe(300);
    expect(clamp(999, RANGE)).toBe(400);
  });

  it('rounds to whole pixels', () => {
    expect(clamp(200.6, RANGE)).toBe(201);
  });

  it('collapses to min when the container is too small for the range', () => {
    // A pane whose max has fallen below its min must still return something
    // renderable rather than an inverted range.
    expect(clamp(300, { min: 320, max: 100 })).toBe(320);
  });
});

describe('sizeFromDrag', () => {
  it('grows with the pointer when sign is 1', () => {
    expect(sizeFromDrag(200, 40, 1, RANGE)).toBe(240);
  });

  it('shrinks with the pointer when sign is -1', () => {
    expect(sizeFromDrag(200, 40, -1, RANGE)).toBe(160);
  });

  it('clamps the result', () => {
    expect(sizeFromDrag(390, 100, 1, RANGE)).toBe(400);
  });
});

describe('keyResize', () => {
  it('nudges by 16px and by 64px with Shift', () => {
    expect(keyResize('ArrowRight', false, 200, RANGE)).toBe(216);
    expect(keyResize('ArrowRight', true, 200, RANGE)).toBe(264);
    expect(keyResize('ArrowLeft', false, 200, RANGE)).toBe(184);
  });

  it('honours the sign so an inverted splitter still grows rightward on ArrowRight', () => {
    expect(keyResize('ArrowRight', false, 200, RANGE, -1)).toBe(184);
    expect(keyResize('ArrowLeft', false, 200, RANGE, -1)).toBe(216);
  });

  it('jumps to the bounds on Home and End', () => {
    expect(keyResize('Home', false, 200, RANGE)).toBe(120);
    expect(keyResize('End', false, 200, RANGE)).toBe(400);
  });

  it('returns undefined for keys it does not own', () => {
    expect(keyResize('Enter', false, 200, RANGE)).toBeUndefined();
    expect(keyResize('a', false, 200, RANGE)).toBeUndefined();
  });
});

describe('shouldActOnPointerMove', () => {
  it('returns true only when dragging and capture is held', () => {
    expect(shouldActOnPointerMove(true, true)).toBe(true);
    // The middle case is the one that matters: a drag whose capture the
    // browser silently dropped must not keep resizing on a plain hover.
    expect(shouldActOnPointerMove(true, false)).toBe(false);
    expect(shouldActOnPointerMove(false, true)).toBe(false);
    expect(shouldActOnPointerMove(false, false)).toBe(false);
  });
});

describe('detailMaxWidth', () => {
  it('calculates max as a share of container width at typical widths', () => {
    // 600 * 0.7 = 420
    expect(detailMaxWidth(600)).toBe(420);
    // 1000 * 0.7 = 700
    expect(detailMaxWidth(1000)).toBe(700);
  });

  it('returns min when container is narrower than minimum', () => {
    // 400 * 0.7 = 280, which is less than min (320), so returns min
    expect(detailMaxWidth(400)).toBe(DETAIL_MIN_PX);
    expect(detailMaxWidth(400)).toBe(320);
  });

  it('returns min when container width is zero', () => {
    // Prevents inverted range before ResizeObserver fires
    expect(detailMaxWidth(0)).toBe(DETAIL_MIN_PX);
    expect(detailMaxWidth(0)).toBe(320);
  });
});

describe('roadmapGutterRange', () => {
  it('normalizes the unmeasured viewport to a valid minimum-only range', () => {
    // Catches the initial `{ min: 120, max: 0 }` range that made the
    // splitter's current ARIA value exceed its advertised maximum.
    expect(roadmapGutterRange(0)).toEqual({ min: 120, max: 120 });
  });

  it('uses sixty percent of a measured viewport as the maximum', () => {
    // Catches freezing the initial fallback after ResizeObserver reports or
    // accidentally using the full viewport rather than the intended share.
    expect(roadmapGutterRange(1000)).toEqual({ min: 120, max: 600 });
    expect(roadmapGutterRange(641)).toEqual({ min: 120, max: 385 });
  });
});
