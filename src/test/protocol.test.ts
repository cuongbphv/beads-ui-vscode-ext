import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

describe('beadsDashboard.defaultTab contract', () => {
  it('keeps package.json enum exactly in sync with DASHBOARD_TABS', () => {
    // Read package.json from disk and JSON.parse it — never hardcode the enum
    // here, or this test would stop catching drift between the two lists.
    const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      contributes: {
        configuration: {
          properties: {
            'beadsDashboard.defaultTab': { enum: string[] };
          };
        };
      };
    };

    const configuredTabs = packageJson.contributes.configuration.properties['beadsDashboard.defaultTab'].enum;

    expect(configuredTabs).toEqual(DASHBOARD_TABS);
  });
});
