// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BeadQuery } from '../shared/model';
import type { Bead } from '../shared/types';
import { QuickFilterBar } from '../webview/components/filter-bar';
import { installResizeObserver } from './support/dom-harness';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let mountedRoot: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installResizeObserver();
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.replaceChildren();
});

const beads: Bead[] = [
  { id: 'epic-1', title: 'Roadmap polish', status: 'open', priority: 1, issue_type: 'epic' },
  {
    id: 'task-1',
    title: 'Rework the bar',
    status: 'open',
    priority: 1,
    issue_type: 'task',
    parent: 'epic-1',
    assignee: 'ana',
  },
  { id: 'bug-1', title: 'Chip overflow', status: 'open', priority: 2, issue_type: 'bug' },
];

const epics = beads.filter((bead) => bead.issue_type === 'epic');

async function mount(
  query: BeadQuery,
  onChange: (next: BeadQuery) => void,
  hiddenClosedCount?: number,
): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () =>
    mountedRoot?.render(
      createElement(QuickFilterBar, { beads, epics, query, onChange, hiddenClosedCount }),
    ),
  );
}

function byLabel(text: string): HTMLElement | null {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === text,
  );
  return button ?? null;
}

function byText(text: string): HTMLElement | null {
  return (
    [...document.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(text),
    ) ?? null
  );
}

/** The control a visible `<label>` points at — the association under test. */
function controlFor(labelText: string): HTMLElement | null {
  const label = [...document.querySelectorAll('label')].find(
    (candidate) => candidate.textContent?.trim() === labelText,
  );
  const id = label?.getAttribute('for');
  return id ? document.getElementById(id) : null;
}

async function click(element: Element | null): Promise<void> {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/**
 * React tracks the last value it wrote to a form control and drops a change
 * event that does not move it, so assigning `.value` directly is silently
 * ignored. The prototype setter is what React's tracker is patched on top of.
 */
async function choose(element: HTMLElement | null, value: string): Promise<void> {
  expect(element).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(element, value);
    element?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function toggle(element: HTMLElement | null, checked: boolean): Promise<void> {
  expect(element).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  await act(async () => {
    setter?.call(element, checked);
    element?.dispatchEvent(new Event('click', { bubbles: true }));
  });
}

describe('QuickFilterBar band', () => {
  it('shows no chip row and no filter count while nothing is filtered', async () => {
    // The band's whole point: an unused filter costs no space and makes no claim.
    await mount({}, vi.fn());

    expect(document.querySelector('[aria-label="Active filters"]')).toBeNull();
    expect(byLabel('Filters')).not.toBeNull();
  });

  it('keeps the pickers out of the band until the popover is opened', async () => {
    // Catches rendering the popover body inline, which is the layout this
    // change exists to remove.
    await mount({}, vi.fn());

    expect(controlFor('Epic')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('counts the applied filters on the trigger', async () => {
    await mount({ epicId: 'epic-1', types: ['bug'] }, vi.fn());

    expect(byLabel('Filters, 2 active')).not.toBeNull();
  });

  it('renders a chip per applied filter', async () => {
    await mount({ epicId: 'epic-1' }, vi.fn());

    const chips = document.querySelector('[aria-label="Active filters"]');
    expect(chips?.textContent).toContain('Roadmap polish');
    expect(byLabel('Remove filter Epic Roadmap polish')).not.toBeNull();
  });

  it('removes only the clicked filter', async () => {
    // Catches a chip wired to a whole-query reset: the text and the other
    // filter have to survive.
    const onChange = vi.fn();
    await mount({ text: 'auth', epicId: 'epic-1', types: ['bug'] }, onChange);

    await click(byLabel('Remove filter Epic Roadmap polish'));

    expect(onChange).toHaveBeenCalledWith({
      text: 'auth',
      epicId: undefined,
      types: ['bug'],
    });
  });

  it('clears every filter but leaves closed issues showing', async () => {
    const onChange = vi.fn();
    await mount({ text: 'auth', epicId: 'epic-1', includeClosed: true }, onChange);

    await click(byText('Clear all'));

    expect(onChange).toHaveBeenCalledWith({ text: 'auth', includeClosed: true });
  });

  it('offers no Clear all when there is nothing to clear', async () => {
    await mount({ text: 'auth' }, vi.fn());

    expect(byText('Clear all')).toBeNull();
  });
});

describe('QuickFilterBar popover', () => {
  it('opens on the trigger and reports its state', async () => {
    await mount({}, vi.fn());
    const trigger = byLabel('Filters');

    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    await click(trigger);

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('gives every picker a visible label bound to its control', async () => {
    // The controls it replaces carried an aria-label and no visible text.
    await mount({}, vi.fn());
    await click(byLabel('Filters'));

    for (const field of ['Epic', 'Type', 'Assignee', 'Priority']) {
      expect(controlFor(field)?.tagName).toBe('SELECT');
    }
    expect(controlFor('Include closed issues')?.getAttribute('type')).toBe('checkbox');
  });

  it('applies an epic chosen from the popover', async () => {
    const onChange = vi.fn();
    await mount({ text: 'auth' }, onChange);
    await click(byLabel('Filters'));

    await choose(controlFor('Epic'), 'epic-1');

    expect(onChange).toHaveBeenCalledWith({ text: 'auth', epicId: 'epic-1' });
  });

  it('offers the types and assignees the snapshot actually contains', async () => {
    // Catches a hardcoded list: beads lets users define their own types.
    await mount({}, vi.fn());
    await click(byLabel('Filters'));

    const values = (element: HTMLElement | null): string[] =>
      [...(element as HTMLSelectElement).options].map((option) => option.value);

    expect(values(controlFor('Type'))).toEqual(['', 'bug', 'epic', 'task']);
    expect(values(controlFor('Assignee'))).toEqual(['', 'ana']);
  });

  it('turns the closed toggle on from inside the popover', async () => {
    const onChange = vi.fn();
    await mount({}, onChange);
    await click(byLabel('Filters'));

    await toggle(controlFor('Include closed issues'), true);

    expect(onChange).toHaveBeenCalledWith({ includeClosed: true });
  });

  it('resets the filters without disturbing the closed choice', async () => {
    const onChange = vi.fn();
    await mount({ epicId: 'epic-1', includeClosed: true }, onChange);
    await click(byLabel('Filters, 2 active'));

    await click(byText('Reset filters'));

    expect(onChange).toHaveBeenCalledWith({ text: undefined, includeClosed: true });
  });

  it('disables the reset while nothing is applied', async () => {
    await mount({}, vi.fn());
    await click(byLabel('Filters'));

    expect((byText('Reset filters') as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    await mount({}, vi.fn());
    const trigger = byLabel('Filters');
    await click(trigger);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the pointer goes down outside it', async () => {
    await mount({}, vi.fn());
    await click(byLabel('Filters'));

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('stays open while the pointer goes down on its own controls', async () => {
    // A picker click must not dismiss the popover the picker lives in.
    await mount({}, vi.fn());
    await click(byLabel('Filters'));

    await act(async () => {
      controlFor('Epic')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('QuickFilterBar hidden-closed pill', () => {
  it('shows the count in the chip row and includes closed on click', async () => {
    const onChange = vi.fn();
    await mount({ epicId: 'epic-1' }, onChange, 12);

    const pill = byText('12 closed hidden');
    expect(document.querySelector('[aria-label="Active filters"]')?.contains(pill)).toBe(true);

    await click(pill);
    expect(onChange).toHaveBeenCalledWith({ epicId: 'epic-1', includeClosed: true });
  });

  it('opens the chip row on its own when no filter chip exists', async () => {
    // Roadmap hides closed issues by default, so the pill has to be able to
    // bring the row up with nothing else in it.
    await mount({}, vi.fn(), 3);

    expect(document.querySelector('[aria-label="Active filters"]')).not.toBeNull();
  });

  it('says nothing when no closed issue is being hidden', async () => {
    await mount({}, vi.fn(), 0);

    expect(document.querySelector('[aria-label="Active filters"]')).toBeNull();
  });
});
