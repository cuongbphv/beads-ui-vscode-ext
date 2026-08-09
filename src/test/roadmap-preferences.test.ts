import { describe, expect, it } from 'vitest';

import { ROADMAP_SORTS } from '../shared/roadmap-sort';
import { ROADMAP_ZOOMS } from '../webview/lib/gantt-zoom';
import {
  persistedRoadmapPreferences,
  restoreRoadmapPreferences,
} from '../webview/lib/roadmap-preferences';

const DEFAULTS = { sort: 'timeline', zoom: 'fit', gutter: 224 };

describe('Roadmap preference persistence', () => {
  it('restores the documented defaults from legacy panel state', () => {
    // Catches undefined legacy fields leaking into controlled selects or
    // changing the first-open gutter away from the required 224px.
    expect(restoreRoadmapPreferences(undefined)).toEqual({
      sort: 'timeline',
      zoom: 'fit',
      gutter: 224,
    });
    expect(restoreRoadmapPreferences({})).toEqual({
      sort: 'timeline',
      zoom: 'fit',
      gutter: 224,
    });
  });

  it('round-trips all three user choices through panel state', () => {
    // Catches omitting any field from App's persist payload: reopening the
    // panel must recover the exact sort, zoom, and dragged gutter.
    const persisted = persistedRoadmapPreferences({
      sort: 'type',
      zoom: 'month',
      gutter: 347,
    });

    expect(persisted).toEqual({
      roadmapSort: 'type',
      roadmapZoom: 'month',
      roadmapGutter: 347,
    });
    expect(restoreRoadmapPreferences(persisted)).toEqual({
      sort: 'type',
      zoom: 'month',
      gutter: 347,
    });
  });

  it('falls back to defaults for a sort or zoom this build no longer knows', () => {
    // Panel state outlives the build that wrote it. A renamed or dropped enum
    // member would otherwise reach a controlled <select> as a value with no
    // matching <option>, which React renders as an empty, unfixable control.
    expect(
      restoreRoadmapPreferences({ roadmapSort: 'by-date', roadmapZoom: 'quarter' }),
    ).toEqual(DEFAULTS);
    expect(restoreRoadmapPreferences({ roadmapSort: 42, roadmapZoom: null })).toEqual(DEFAULTS);
  });

  it('falls back to the default gutter for anything that is not a usable width', () => {
    expect(restoreRoadmapPreferences({ roadmapGutter: Number.NaN }).gutter).toBe(224);
    expect(restoreRoadmapPreferences({ roadmapGutter: Number.POSITIVE_INFINITY }).gutter).toBe(224);
    expect(restoreRoadmapPreferences({ roadmapGutter: 0 }).gutter).toBe(224);
    expect(restoreRoadmapPreferences({ roadmapGutter: -40 }).gutter).toBe(224);
    expect(restoreRoadmapPreferences({ roadmapGutter: '347' }).gutter).toBe(224);
  });

  it('keeps one valid choice when its neighbour is stale', () => {
    // Catches an all-or-nothing guard that throws away a good sort because the
    // zoom beside it was written by an older build.
    expect(restoreRoadmapPreferences({ roadmapSort: 'priority', roadmapZoom: 'quarter' })).toEqual({
      sort: 'priority',
      zoom: 'fit',
      gutter: 224,
    });
  });

  it('accepts every value the pickers can actually offer', () => {
    // Catches a validator written against a hand-copied list that has since
    // drifted from the constants the selects are built from.
    for (const sort of ROADMAP_SORTS) {
      expect(restoreRoadmapPreferences({ roadmapSort: sort }).sort).toBe(sort);
    }
    for (const zoom of ROADMAP_ZOOMS) {
      expect(restoreRoadmapPreferences({ roadmapZoom: zoom }).zoom).toBe(zoom);
    }
  });

  it('survives panel state that is not an object at all', () => {
    expect(restoreRoadmapPreferences(undefined)).toEqual(DEFAULTS);
    expect(restoreRoadmapPreferences(null)).toEqual(DEFAULTS);
    expect(restoreRoadmapPreferences('roadmap')).toEqual(DEFAULTS);
  });
});
