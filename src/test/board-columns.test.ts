import { describe, expect, it } from 'vitest';

import { CATEGORY_ORDER } from '../shared/types';
import {
  CATEGORY_EMPTY_TEXT,
  DEFAULT_COLLAPSED,
  collapsedSet,
  toggleCollapsed,
} from '../webview/lib/board-columns';

describe('collapsedSet', () => {
  it('folds done away for a user who has never chosen', () => {
    expect([...collapsedSet(undefined)]).toEqual(['done']);
  });

  it('treats an empty stored list as "unfold everything", not as unset', () => {
    expect([...collapsedSet([])]).toEqual([]);
  });

  it('honours an explicit stored list', () => {
    expect([...collapsedSet(['frozen', 'done'])].sort()).toEqual(['done', 'frozen']);
  });
});

describe('toggleCollapsed', () => {
  it('unfolds done from the default, and records the choice explicitly', () => {
    expect(toggleCollapsed(undefined, 'done')).toEqual([]);
  });

  it('folds another column while leaving the default folded', () => {
    expect(toggleCollapsed(undefined, 'frozen').sort()).toEqual(['done', 'frozen']);
  });

  it('round-trips: folding then unfolding returns to where it started', () => {
    const once = toggleCollapsed([], 'wip');
    expect(once).toEqual(['wip']);
    expect(toggleCollapsed(once, 'wip')).toEqual([]);
  });

  it('does not mutate the stored array', () => {
    const stored: Parameters<typeof toggleCollapsed>[0] = ['done'];
    toggleCollapsed(stored, 'active');
    expect(stored).toEqual(['done']);
  });
});

describe('CATEGORY_EMPTY_TEXT', () => {
  it('has a distinct sentence for every category a column can have', () => {
    const texts = CATEGORY_ORDER.map((category) => CATEGORY_EMPTY_TEXT[category]);
    expect(texts.every((text) => text.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(CATEGORY_ORDER.length);
  });

  it('collapses only categories that exist', () => {
    for (const category of DEFAULT_COLLAPSED) {
      expect(CATEGORY_ORDER).toContain(category);
    }
  });
});
