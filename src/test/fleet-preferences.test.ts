import { describe, expect, it } from 'vitest';

import { FLEET_STATUS_FILTERS } from '../shared/fleet-filter';
import { persistedFleetPreferences, restoreFleetPreferences } from '../webview/lib/fleet-preferences';

describe('Fleet preference persistence', () => {
  it('restores the documented default from legacy or empty panel state', () => {
    expect(restoreFleetPreferences(undefined)).toEqual({ statusFilter: 'all' });
    expect(restoreFleetPreferences({})).toEqual({ statusFilter: 'all' });
  });

  it('round-trips a chosen filter through panel state', () => {
    const persisted = persistedFleetPreferences({ statusFilter: 'running' });

    expect(persisted).toEqual({ fleetStatusFilter: 'running' });
    expect(restoreFleetPreferences(persisted)).toEqual({ statusFilter: 'running' });
  });

  it('falls back to the default for a filter value this build no longer knows', () => {
    expect(restoreFleetPreferences({ fleetStatusFilter: 'closed' })).toEqual({ statusFilter: 'all' });
    expect(restoreFleetPreferences({ fleetStatusFilter: 42 })).toEqual({ statusFilter: 'all' });
    expect(restoreFleetPreferences({ fleetStatusFilter: null })).toEqual({ statusFilter: 'all' });
  });

  it('accepts every value the picker can actually offer', () => {
    for (const filter of FLEET_STATUS_FILTERS) {
      expect(restoreFleetPreferences({ fleetStatusFilter: filter })).toEqual({ statusFilter: filter });
    }
  });

  it('survives panel state that is not an object at all', () => {
    expect(restoreFleetPreferences(undefined)).toEqual({ statusFilter: 'all' });
    expect(restoreFleetPreferences(null)).toEqual({ statusFilter: 'all' });
    expect(restoreFleetPreferences('fleet')).toEqual({ statusFilter: 'all' });
  });
});
