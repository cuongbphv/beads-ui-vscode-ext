// @vitest-environment jsdom

/**
 * `IssuePicker` (bead li0.10): filters already-loaded beads by id/title
 * substring with no RPC call, and is keyboard-navigable
 * (ArrowUp/ArrowDown/Enter) over the resulting listbox.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Bead } from '../shared/types';
import { IssuePicker } from '../webview/components/issue-picker';

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

function bead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: 'bd-1',
    title: 'Untitled',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  };
}

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount(props: {
  beads: Bead[];
  excludeIds?: string[];
  onPick: (bead: Bead) => void;
}): Promise<{ root: HTMLDivElement; input: HTMLInputElement }> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(createElement(IssuePicker, props)));
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search issues"]');
  if (!input) throw new Error('search input not found');
  return { root: container, input };
}

function optionLabels(root: HTMLDivElement): string[] {
  return [...root.querySelectorAll('li[role="option"] button')].map(
    (el) => el.textContent?.trim() ?? '',
  );
}

const beads: Bead[] = [
  bead({ id: 'bd-1', title: 'Fix the flaky poll' }),
  bead({ id: 'bd-2', title: 'Add dependency editor' }),
  bead({ id: 'bd-3', title: 'Refresh the sidebar tree' }),
];

describe('IssuePicker filtering', () => {
  it('lists every candidate (capped) when the query is empty', async () => {
    const { root } = await mount({ beads, onPick: vi.fn() });
    expect(optionLabels(root)).toHaveLength(3);
  });

  it('filters by a title substring, case-insensitively', async () => {
    const { root, input } = await mount({ beads, onPick: vi.fn() });
    await act(async () => typeInto(input, 'DEPENDENCY'));
    expect(optionLabels(root)).toEqual(['bd-2Add dependency editor']);
  });

  it('filters by an id substring', async () => {
    const { root, input } = await mount({ beads, onPick: vi.fn() });
    await act(async () => typeInto(input, 'bd-3'));
    expect(optionLabels(root)).toEqual(['bd-3Refresh the sidebar tree']);
  });

  it('shows "No matching issues." when nothing matches', async () => {
    const { root, input } = await mount({ beads, onPick: vi.fn() });
    await act(async () => typeInto(input, 'nonexistent'));
    expect(root.textContent).toContain('No matching issues.');
    expect(root.querySelectorAll('li[role="option"]')).toHaveLength(0);
  });

  it('never offers an excluded id, regardless of query', async () => {
    const { root } = await mount({ beads, excludeIds: ['bd-1'], onPick: vi.fn() });
    expect(optionLabels(root)).toEqual([
      'bd-2Add dependency editor',
      'bd-3Refresh the sidebar tree',
    ]);
  });

});

describe('IssuePicker keyboard navigation', () => {
  it('ArrowDown moves the highlighted option forward', async () => {
    const { root, input } = await mount({ beads, onPick: vi.fn() });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const options = [...root.querySelectorAll('li[role="option"]')];
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowUp moves the highlighted option back, clamped at the first', async () => {
    const { root, input } = await mount({ beads, onPick: vi.fn() });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    const options = [...root.querySelectorAll('li[role="option"]')];
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('Enter picks the highlighted option and clears the query', async () => {
    const onPick = vi.fn();
    const { root, input } = await mount({ beads, onPick });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onPick).toHaveBeenCalledWith(beads[1]);
    expect(input.value).toBe('');
    void root;
  });

  it('clicking an option picks it directly, without keyboard nav', async () => {
    const onPick = vi.fn();
    const { root } = await mount({ beads, onPick });
    const secondOption = [...root.querySelectorAll('li[role="option"] button')][2] as HTMLButtonElement;
    await act(async () => secondOption.click());
    expect(onPick).toHaveBeenCalledWith(beads[2]);
  });

  it('resets the highlighted option to the first match whenever the query changes', async () => {
    const { root, input } = await mount({ beads, onPick: vi.fn() });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await act(async () => typeInto(input, 'bd'));
    const options = [...root.querySelectorAll('li[role="option"]')];
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
  });
});
