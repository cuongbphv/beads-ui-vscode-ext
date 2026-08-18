// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const bridgeState = vi.hoisted(() => ({
  saved: {
    tab: 'roadmap',
    query: { includeClosed: true },
    roadmapShape: 'timeline',
    roadmapSort: 'type',
    roadmapZoom: 'month',
    roadmapGutter: 347,
  },
  persisted: new Array<unknown>(),
}));

const selection = vi.hoisted(() => ({ focusedId: undefined as string | undefined }));

vi.mock('../webview/bridge/rpc', () => ({
  restore: () => bridgeState.saved,
  persist: (state: unknown) => {
    bridgeState.persisted.push(state);
  },
  onHostEvent: () => () => {},
  // The detail pane fetches the full record on mount. Never settling keeps it
  // on its skeleton, which is all these assertions need it to be.
  call: () => new Promise(() => {}),
  asRpcError: (error: unknown) => ({ kind: 'unknown', message: String(error) }),
}));

vi.mock('../webview/hooks/use-beads', () => ({
  useBeads: () => ({
    snapshot: {
      context: { bd_version: 'test', beads_dir: '.beads', repo_root: '/repo' },
      vocabulary: {
        statuses: [{ name: 'open', category: 'active' }],
        types: [{ name: 'epic' }],
      },
      stats: {
        total_issues: 1,
        open_issues: 1,
        in_progress_issues: 0,
        blocked_issues: 0,
        closed_issues: 0,
        deferred_issues: 0,
        pinned_issues: 0,
        ready_issues: 1,
      },
      beads: [
        {
          id: 'epic-a',
          title: 'Persisted roadmap',
          status: 'open',
          priority: 2,
          issue_type: 'epic',
          started_at: '2026-08-01T00:00:00.000Z',
          due_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      readyIds: ['epic-a'],
      blockedIds: [],
      gates: [],
      truncated: false,
      fetchedAt: '2026-08-09T00:00:00.000Z',
    },
    index: {
      statuses: [{ name: 'open', category: 'active' }],
      category: () => 'active',
      def: () => ({ name: 'open', category: 'active' }),
      isDone: () => false,
      namesIn: () => ['open'],
      categoriesPresent: () => ['active'],
    },
    error: undefined,
    loading: false,
    focusedId: selection.focusedId,
    setFocusedId: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('../webview/hooks/use-schedule-edit', () => ({
  useScheduleEdit: () => ({ pending: new Set<string>(), commit: vi.fn() }),
}));

import { App } from '../webview/App';
import { installResizeObserver, TestResizeObserver } from './support/dom-harness';

let root: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  installResizeObserver();
  selection.focusedId = undefined;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
  bridgeState.persisted.length = 0;
});

async function mountApp(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(App)));
  return container;
}

/** Tell the app its `<main>` is `width` wide, as a relayout would. */
async function resizeMain(width: number): Promise<void> {
  const observation = TestResizeObserver.observationOf(
    (target) => target.tagName.toLowerCase() === 'main',
  );
  expect(observation).toBeDefined();
  await act(async () => {
    if (observation) observation.observer.emit(observation.target, width);
  });
}

function detailWidthVar(container: HTMLElement): string {
  const main = container.querySelector('main');
  return main?.style.getPropertyValue('--detail-w') ?? '';
}

function lastPersisted(): Record<string, unknown> {
  return (bridgeState.persisted.at(-1) ?? {}) as Record<string, unknown>;
}

describe('App Roadmap persistence integration', () => {
  it('restores controls and sends all Roadmap preferences in the actual effect payload', async () => {
    // Catches App initializing new state fields from defaults even when the
    // bridge has saved choices, or omitting one from the effect's persist call.
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(App)));

    const sort = container.querySelector<HTMLSelectElement>('select[aria-label="Sort"]');
    const zoom = container.querySelector<HTMLSelectElement>('select[aria-label="Zoom"]');
    expect(sort?.value).toBe('type');
    expect(zoom?.value).toBe('month');
    expect(bridgeState.persisted.at(-1)).toEqual(
      expect.objectContaining({
        roadmapSort: 'type',
        roadmapZoom: 'month',
        roadmapGutter: 347,
      }),
    );
  });

  it('persists changed sort and zoom values after React state updates', async () => {
    // Catches a stale effect dependency or payload field: the controls can
    // update on screen while reopening the panel would restore old values.
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(App)));

    const sort = container.querySelector<HTMLSelectElement>('select[aria-label="Sort"]');
    const zoom = container.querySelector<HTMLSelectElement>('select[aria-label="Zoom"]');
    expect(sort).not.toBeNull();
    expect(zoom).not.toBeNull();

    await act(async () => {
      if (sort) {
        sort.value = 'priority';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (zoom) {
        zoom.value = 'week';
        zoom.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(bridgeState.persisted.at(-1)).toEqual(
      expect.objectContaining({
        roadmapSort: 'priority',
        roadmapZoom: 'week',
        roadmapGutter: 347,
      }),
    );
  });
});

describe('App detail pane width', () => {
  it('gives the preference back when the panel is wide enough for it again', async () => {
    // Overwriting the stored width on every narrowing destroys the only copy
    // of what the user asked for: drag the panel narrow once and the pane is
    // permanently 350px, however wide the editor is later.
    const container = await mountApp();

    await resizeMain(500);
    expect(detailWidthVar(container)).toBe('350px');
    expect(lastPersisted().detailWidth).toBe(384);

    await resizeMain(1400);
    expect(detailWidthVar(container)).toBe('384px');
    expect(lastPersisted().detailWidth).toBe(384);
  });

  it('leaves the preference alone in a container that can hold it', async () => {
    // The clamp must bite only when the share is actually smaller than the
    // preference; 70% of 600px is 420px, so 384px is the honest answer.
    const container = await mountApp();

    await resizeMain(600);

    expect(detailWidthVar(container)).toBe('384px');
  });

  it('keeps the splitter inside its own advertised bounds while clamped', async () => {
    // `aria-valuenow` above `aria-valuemax` is invalid, and a screen reader
    // reads out a position the handle cannot actually be dragged to.
    selection.focusedId = 'epic-a';
    const container = await mountApp();

    await resizeMain(500);

    const splitter = container.querySelector<HTMLElement>(
      '[role="separator"][aria-label="Resize detail panel"]',
    );
    expect(splitter).not.toBeNull();
    expect(splitter?.getAttribute('aria-valuemax')).toBe('350');
    expect(splitter?.getAttribute('aria-valuenow')).toBe('350');
  });
});
