import { describe, expect, it } from 'vitest';

import { isNearBottom, nextScrollTop } from '../webview/lib/transcript-scroll';

describe('isNearBottom', () => {
  it('is true when scrolled exactly to the bottom', () => {
    expect(isNearBottom(600, 1000, 400)).toBe(true); // 1000 - 400 - 600 = 0
  });

  it('is true within the default 40px threshold', () => {
    expect(isNearBottom(570, 1000, 400, 40)).toBe(true); // distance = 30
  });

  it('is false once scrolled further up than the threshold', () => {
    expect(isNearBottom(500, 1000, 400, 40)).toBe(false); // distance = 100
  });

  it('respects a custom threshold', () => {
    expect(isNearBottom(500, 1000, 400, 150)).toBe(true); // distance = 100 <= 150
  });
});

describe('nextScrollTop', () => {
  it('jumps to the new bottom while following', () => {
    const result = nextScrollTop({
      following: true,
      scrollTop: 200,
      previousScrollHeight: 1000,
      nextScrollHeight: 1400,
      clientHeight: 400,
    });
    expect(result).toBe(1000); // 1400 - 400
  });

  it('keeps the same content in view when not following and height grows', () => {
    const result = nextScrollTop({
      following: false,
      scrollTop: 200,
      previousScrollHeight: 1000,
      nextScrollHeight: 1100,
      clientHeight: 400,
    });
    expect(result).toBe(300); // 200 + (1100 - 1000)
  });

  it('compensates when older events are trimmed from the front, shrinking the content', () => {
    const result = nextScrollTop({
      following: false,
      scrollTop: 500,
      previousScrollHeight: 2000,
      nextScrollHeight: 1900,
      clientHeight: 400,
    });
    expect(result).toBe(400); // 500 + (1900 - 2000)
  });

  it('never returns a negative scrollTop', () => {
    const result = nextScrollTop({
      following: false,
      scrollTop: 10,
      previousScrollHeight: 2000,
      nextScrollHeight: 100,
      clientHeight: 400,
    });
    expect(result).toBe(0);
  });
});
