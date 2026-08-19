/**
 * The Fleet tab's own slice of VSCode panel state.
 *
 * Same contract as `roadmap-preferences.ts`: panel state outlives the build
 * that wrote it, so restoring is a validation step, not a spread — an unknown
 * filter value reaching the controlled status `<select>` would otherwise
 * render as an empty, unfixable control.
 */
import { FLEET_STATUS_FILTERS, type FleetStatusFilter } from '../../shared/fleet-filter';

export interface PersistedFleetPreferences {
  fleetStatusFilter?: FleetStatusFilter;
}

export interface FleetPreferences {
  statusFilter: FleetStatusFilter;
}

const DEFAULT_FLEET_PREFERENCES: FleetPreferences = {
  statusFilter: 'all',
};

function fieldOf(saved: unknown, key: keyof PersistedFleetPreferences): unknown {
  if (typeof saved !== 'object' || saved === null) return undefined;
  return (saved as Record<string, unknown>)[key];
}

/** `undefined` for anything outside `options`, so the caller falls back. */
function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.find((option) => option === value);
}

/**
 * Restore current preferences from whatever the panel happens to hold.
 *
 * The parameter is `unknown` on purpose: `restore()` hands back a value typed
 * by the caller's optimism, not by anything that was checked.
 */
export function restoreFleetPreferences(saved: unknown): FleetPreferences {
  return {
    statusFilter:
      oneOf(fieldOf(saved, 'fleetStatusFilter'), FLEET_STATUS_FILTERS) ??
      DEFAULT_FLEET_PREFERENCES.statusFilter,
  };
}

/** Serialize all Fleet-owned choices into VSCode panel state. */
export function persistedFleetPreferences(
  preferences: FleetPreferences,
): Required<PersistedFleetPreferences> {
  return {
    fleetStatusFilter: preferences.statusFilter,
  };
}
