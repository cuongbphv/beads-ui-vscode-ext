// @vitest-environment jsdom

/**
 * `LeaseBadge` (beads-ui-vscode-ext-ayq.1): the claim-liveness chip rendered
 * on bead cards and Fleet worker rows.
 *
 * The a11y contract under test: colour is never the only signal — every state
 * carries visible text plus an icon — and the `none` state renders nothing at
 * all, so the badge never invents a lease for the (common) issue without one.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Bead } from '../shared/types';
import { BeadCard } from '../webview/components/bead-card';
import { LeaseBadge } from '../webview/components/lease-badge';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let mounted: Root | undefined;
let container: HTMLElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.unmount());
    mounted = undefined;
  }
  container?.remove();
  container = undefined;
});

async function render(element: ReturnType<typeof createElement>): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(element));
  return container;
}

/** A fixed "now" injected into every badge, so no test reads the wall clock. */
const NOW = Date.parse('2026-08-24T12:00:00.000Z');

function bead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: 'proj-1',
    title: 'A bead',
    status: 'in_progress',
    priority: 1,
    issue_type: 'task',
    ...overrides,
  };
}

describe('LeaseBadge states', () => {
  it('renders nothing for an issue with no lease fields', async () => {
    const el = await render(createElement(LeaseBadge, { bead: bead(), nowMs: NOW }));
    expect(el.textContent).toBe('');
  });

  it('renders text + icon for a live lease — never colour alone', async () => {
    const el = await render(
      createElement(LeaseBadge, {
        bead: bead({
          lease_expires_at: '2026-08-24T12:04:00.000Z',
          heartbeat_at: '2026-08-24T11:59:30.000Z',
          lease_granted_node: 'node-a',
          assignee: 'agent-7',
        }),
        nowMs: NOW,
      }),
    );

    expect(el.textContent).toContain('leased');
    expect(el.querySelector('svg')).not.toBeNull();
    const badge = el.querySelector('[title]');
    expect(badge?.getAttribute('title')).toContain('expires in 4m');
    expect(badge?.getAttribute('title')).toContain('agent-7');
    expect(badge?.getAttribute('title')).toContain('node-a');
  });

  it('renders a stale-heartbeat warning with how long the worker has been quiet', async () => {
    const el = await render(
      createElement(LeaseBadge, {
        bead: bead({
          lease_expires_at: '2026-08-24T12:04:00.000Z',
          heartbeat_at: '2026-08-24T11:48:00.000Z', // 12m ago > 5m threshold
        }),
        nowMs: NOW,
      }),
    );

    expect(el.textContent).toContain('stale heartbeat');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('[title]')?.getAttribute('title')).toContain('12m');
  });

  it('renders an expired badge with how long ago the lease died', async () => {
    const el = await render(
      createElement(LeaseBadge, {
        bead: bead({ lease_expires_at: '2026-08-24T11:57:00.000Z' }),
        nowMs: NOW,
      }),
    );

    expect(el.textContent).toContain('lease expired');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('[title]')?.getAttribute('title')).toContain('3m ago');
  });
});

describe('BeadCard lease badge', () => {
  it('shows the lease badge on a card whose issue carries a live lease', async () => {
    const el = await render(
      createElement(BeadCard, {
        // Far-future expiry: live regardless of the card's own Date.now().
        bead: bead({ lease_expires_at: '2999-01-01T00:00:00.000Z' }),
      }),
    );
    expect(el.textContent).toContain('leased');
  });

  it('shows an expired badge on a card whose lease is long dead', async () => {
    const el = await render(
      createElement(BeadCard, {
        bead: bead({ lease_expires_at: '2000-01-01T00:00:00.000Z' }),
      }),
    );
    expect(el.textContent).toContain('lease expired');
  });

  it('shows no lease chip at all on a card without lease fields', async () => {
    const el = await render(createElement(BeadCard, { bead: bead() }));
    expect(el.textContent).not.toContain('leased');
    expect(el.textContent).not.toContain('lease expired');
    expect(el.textContent).not.toContain('stale heartbeat');
  });
});
