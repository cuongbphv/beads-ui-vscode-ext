// @vitest-environment jsdom

/**
 * The splitter's drag state, which only the mounted component owns.
 *
 * `drag-resize.test.ts` covers the arithmetic; what cannot be reached from
 * there is whether a gesture the browser took away actually ends.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Splitter } from '../webview/components/splitter';
import { installPointerCapture, losePointerCapture, pointerEvent } from './support/dom-harness';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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

async function render(): Promise<{
  handle: HTMLElement;
  grip: HTMLElement;
  onChange: ReturnType<typeof vi.fn>;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  const onChange = vi.fn();

  await act(async () =>
    mounted?.render(
      createElement(Splitter, {
        size: 200,
        range: { min: 120, max: 400 },
        label: 'Resize labels',
        onChange,
      }),
    ),
  );

  const handle = container.querySelector<HTMLElement>('[role="separator"]');
  const grip = handle?.querySelector<HTMLElement>('span');
  if (!handle || !grip) throw new Error('the separator and its grip must both render');
  return { handle, grip, onChange };
}

async function fire(handle: HTMLElement, event: Event): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(event);
  });
}

/**
 * The grip is drawn `bg-border-strong` for exactly as long as a drag is live.
 * Token equality, not a substring: the idle state carries the same colour
 * behind a `group-hover:` prefix.
 */
function dragging(grip: HTMLElement): boolean {
  return grip.classList.contains('bg-border-strong');
}

describe('Splitter drag lifecycle', () => {
  it('resizes while the drag owns the pointer', async () => {
    const { handle, grip, onChange } = await render();

    await fire(handle, pointerEvent('pointerdown', { clientX: 100 }));
    expect(dragging(grip)).toBe(true);

    await fire(handle, pointerEvent('pointermove', { clientX: 140 }));
    expect(onChange).toHaveBeenCalledWith(240);
  });

  it('ends the drag when the browser takes the capture away', async () => {
    // Without this the handle stays drawn as if it were being dragged for the
    // rest of the session — the move guard blocks the resize itself, so the
    // stuck state is invisible to every other assertion.
    const { handle, grip } = await render();

    await fire(handle, pointerEvent('pointerdown', { clientX: 100 }));
    expect(dragging(grip)).toBe(true);

    await act(async () => losePointerCapture(handle));

    expect(dragging(grip)).toBe(false);
  });

  it('leaves a finished drag alone when its own capture loss arrives', async () => {
    // `pointerup` releases the capture itself, so this event always follows a
    // normal drag too. Handling it must not undo or repeat the release.
    const { handle, grip, onChange } = await render();

    await fire(handle, pointerEvent('pointerdown', { clientX: 100 }));
    await fire(handle, pointerEvent('pointermove', { clientX: 140 }));
    await fire(handle, pointerEvent('pointerup', { clientX: 140 }));
    await fire(handle, pointerEvent('lostpointercapture'));

    expect(dragging(grip)).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
