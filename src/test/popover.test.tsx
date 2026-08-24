// @vitest-environment jsdom

/**
 * `Popover`'s optional controlled `open`/`onOpenChange` props, added for bead
 * li0.10's Add-link control (which needs to close the panel itself right
 * after a pick succeeds, not only on Escape/outside-click). The existing
 * uncontrolled behaviour — exercised by `quick-filter-bar.test.tsx` via
 * `FilterPopover`, which passes neither prop — must stay exactly as it was;
 * this file covers only the new controlled path.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Popover } from '../webview/components/popover';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let mountedRoot: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  container?.remove();
  container = undefined;
});

function Harness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  return createElement(
    'div',
    null,
    createElement(Popover, {
      triggerLabel: 'Trigger',
      triggerContent: 'Trigger',
      label: 'Panel',
      open: false,
      onOpenChange,
      children: createElement('button', { type: 'button' }, 'Inside'),
    }),
  );
}

async function mount(onOpenChange: (open: boolean) => void): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(createElement(Harness, { onOpenChange })));
  return container;
}

describe('Popover controlled open/onOpenChange', () => {
  it('stays closed while the controlling `open` prop is false, even after the trigger is clicked', async () => {
    const onOpenChange = vi.fn();
    const root = await mount(onOpenChange);
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-label="Trigger"]');
    if (!trigger) throw new Error('trigger not found');

    await act(async () => trigger.click());

    // The panel does not render: the parent never flipped `open` to true.
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('renders the panel once the parent flips `open` to true in response to onOpenChange', async () => {
    container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    let open = false;
    const render = (): void => {
      mountedRoot?.render(
        createElement(Popover, {
          triggerLabel: 'Trigger',
          triggerContent: 'Trigger',
          label: 'Panel',
          open,
          onOpenChange: (next: boolean) => {
            open = next;
            render();
          },
          children: createElement('button', { type: 'button' }, 'Inside'),
        }),
      );
    };
    await act(async () => render());

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Trigger"]');
    if (!trigger) throw new Error('trigger not found');
    await act(async () => trigger.click());

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Inside');
  });

  it('a parent that closes it externally (open: false with no further click) hides the panel again', async () => {
    container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    const renderWith = (open: boolean, onOpenChange: (next: boolean) => void): void => {
      mountedRoot?.render(
        createElement(Popover, {
          triggerLabel: 'Trigger',
          triggerContent: 'Trigger',
          label: 'Panel',
          open,
          onOpenChange,
          children: createElement('button', { type: 'button' }, 'Inside'),
        }),
      );
    };

    await act(async () => renderWith(true, vi.fn()));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    // The parent (e.g. after a successful pick) sets `open` back to false on
    // its own, with no further trigger click.
    await act(async () => renderWith(false, vi.fn()));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Escape still closes a controlled popover, funnelled through onOpenChange rather than internal state', async () => {
    container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    let open = true;
    const onOpenChange = vi.fn((next: boolean) => {
      open = next;
      render();
    });
    const render = (): void => {
      mountedRoot?.render(
        createElement(Popover, {
          triggerLabel: 'Trigger',
          triggerContent: 'Trigger',
          label: 'Panel',
          open,
          onOpenChange,
          children: createElement('button', { type: 'button' }, 'Inside'),
        }),
      );
    };
    await act(async () => render());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
