// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import { ROADMAP_SORTS } from '../shared/roadmap-sort';
import type { Bead } from '../shared/types';
import { Splitter } from '../webview/components/splitter';
import { ROADMAP_ZOOMS } from '../webview/lib/gantt-zoom';
import { RoadmapView } from '../webview/views/RoadmapView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  emit(target: Element, width: number): void {
    const entry: ResizeObserverEntry = {
      target,
      contentRect: new DOMRect(0, 0, width, 0),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    };
    this.callback([entry], this);
  }
}

let mountedRoot: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  });
});

beforeEach(() => {
  TestResizeObserver.instances.length = 0;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.replaceChildren();
});

vi.mock('../webview/hooks/use-schedule-edit', () => ({
  useScheduleEdit: () => ({
    pending: new Set(['task-a']),
    commit: vi.fn(),
  }),
}));

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'done', category: 'done' },
]);

const beads: Bead[] = [
  {
    id: 'epic-z',
    title: 'Feature epic',
    status: 'open',
    priority: 0,
    issue_type: 'epic',
    started_at: '2026-08-15T00:00:00.000Z',
    due_at: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'epic-a',
    title: 'Bug epic',
    status: 'open',
    priority: 4,
    issue_type: 'epic',
    started_at: '2026-08-10T00:00:00.000Z',
    due_at: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'task-a',
    title: 'Editable task',
    status: 'open',
    priority: 0,
    issue_type: 'task',
    parent: 'epic-z',
    estimated_minutes: 480,
    started_at: '2026-08-16T00:00:00.000Z',
    due_at: '2026-08-19T00:00:00.000Z',
  },
  {
    id: 'bug-b',
    title: 'Low-priority bug',
    status: 'open',
    priority: 4,
    issue_type: 'bug',
    parent: 'epic-z',
    started_at: '2026-08-17T00:00:00.000Z',
    due_at: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'loose-work',
    title: 'Loose work',
    status: 'open',
    priority: 0,
    issue_type: 'task',
    started_at: '2026-08-11T00:00:00.000Z',
    due_at: '2026-08-12T00:00:00.000Z',
  },
];

function renderRoadmap(overrides: {
  shape: 'list' | 'timeline';
  sort: 'timeline' | 'priority' | 'type';
}): string {
  return renderToStaticMarkup(
    createElement(RoadmapView, roadmapProps({ ...overrides, zoom: 'week' })),
  );
}

function roadmapProps(overrides: {
  shape: 'list' | 'timeline';
  sort?: 'timeline' | 'priority' | 'type';
  zoom?: 'fit' | 'day' | 'week' | 'month';
  gutter?: number;
}): Parameters<typeof RoadmapView>[0] {
  return {
    beads,
    index,
    query: { includeClosed: true },
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    blockedIds: new Set<string>(),
    showClosed: true,
    onShowClosedChange: vi.fn(),
    shape: overrides.shape,
    onShapeChange: vi.fn(),
    sort: overrides.sort ?? 'timeline',
    onSortChange: vi.fn(),
    zoom: overrides.zoom ?? 'fit',
    onZoomChange: vi.fn(),
    gutter: overrides.gutter ?? 300,
    onGutterChange: vi.fn(),
  };
}

/** The observer watching the Roadmap's own pane, not the chart's scroller. */
function paneObservation():
  | { observer: TestResizeObserver; target: Element }
  | undefined {
  return TestResizeObserver.instances
    .flatMap((observer) => [...observer.observed].map((target) => ({ observer, target })))
    .find(({ target }) => target.classList.contains('flex-col'));
}

function timelineEpicRowIndex(html: string, title: string): number {
  return html.indexOf(`title="${title}" class="min-w-0 flex-1 cursor-pointer truncate text-left text-sm`);
}

function listEpicRowIndex(html: string, title: string): number {
  return html.indexOf(`class="text-fg-strong block truncate text-sm font-medium">${title}</span>`);
}

describe('RoadmapView wiring', () => {
  it('applies the selected sort to the list shape', () => {
    // Catches wiring the Sort select without feeding the same value into the
    // list ordering: type order puts Bug before Task despite its lower priority.
    const html = renderRoadmap({ shape: 'list', sort: 'type' });
    const bug = html.indexOf('Low-priority bug');
    const task = html.indexOf('Editable task');

    // Both must be on screen first: a missing title indexes as -1, which would
    // satisfy the ordering assertion while proving nothing.
    expect(bug).toBeGreaterThan(-1);
    expect(task).toBeGreaterThan(-1);
    expect(bug).toBeLessThan(task);
    expect(html).toContain('<option value="type" selected="">By type</option>');
  });

  it('offers exactly the sorts and zooms the rest of the app knows about', () => {
    // Catches a hand-written option list drifting from the constants the
    // restore-time validator checks against: a value that validates but has no
    // option renders as an empty select the user cannot correct.
    const html = renderRoadmap({ shape: 'timeline', sort: 'timeline' });
    const values = (list: string): string[] =>
      [...list.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);

    const sortSelect = html.slice(html.indexOf('aria-label="Sort"'));
    const zoomSelect = html.slice(html.indexOf('aria-label="Zoom"'));

    expect(values(sortSelect.slice(0, sortSelect.indexOf('</select>')))).toEqual([
      ...ROADMAP_SORTS,
    ]);
    expect(values(zoomSelect.slice(0, zoomSelect.indexOf('</select>')))).toEqual([
      ...ROADMAP_ZOOMS,
    ]);
  });

  it('applies the selected priority sort to timeline epic rows', () => {
    // Catches leaving sortTimeline fixed to date order: the later-starting P0
    // epic must move ahead of the earlier-starting P4 epic.
    const html = renderRoadmap({ shape: 'timeline', sort: 'priority' });
    const feature = timelineEpicRowIndex(html, 'Feature epic');
    const bug = timelineEpicRowIndex(html, 'Bug epic');

    expect(feature).toBeGreaterThan(-1);
    expect(bug).toBeGreaterThan(-1);
    expect(feature).toBeLessThan(bug);
  });

  it('keeps the synthetic unassigned group last in both shapes', () => {
    // Catches either view bypassing the shared comparator: `Loose work` is P0
    // and starts first, but its synthetic catch-all must never lead the plan.
    const list = renderRoadmap({ shape: 'list', sort: 'priority' });
    const timeline = renderRoadmap({ shape: 'timeline', sort: 'priority' });
    const listUnassigned = listEpicRowIndex(list, 'No epic');
    const listReal = listEpicRowIndex(list, 'Bug epic');
    const timelineUnassigned = timelineEpicRowIndex(timeline, 'No epic');
    const timelineReal = timelineEpicRowIndex(timeline, 'Bug epic');

    expect(listUnassigned).toBeGreaterThan(-1);
    expect(listReal).toBeGreaterThan(-1);
    expect(timelineUnassigned).toBeGreaterThan(-1);
    expect(timelineReal).toBeGreaterThan(-1);
    expect(listUnassigned).toBeGreaterThan(listReal);
    expect(timelineUnassigned).toBeGreaterThan(timelineReal);
  });

  it('wires zoom, gutter, editability and pending state into the timeline', () => {
    // Catches any Task 11 placeholder surviving: fixed fit zoom, fixed gutter,
    // absent splitter, omitted commit handler, or the empty pending set.
    const html = renderRoadmap({ shape: 'timeline', sort: 'timeline' });

    expect(html).toContain('<option value="week" selected="">Weeks</option>');
    // Before the pane's first measurement, the shared clamp intentionally
    // falls back to the 120px minimum instead of rendering an inverted range.
    expect(html).toContain('--gantt-gutter:120px');
    expect(html).toContain('aria-label="Resize the task name column"');
    expect(html).toContain('left:calc(120px - 3px)');
    expect(html).toContain('aria-label="Reschedule task-a"');
    expect(html).toContain('animate-pulse opacity-60');
  });

  it('starts the splitter with a valid ARIA range before measurement', () => {
    // Catches passing `{ min: 120, max: 0 }` to Splitter during the first
    // render, where aria-valuenow=120 would otherwise exceed aria-valuemax=0.
    const html = renderRoadmap({ shape: 'timeline', sort: 'timeline' });

    expect(html).toContain('aria-valuenow="120"');
    expect(html).toContain('aria-valuemin="120"');
    expect(html).toContain('aria-valuemax="120"');
  });

  it('applies the observed pane width to the real Gantt and splitter', async () => {
    // Catches a disconnected ResizeObserver callback or stale viewport state:
    // 1000px must yield a 600px max while preserving the requested 300px gutter.
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () =>
      mountedRoot?.render(createElement(RoadmapView, roadmapProps({ shape: 'timeline' }))),
    );

    const pane = paneObservation();
    expect(pane).toBeDefined();

    await act(async () => {
      if (pane) pane.observer.emit(pane.target, 1000);
    });

    const splitter = container.querySelector<HTMLElement>(
      '[role="separator"][aria-label="Resize the task name column"]',
    );
    const gantt = container.querySelector<HTMLElement>('[style*="--gantt-gutter"]');
    expect(splitter?.getAttribute('aria-valuemin')).toBe('120');
    expect(splitter?.getAttribute('aria-valuemax')).toBe('600');
    expect(splitter?.getAttribute('aria-valuenow')).toBe('300');
    expect(splitter?.style.left).toBe('calc(297px)');
    expect(gantt?.style.getPropertyValue('--gantt-gutter')).toBe('300px');
  });

  it('measures the pane when the timeline arrives after a list-shaped first render', async () => {
    // The pane element only exists in the timeline shape. A mount-time effect
    // finds a null ref on a list-first render and never runs again, so the
    // gutter range stays frozen at its unmeasured fallback and the splitter
    // can never be dragged past 120px for the rest of the session.
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => mountedRoot?.render(createElement(RoadmapView, roadmapProps({ shape: 'list' }))));
    expect(paneObservation()).toBeUndefined();

    await act(async () =>
      mountedRoot?.render(createElement(RoadmapView, roadmapProps({ shape: 'timeline' }))),
    );

    const pane = paneObservation();
    expect(pane).toBeDefined();

    await act(async () => {
      if (pane) pane.observer.emit(pane.target, 1000);
    });

    const splitter = container.querySelector<HTMLElement>(
      '[role="separator"][aria-label="Resize the task name column"]',
    );
    const gantt = container.querySelector<HTMLElement>('[style*="--gantt-gutter"]');
    expect(splitter?.getAttribute('aria-valuemax')).toBe('600');
    expect(splitter?.getAttribute('aria-valuenow')).toBe('300');
    expect(gantt?.style.getPropertyValue('--gantt-gutter')).toBe('300px');
  });

  it('stops observing a pane that the list shape has taken away', async () => {
    // A ref callback that never detaches leaks an observer per shape switch,
    // and each stale one keeps writing widths for an element off the screen.
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () =>
      mountedRoot?.render(createElement(RoadmapView, roadmapProps({ shape: 'timeline' }))),
    );
    expect(paneObservation()).toBeDefined();

    await act(async () => mountedRoot?.render(createElement(RoadmapView, roadmapProps({ shape: 'list' }))));

    expect(paneObservation()).toBeUndefined();
  });

  it('stops observing when the view goes away entirely', async () => {
    // The detach is the ref being called with null, which is also what
    // unmounting does — there is no separate teardown to forget.
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () =>
      mountedRoot?.render(createElement(RoadmapView, roadmapProps({ shape: 'timeline' }))),
    );
    expect(paneObservation()).toBeDefined();

    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;

    expect(paneObservation()).toBeUndefined();
  });
});

describe('Splitter positioning', () => {
  it('forwards caller positioning styles to the separator root', () => {
    // Catches accepting the style prop in the type but forgetting to apply it,
    // which would leave the absolute Roadmap splitter at the wrong edge.
    const html = renderToStaticMarkup(
      createElement(Splitter, {
        size: 224,
        range: { min: 120, max: 400 },
        label: 'Resize labels',
        onChange: vi.fn(),
        style: { left: '221px' },
      }),
    );

    expect(html).toContain('style="left:221px"');
  });
});
