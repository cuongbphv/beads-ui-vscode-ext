// @vitest-environment jsdom

/**
 * The toast's action button.
 *
 * A bar drag writes to someone's tracker with no confirmation step, so the
 * toast is the only place the change can be taken back. What matters here is
 * that the button is reachable, fires once, and is still on screen by the time
 * a person has finished reading the line above it.
 */
import { act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ToastProvider, useToast, type Toast, type ToastAction } from '../webview/components/toast';

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
  vi.useRealTimers();
});

/** Mount a provider that fires exactly one `notify` on its first render. */
async function show(message: string, tone?: Toast['tone'], action?: ToastAction): Promise<void> {
  function Fire(): ReactNode {
    const { notify } = useToast();
    useEffect(() => notify(message, tone, action), [notify]);
    return null;
  }

  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(ToastProvider, null, createElement(Fire))));
}

function buttons(): HTMLButtonElement[] {
  return [...(container?.querySelectorAll('button') ?? [])];
}

function text(): string {
  return container?.textContent ?? '';
}

describe('toast actions', () => {
  it('renders the action label and runs it once when pressed', async () => {
    const run = vi.fn();
    await show('bd-1 · due Aug 7 → Aug 9', 'info', { label: 'Undo', run });

    const undo = buttons().find((button) => button.textContent === 'Undo');
    expect(undo, 'the action button is not on screen').toBeDefined();

    await act(async () => undo?.click());

    expect(run).toHaveBeenCalledTimes(1);
    // Gone with the toast: the action fires its own toast when bd answers, and
    // a second press would send the same write twice.
    expect(text()).not.toContain('bd-1');
    expect(buttons().some((button) => button.textContent === 'Undo')).toBe(false);
  });

  it('renders only the dismiss button when there is nothing to undo', async () => {
    await show('bd-2 · est none → 2h');

    expect(buttons()).toHaveLength(1);
    expect(buttons()[0].getAttribute('aria-label')).toBe('Dismiss');
  });

  it('keeps an actionable toast up long enough to aim at', async () => {
    vi.useFakeTimers();
    await show('bd-1 · due Aug 7 → Aug 9', 'info', { label: 'Undo', run: vi.fn() });

    // Past the 3s a plain confirmation gets — an Undo nobody can reach is not one.
    await act(async () => void vi.advanceTimersByTime(4000));
    expect(text()).toContain('Undo');

    await act(async () => void vi.advanceTimersByTime(5000));
    expect(text()).not.toContain('Undo');
  });

  it('still retires a plain confirmation on the short clock', async () => {
    vi.useFakeTimers();
    await show('bd-2 · est none → 2h');

    await act(async () => void vi.advanceTimersByTime(4000));

    expect(text()).not.toContain('bd-2');
  });

  it('announces itself in a live region', async () => {
    await show('bd: invalid date', 'error');

    const live = container?.querySelector('[aria-live]');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.textContent).toContain('bd: invalid date');
  });
});
