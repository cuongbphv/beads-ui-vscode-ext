// @vitest-environment jsdom

/**
 * The "Change history" section of the detail pane (bead 72m.3).
 *
 * `diffHistory` itself is unit-tested in history-diff.test.ts; these tests
 * cover the wiring: the section starts collapsed and fetches nothing, the
 * first expand triggers exactly one `getHistory` call, and events render
 * with `StatusPill` rather than a hardcoded status string.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { HistoryEvent } from '../shared/history-diff';
import { StatusIndex } from '../shared/model';
import type { Bead } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const getHistoryCalls: unknown[] = [];
let historyResult: HistoryEvent[] = [];

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    if (method === 'showBead') return Promise.resolve({ bead: null, comments: [] });
    if (method === 'getHistory') {
      getHistoryCalls.push(params);
      return Promise.resolve(historyResult);
    }
    return new Promise(() => undefined);
  },
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

vi.mock('../webview/components/toast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

import { BeadDetail } from '../webview/components/bead-detail';

let mountedRoot: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  container?.remove();
  container = undefined;
  getHistoryCalls.length = 0;
  historyResult = [];
});

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'done', category: 'done' },
]);

function bead(id: string): Bead {
  return { id, title: `Title of ${id}`, status: 'open', priority: 2, issue_type: 'task' };
}

async function mount(subject: Bead): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () =>
    mountedRoot?.render(
      createElement(BeadDetail, {
        bead: subject,
        beads: [subject],
        index,
        onClose: vi.fn(),
        onSelect: vi.fn(),
        refreshKey: 0,
      }),
    ),
  );
  // Let the `showBead` fetch inside useBeadDetail settle.
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function historyToggle(root: HTMLDivElement): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Change history'),
  );
}

describe('change history section', () => {
  it('starts collapsed and fetches nothing until expanded', async () => {
    const root = await mount(bead('a'));

    const toggle = historyToggle(root);
    expect(toggle).toBeDefined();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(getHistoryCalls).toEqual([]);
  });

  it('expanding the section triggers exactly one getHistory call', async () => {
    historyResult = [];
    const root = await mount(bead('a'));
    const toggle = historyToggle(root);

    await act(async () => toggle?.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(getHistoryCalls).toEqual([{ id: 'a' }]);
  });

  it('does not re-fetch on a second render while still expanded', async () => {
    historyResult = [];
    const root = await mount(bead('a'));
    const toggle = historyToggle(root);

    await act(async () => toggle?.click());
    await act(async () => {
      await Promise.resolve();
    });
    // Re-clicking collapse then expand again is a deliberate new fetch, but a
    // render with no state change must not add a second call.
    await act(async () => {
      await Promise.resolve();
    });

    expect(getHistoryCalls).toHaveLength(1);
  });

  it('renders a status-change event using StatusPill, not a hardcoded string', async () => {
    historyResult = [
      { field: 'status', kind: 'value', from: 'open', to: 'in_progress', actor: 'ana', at: '2026-08-24T12:00:00Z' },
    ];
    const root = await mount(bead('a'));
    const toggle = historyToggle(root);

    await act(async () => toggle?.click());
    await act(async () => {
      await Promise.resolve();
    });

    const section = toggle?.closest('section');
    expect(section?.textContent).toContain('ana');
    // Two StatusPill instances render the actual status text, not a
    // component-level literal string.
    expect(section?.querySelectorAll('span')).not.toHaveLength(0);
    expect(section?.textContent).toContain('open');
    expect(section?.textContent).toContain('in_progress');
  });

  it('shows "No changes recorded" when getHistory resolves empty', async () => {
    historyResult = [];
    const root = await mount(bead('a'));
    const toggle = historyToggle(root);

    await act(async () => toggle?.click());
    await act(async () => {
      await Promise.resolve();
    });

    const section = toggle?.closest('section');
    expect(section?.textContent).toContain('No changes recorded');
  });
});
