// @vitest-environment jsdom

/**
 * `StepList`: renders the four states bd 1.2.2 has ever emitted (there is
 * no fabricated fifth "blocked" state — see `shared/mol.ts`'s doc comment),
 * groups by `parallelGroup` into bordered clusters when `parallelAvailable`
 * is true, badges any step carrying a `gate`, degrades to a flat list when
 * parallel data is unavailable, and reuses `onSelect` for click-through —
 * the same pane the App level wires to `BeadDetail`.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MolStep } from '../shared/mol';
import { StepList } from '../webview/components/mol/step-list';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let mounted: Root | undefined;
let container: HTMLElement | undefined;

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.unmount());
    mounted = undefined;
  }
  container?.remove();
  container = undefined;
});

async function mount(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(el));
  return container;
}

function step(id: string, overrides: Partial<MolStep> = {}): MolStep {
  return {
    issue: { id, title: `Title ${id}`, status: 'open', priority: 2, issue_type: 'task' },
    status: 'ready',
    is_current: false,
    ...overrides,
  };
}

describe('StepList', () => {
  it('renders "No steps." when there are none', async () => {
    const el = await mount(createElement(StepList, { steps: [], parallelAvailable: false }));
    expect(el.textContent).toContain('No steps.');
  });

  it('renders all four real bd states with a readable label each, and never a fabricated "blocked" label', async () => {
    const steps = [
      step('done-1', { status: 'done' }),
      step('current-1', { status: 'current', is_current: true }),
      step('ready-1', { status: 'ready' }),
      step('pending-1', { status: 'pending' }),
    ];
    const el = await mount(createElement(StepList, { steps, parallelAvailable: false }));

    expect(el.textContent).toContain('Done');
    expect(el.textContent).toContain('In progress');
    expect(el.textContent).toContain('Ready');
    expect(el.textContent).toContain('Pending');
    expect(el.textContent).not.toContain('Blocked');
  });

  it('renders a flat list, no group headers, when parallelAvailable is false — even if steps happen to carry a parallelGroup', async () => {
    const steps = [step('a', { parallelGroup: 'group-1' }), step('b', { parallelGroup: 'group-1' })];
    const el = await mount(createElement(StepList, { steps, parallelAvailable: false }));

    expect(el.querySelector('[aria-label="Steps"]')?.tagName).toBe('UL');
    expect(el.textContent).not.toContain('parallel');
  });

  it('clusters steps sharing a parallelGroup under a bordered "group-N · parallel" header when parallelAvailable is true', async () => {
    const steps = [
      step('a', { parallelGroup: 'group-1' }),
      step('b', { parallelGroup: 'group-1' }),
      step('c', { parallelGroup: undefined }),
    ];
    const el = await mount(createElement(StepList, { steps, parallelAvailable: true }));

    expect(el.textContent).toContain('group-1 · parallel');
    // The header <p> is a direct child of the group's own cluster <div> —
    // its parentElement, not any ancestor `querySelectorAll('div')` might
    // otherwise match (the outer wrapper contains the ungrouped step too).
    const header = Array.from(el.querySelectorAll('p')).find((p) => p.textContent === 'group-1 · parallel');
    const groupSection = header?.parentElement;
    expect(groupSection?.querySelectorAll('article')).toHaveLength(2);
    // The ungrouped step still renders, outside any group cluster.
    expect(el.textContent).toContain('Title c');
    expect(groupSection?.textContent).not.toContain('Title c');
  });

  it('badges a step carrying a gate with its await_type, and adds no badge to a step without one', async () => {
    const steps = [
      step('gated', { gate: { gateId: 'g-1', awaitType: 'human' } }),
      step('open', {}),
    ];
    const el = await mount(createElement(StepList, { steps, parallelAvailable: false }));

    expect(el.textContent).toContain('gate: human');
    const rows = Array.from(el.querySelectorAll('article'));
    const gatedRow = rows.find((r) => r.getAttribute('aria-label')?.startsWith('gated:'));
    expect(gatedRow?.textContent).toContain('Waiting for gate');
    expect(gatedRow?.textContent).not.toContain('Ready');
    const openRow = rows.find((r) => r.getAttribute('aria-label')?.startsWith('open:'));
    expect(openRow?.textContent).toContain('Ready');
    expect(openRow?.textContent).not.toContain('gate:');
  });

  it('shows the gh:pr await id and the timer timeout as extra gate-badge detail', async () => {
    const steps = [
      step('pr', { gate: { gateId: 'g-pr', awaitType: 'gh:pr', awaitId: '42' } }),
      step('timer', { gate: { gateId: 'g-timer', awaitType: 'timer', timeout: 7_200_000_000_000 } }),
    ];
    const el = await mount(createElement(StepList, { steps, parallelAvailable: false }));

    expect(el.textContent).toContain('PR 42');
    expect(el.textContent).toContain('2h 0m timeout');
  });

  it('calls onSelect with the step id on click, and marks the selected step aria-current', async () => {
    const onSelect = vi.fn();
    const steps = [step('a'), step('b')];
    const el = await mount(createElement(StepList, { steps, parallelAvailable: false, onSelect, selectedId: 'b' }));

    const rows = Array.from(el.querySelectorAll('article'));
    const rowA = rows.find((r) => r.getAttribute('aria-label')?.startsWith('a:'));
    const rowB = rows.find((r) => r.getAttribute('aria-label')?.startsWith('b:'));
    expect(rowB?.getAttribute('aria-current')).toBe('true');
    expect(rowA?.getAttribute('aria-current')).toBeNull();

    await act(async () => rowA?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('renders steps as plain (non-interactive) rows when no onSelect is given', async () => {
    const el = await mount(createElement(StepList, { steps: [step('a')], parallelAvailable: false }));
    const row = el.querySelector('article');
    expect(row?.getAttribute('role')).toBeNull();
    expect(row?.getAttribute('tabindex')).toBeNull();
  });
});
