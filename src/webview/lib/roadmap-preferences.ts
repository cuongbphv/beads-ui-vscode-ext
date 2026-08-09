/**
 * The Roadmap's own slice of VSCode panel state.
 *
 * Panel state outlives the build that wrote it: a user can reopen a panel
 * whose saved choices name a sort or zoom this version no longer has, or a
 * gutter that was never a number. Restoring is therefore a validation step,
 * not a spread — an unknown value reaching a controlled `<select>` renders as
 * an empty control the user cannot fix, and a non-finite gutter renders as a
 * `NaNpx` style the layout silently drops.
 */
import { ROADMAP_SORTS, type RoadmapSort } from '../../shared/roadmap-sort';
import { ROADMAP_ZOOMS, type RoadmapZoom } from './gantt-zoom';

export interface PersistedRoadmapPreferences {
  roadmapSort?: RoadmapSort;
  roadmapZoom?: RoadmapZoom;
  roadmapGutter?: number;
}

export interface RoadmapPreferences {
  sort: RoadmapSort;
  zoom: RoadmapZoom;
  gutter: number;
}

const DEFAULT_ROADMAP_PREFERENCES: RoadmapPreferences = {
  sort: 'timeline',
  zoom: 'fit',
  gutter: 224,
};

function fieldOf(saved: unknown, key: keyof PersistedRoadmapPreferences): unknown {
  if (typeof saved !== 'object' || saved === null) return undefined;
  return (saved as Record<string, unknown>)[key];
}

/** `undefined` for anything outside `options`, so the caller falls back. */
function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.find((option) => option === value);
}

/** A width the layout can actually use: a real, positive number of pixels. */
function widthOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * Restore current preferences from whatever the panel happens to hold.
 *
 * The parameter is `unknown` on purpose: `restore()` hands back a value typed
 * by the caller's optimism, not by anything that was checked.
 */
export function restoreRoadmapPreferences(saved: unknown): RoadmapPreferences {
  return {
    sort: oneOf(fieldOf(saved, 'roadmapSort'), ROADMAP_SORTS) ?? DEFAULT_ROADMAP_PREFERENCES.sort,
    zoom: oneOf(fieldOf(saved, 'roadmapZoom'), ROADMAP_ZOOMS) ?? DEFAULT_ROADMAP_PREFERENCES.zoom,
    gutter: widthOf(fieldOf(saved, 'roadmapGutter')) ?? DEFAULT_ROADMAP_PREFERENCES.gutter,
  };
}

/** Serialize all Roadmap-owned choices into VSCode panel state. */
export function persistedRoadmapPreferences(
  preferences: RoadmapPreferences,
): Required<PersistedRoadmapPreferences> {
  return {
    roadmapSort: preferences.sort,
    roadmapZoom: preferences.zoom,
    roadmapGutter: preferences.gutter,
  };
}
