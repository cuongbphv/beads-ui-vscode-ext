import { describe, expect, it } from 'vitest';

import {
  clamp,
  keyResize,
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
    expect(shouldActOnPointerMove(true, false)).toBe(false);
    expect(shouldActOnPointerMove(false, true)).toBe(false);
    expect(shouldActOnPointerMove(false, false)).toBe(false);
  });

  it('prevents resize on hover after pointercancel (stuck drag scenario)', () => {
    // Scenario: drag started (dragging=true, capture held=true), then pointercancel
    // fires and the browser auto-releases capture while dragging state is stuck.
    // Now user moves mouse without pressing button over the handle.
    expect(shouldActOnPointerMove(true, false)).toBe(false);
  });
});
