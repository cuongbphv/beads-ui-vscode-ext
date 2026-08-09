// @vitest-environment jsdom

/**
 * The reschedule handle as a user meets it: pointer, keyboard, and the
 * browser pulling the gesture out from under it.
 *
 * `gantt-bar-layout.test`'s pure helpers cover what to draw; these cover
 * whether the component actually drives them, which markup assertions cannot.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DAY, MINUTE, type Span, type Timeline } from '../shared/schedule';
import type { Bead } from '../shared/types';
import { GanttBar } from '../webview/components/gantt/gantt-bar';
import { installPointerCapture, pointerEvent, stubClientWidth } from './support/dom-harness';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** Local midnight, so every day boundary in the fixtures is unambiguous. */
const NOW = new Date(2026, 7, 4).getTime();
const TRACK_PX = 1000;

const timeline: Timeline = {
  epics: [],
  start: NOW - 5 * DAY,
  end: NOW + 5 * DAY,
  now: NOW,
  ticks: [],
};

const span: Span = {
  bead: {
    id: 'bd-1',
    title: 'Editable task',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    due_at: new Date(NOW + DAY).toISOString(),
  } satisfies Bead,
  start: NOW,
  end: NOW + DAY,
  kind: 'due',
  overdue: false,
  deferred: false,
};

let mounted: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installPointerCapture();
});

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.unmount());
    mounted = undefined;
  }
  document.body.replaceChildren();
});

interface Harness {
  bar: HTMLElement;
  handle: HTMLElement;
  onCommit: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
}

async function render(): Promise<Harness> {
  const container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);

  const onCommit = vi.fn();
  const onSelect = vi.fn();

  await act(async () =>
    mounted?.render(
      createElement(GanttBar, { span, timeline, done: false, onSelect, onCommit, pending: false }),
    ),
  );

  const track = container.firstElementChild;
  if (track) stubClientWidth(track, TRACK_PX);

  const bar = container.querySelector('button');
  const handle = container.querySelector<HTMLElement>('[role="slider"]');
  if (!bar || !handle) throw new Error('the bar and its handle must both render');
  return { bar, handle, onCommit, onSelect };
}

/** The bar's drawn geometry, as percentages of the chart window. */
function geometry(bar: HTMLElement): { left: number; width: number } {
  return {
    left: Number.parseFloat(bar.style.left),
    width: Number.parseFloat(bar.style.width),
  };
}

async function press(handle: HTMLElement, key: string, shift = false): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true }));
  });
}

/**
 * One event, one commit of React state — the browser delivers each of these in
 * its own task, and every guard in the drag reads state from the last render.
 */
async function fire(handle: HTMLElement, event: Event): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(event);
  });
}

describe('GanttBar reschedule handle', () => {
  it('advertises the window it can actually reach as its slider range', async () => {
    // A `role="slider"` with no bounds is an unusable control for anyone not
    // holding a mouse, and the reported bounds must be the ones the drag and
    // keyboard paths are really clamped to.
    const { handle } = await render();

    expect(handle.getAttribute('aria-valuemin')).toBe(String(Math.round((NOW + MINUTE) / 1000)));
    expect(handle.getAttribute('aria-valuemax')).toBe(String(Math.round((NOW + 5 * DAY) / 1000)));
    expect(handle.getAttribute('aria-valuenow')).toBe(String(Math.round((NOW + DAY) / 1000)));
  });

  it('clamps a pointer drag to the window instead of overflowing the track', async () => {
    // Dragging far past the last gridline used to widen the bar beyond the
    // chart: `placement` is a percentage of the window, so an end outside it
    // is a width above 100% and the row spills out of its own scroller.
    const { bar, handle } = await render();
    expect(geometry(bar)).toEqual({ left: 50, width: 10 });

    await fire(handle, pointerEvent('pointerdown', { clientX: 0 }));
    await fire(handle, pointerEvent('pointermove', { clientX: 8000 }));

    const { left, width } = geometry(bar);
    expect(width).toBe(50);
    expect(left + width).toBeLessThanOrEqual(100);
  });

  it('commits a pointer drag through the same plan the keyboard uses', async () => {
    const { handle, onCommit } = await render();

    await fire(handle, pointerEvent('pointerdown', { clientX: 0 }));
    // 100px of a 1000px track across a 10-day window is exactly one day.
    await fire(handle, pointerEvent('pointermove', { clientX: 100 }));
    await fire(handle, pointerEvent('pointerup', { clientX: 100 }));

    expect(onCommit).toHaveBeenCalledWith({ field: 'due', at: NOW + 2 * DAY });
  });

  it('moves the bar with the arrow keys and writes it back on Enter', async () => {
    const { bar, handle, onCommit } = await render();

    await press(handle, 'ArrowRight');

    // The preview is live and announced, but nothing is written yet: one bd
    // subprocess per keystroke is not an edit, it is a stutter.
    expect(handle.getAttribute('aria-valuetext')).toBe('2026-08-06');
    expect(geometry(bar).width).toBe(20);
    expect(onCommit).not.toHaveBeenCalled();

    await press(handle, 'Enter');

    expect(onCommit).toHaveBeenCalledWith({ field: 'due', at: NOW + 2 * DAY });
    expect(handle.getAttribute('aria-valuetext')).toBe('2026-08-05');
  });

  it('takes the same window bound on the keyboard as under the pointer', async () => {
    const { bar, handle } = await render();

    await press(handle, 'ArrowRight', true);

    expect(handle.getAttribute('aria-valuetext')).toBe('2026-08-09');
    expect(geometry(bar).left + geometry(bar).width).toBeLessThanOrEqual(100);
  });

  it('jumps to the ends of the window on End and Home', async () => {
    const { handle } = await render();

    await press(handle, 'End');
    expect(handle.getAttribute('aria-valuetext')).toBe('2026-08-09');

    await press(handle, 'Home');
    expect(handle.getAttribute('aria-valuetext')).toBe('2026-08-04');
  });

  it('throws an uncommitted keyboard edit away on Escape', async () => {
    const { bar, handle, onCommit } = await render();

    await press(handle, 'ArrowRight');
    await press(handle, 'Escape');

    expect(geometry(bar)).toEqual({ left: 50, width: 10 });
    expect(handle.getAttribute('aria-valuetext')).toBe('2026-08-05');
    expect(onCommit).not.toHaveBeenCalled();

    // Enter after a cancel must not resurrect the discarded preview.
    await press(handle, 'Enter');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('abandons a keyboard edit the user has tabbed away from', async () => {
    const { bar, handle, onCommit } = await render();

    await press(handle, 'ArrowRight');
    // React's `onBlur` listens for the bubbling `focusout`, not `blur`.
    await act(async () => handle.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(geometry(bar)).toEqual({ left: 50, width: 10 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('drops the preview when the browser takes the capture away mid-drag', async () => {
    // A stolen capture (an OS gesture, a window blur) fires neither pointerup
    // nor pointercancel on every platform, and the bar would stay frozen at a
    // width nothing will ever commit or clear.
    const { bar, handle, onCommit } = await render();

    await fire(handle, pointerEvent('pointerdown', { clientX: 0 }));
    await fire(handle, pointerEvent('pointermove', { clientX: 200 }));
    expect(geometry(bar).width).toBe(30);

    await fire(handle, pointerEvent('lostpointercapture'));

    expect(geometry(bar)).toEqual({ left: 50, width: 10 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('still commits a normal release, whose own capture loss arrives afterwards', async () => {
    // Releasing capture in `pointerup` fires `lostpointercapture` straight
    // after it. The cleanup must be idempotent, not a commit-eating race.
    const { handle, onCommit } = await render();

    await fire(handle, pointerEvent('pointerdown', { clientX: 0 }));
    await fire(handle, pointerEvent('pointermove', { clientX: 100 }));
    await fire(handle, pointerEvent('pointerup', { clientX: 100 }));
    await fire(handle, pointerEvent('lostpointercapture'));

    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
