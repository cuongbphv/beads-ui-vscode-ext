import { describe, expect, it } from 'vitest';

import { labelChipStyle, labelColor } from '../webview/lib/label-color';

describe('labelColor', () => {
  it('is stable for the same label', () => {
    expect(labelColor('ui')).toBe(labelColor('ui'));
  });

  it('gives different labels different hues', () => {
    const colors = new Set(['ui', 'backend', 'roadmap', 'm001', 's4b'].map(labelColor));
    expect(colors.size).toBe(5);
  });

  it('defers lightness to the theme variable and keeps chroma fixed', () => {
    for (const label of ['', 'a', 'very-long-label-name-with-dashes', '🙂']) {
      const match = /^oklch\(var\(--label-lightness, 72%\) 0\.13 (\d+\.\d)\)$/.exec(
        labelColor(label),
      );
      expect(match, label).not.toBeNull();
      const hue = Number(match?.[1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('exposes the colour as a custom property for the chip class', () => {
    expect(labelChipStyle('ui')).toEqual({ '--label-color': labelColor('ui') });
  });
});
