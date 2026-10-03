// @vitest-environment jsdom

/**
 * `GateCard`/`GatesSection`: gate cards on the Molecules tab, rendered from
 * `snapshot.gates` (bead beads-ui-vscode-ext-8eo.6). Fields exercised here
 * (`await_type`/`await_id`/`timeout`) mirror the REAL bd 1.2.2 fixture rows
 * captured in `src/test/fixtures/mol/gate-list.json` (bead 8eo.1) — no
 * `waiters` field exists anywhere in that capture, so this suite never
 * asserts on one. Same mount/mock scaffolding as
 * `bead-detail-defer-reopen.test.tsx`.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BdGate } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface PendingCall {
  method: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const rpc = vi.hoisted(() => ({
  calls: [] as PendingCall[],
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      rpc.calls.push({ method, params, resolve, reject });
    }),
  asRpcError: (error: unknown) =>
    error && typeof error === 'object' && 'kind' in error ? error : { kind: 'unknown', message: String(error) },
}));

const toast = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('../webview/components/toast', () => ({
  useToast: () => toast,
}));

const { GateCard, GatesSection } = await import('../webview/components/mol/gate-card');

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
  rpc.calls.length = 0;
  toast.notify.mockClear();
});

/** Real fixture shapes from `src/test/fixtures/mol/gate-list.json` (bd 1.2.2). */
function gate(overrides: Partial<BdGate> = {}): BdGate {
  return {
    id: 'bd-mol-fixtures-scratch-wb6',
    title: 'Gate: human',
    description: 'Ad-hoc gate blocking bd-mol-fixtures-scratch-mol-w0q\n\nReason: Need design review',
    status: 'open',
    priority: 2,
    issue_type: 'gate',
    owner: 'CuongBPV@fpt.com',
    created_at: '2026-08-24T15:07:31Z',
    created_by: 'CuongBPV',
    updated_at: '2026-08-24T15:07:31Z',
    await_type: 'human',
    ...overrides,
  };
}

async function mount(node: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(node));
  return container;
}

function button(root: HTMLDivElement, text: string): HTMLButtonElement | null {
  return [...root.querySelectorAll('button')].find((el) => el.textContent?.trim() === text) ?? null;
}

describe('GateCard', () => {
  it('links known affected issues to the existing issue detail action', async () => {
    const onSelect = vi.fn();
    const affectedIssue = { id: 'step-1', title: 'Approve design', status: 'open', priority: 2, issue_type: 'task' };
    const root = await mount(createElement(GateCard, { gate: gate(), affectedIssues: [affectedIssue], onSelect }));

    expect(root.textContent).toContain('Affected issues:');
    const issueButton = button(root, 'step-1: Approve design');
    expect(issueButton).not.toBeNull();
    await act(async () => issueButton?.click());
    expect(onSelect).toHaveBeenCalledWith('step-1');
  });

  it('says when affected issues are unknown in the loaded data', async () => {
    const root = await mount(createElement(GateCard, { gate: gate() }));
    expect(root.textContent).toContain('No linked issue found in the loaded data.');
  });

  it('shows a Resolve button for a human gate', async () => {
    const root = await mount(createElement(GateCard, { gate: gate({ await_type: 'human' }) }));

    expect(button(root, 'Resolve')).not.toBeNull();
    expect(root.textContent).toContain('Waiting on a person');
  });

  it('shows no Resolve button for a timer gate, and formats the nanosecond timeout as a duration', async () => {
    const root = await mount(
      createElement(GateCard, {
        gate: gate({
          id: 'bd-mol-fixtures-scratch-qpb',
          title: 'Gate: timer',
          await_type: 'timer',
          timeout: 7_200_000_000_000, // 2h, from the real gate-list.json fixture
        }),
      }),
    );

    expect(button(root, 'Resolve')).toBeNull();
    // Never the raw nanosecond count.
    expect(root.textContent).not.toContain('7200000000000');
    expect(root.textContent).toContain('2h');
  });

  it('shows no Resolve button for a gh:pr gate, and surfaces its await_id', async () => {
    const root = await mount(
      createElement(GateCard, {
        gate: gate({
          id: 'bd-mol-fixtures-scratch-d33',
          title: 'Gate: gh:pr 42',
          await_type: 'gh:pr',
          await_id: '42',
        }),
      }),
    );

    expect(button(root, 'Resolve')).toBeNull();
    expect(root.textContent).toContain('42');
  });

  it('shows no Resolve button for a gh:run gate', async () => {
    const root = await mount(
      createElement(GateCard, { gate: gate({ await_type: 'gh:run', await_id: '9', title: 'Gate: gh:run' }) }),
    );
    expect(button(root, 'Resolve')).toBeNull();
  });

  it('shows no Resolve button for a bead gate', async () => {
    const root = await mount(
      createElement(GateCard, { gate: gate({ await_type: 'bead', await_id: 'rig:bd-9', title: 'Gate: bead' }) }),
    );
    expect(button(root, 'Resolve')).toBeNull();
  });

  it('calls resolveGate with just the id when Resolve is clicked, and toasts on success', async () => {
    const root = await mount(createElement(GateCard, { gate: gate() }));

    await act(async () => button(root, 'Resolve')?.click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('resolveGate');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-mol-fixtures-scratch-wb6' });

    await act(async () => {
      rpc.calls[0].resolve({ ok: true });
      await Promise.resolve();
    });

    expect(toast.notify).toHaveBeenCalledWith('bd-mol-fixtures-scratch-wb6 resolved');
  });

  it('toasts an error and leaves the card in place when resolveGate rejects', async () => {
    const root = await mount(createElement(GateCard, { gate: gate() }));

    await act(async () => button(root, 'Resolve')?.click());
    await act(async () => {
      rpc.calls[0].reject({ kind: 'bd-error', message: 'bd refused: gate already closed' });
      await Promise.resolve();
    });

    expect(toast.notify).toHaveBeenCalledWith('bd refused: gate already closed', 'error');
    expect(button(root, 'Resolve')).not.toBeNull();
  });
});

describe('GatesSection', () => {
  it('renders nothing for an empty gate list', async () => {
    const root = await mount(createElement(GatesSection, { gates: [] }));
    expect(root.querySelector('section')).toBeNull();
  });

  it('renders one card per gate, labelled with the count', async () => {
    const gates = [gate({ id: 'g-1' }), gate({ id: 'g-2', await_type: 'timer', timeout: 3_600_000_000_000 })];
    const root = await mount(createElement(GatesSection, { gates }));

    const section = root.querySelector('section');
    expect(section?.getAttribute('aria-label')).toBe('Gates (2)');
    expect(root.querySelectorAll('article')).toHaveLength(2);
  });
});
