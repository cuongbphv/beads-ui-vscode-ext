import { describe, expect, it } from 'vitest';

import { DASHBOARD_TABS, resolveDashboardTab } from '../shared/protocol';

describe('resolveDashboardTab', () => {
  it('keeps any value that is still a known tab', () => {
    for (const tab of DASHBOARD_TABS) {
      expect(resolveDashboardTab(tab)).toBe(tab);
    }
  });

  it('falls back to roadmap for a stale "graph" tab left over from before Graph merged into Roadmap', () => {
    // Never crash: an old beadsDashboard.defaultTab: "graph" setting must
    // still resolve to something the current webview can render.
    expect(resolveDashboardTab('graph')).toBe('roadmap');
  });

  it('falls back to roadmap for any other value this build does not recognise', () => {
    expect(resolveDashboardTab('bogus')).toBe('roadmap');
    expect(resolveDashboardTab('')).toBe('roadmap');
  });
});
