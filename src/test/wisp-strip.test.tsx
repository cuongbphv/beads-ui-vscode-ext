// @vitest-environment jsdom

/**
 * `WispChip`/`WispStrip`: the wisp strip on the Molecules tab (bead
 * beads-ui-vscode-ext-8eo.5), rendered from `snapshot.wisps` — already
 * fetched by `useMolecules`'s single `getMolSnapshot` round trip, so this
 * suite never mounts any RPC scaffolding (unlike `gate-card.test.tsx`, which
 * needs it for `resolveGate`). Wisp rows here mirror the REAL bd 1.2.2
 * fixture captured in `src/test/fixtures/mol/wisp-list.json` (bead 8eo.1):
 * `type` is `"molecule"` for a wisp root and `"task"` for its steps, and no
 * TTL field of any kind exists on that row — the countdown text asserted
 * below always comes from the client-side `WISP_TTL_MS` heuristic in
 * `shared/mol.ts`, exercised here through an injected `now`, never a real
 * timer.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { WISP_TTL_MS, type MolWisp } from '../shared/mol';
import { WispChip, WispStrip } from '../webview/components/mol/wisp-strip';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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
});

async function mount(node: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(node));
  return container;
}

/** Real fixture row shape from `src/test/fixtures/mol/wisp-list.json` (bd 1.2.2). */
function wisp(overrides: Partial<MolWisp> = {}): MolWisp {
  return {
    id: 'bd-mol-fixtures-scratch-wisp-421',
    title: 'Design healthcheck',
    status: 'open',
    priority: 2,
    type: 'task',
    created_at: '2026-08-24T15:07:00Z',
    updated_at: '2026-08-24T15:07:00Z',
    ...overrides,
  };
}

const CREATED_MS = Date.parse('2026-08-24T15:07:00Z');

describe('WispChip', () => {
  it('shows a positive countdown well before the heuristic TTL for its type elapses', async () => {
    // type "task" -> 6h heuristic TTL; 1h in leaves 5h.
    const now = CREATED_MS + 3_600_000;
    const root = await mount(createElement(WispChip, { wisp: wisp({ type: 'task' }), now }));

    expect(root.textContent).toContain('5h');
    expect(root.textContent).toContain('left');
    expect(root.textContent).not.toContain('stale');
    expect(root.textContent).not.toContain('TTL unknown');
  });

  it('uses the longer heuristic tier for a "molecule"-type wisp root', async () => {
    const now = CREATED_MS + 3_600_000; // 1h into a 24h TTL
    const root = await mount(createElement(WispChip, { wisp: wisp({ type: 'molecule' }), now }));

    expect(root.textContent).toContain('23h');
  });

  it('degrades to a "stale" indicator, never a negative duration, once the heuristic TTL has elapsed', async () => {
    const now = CREATED_MS + 7 * 3_600_000; // 7h in, past the 6h "task" TTL
    const root = await mount(createElement(WispChip, { wisp: wisp({ type: 'task' }), now }));

    expect(root.textContent).toContain('stale');
    expect(root.textContent).not.toContain('-');
    expect(root.textContent).not.toContain('left');
  });

  it('degrades to "TTL unknown" for a type with no heuristic entry, never throwing or fabricating a duration', async () => {
    const root = await mount(createElement(WispChip, { wisp: wisp({ type: 'bug' }), now: CREATED_MS }));

    expect(root.textContent).toContain('TTL unknown');
    expect(root.textContent).not.toContain('left');
    expect(root.textContent).not.toContain('stale');
  });

  it('degrades to "TTL unknown" instead of throwing when created_at is missing', async () => {
    const root = await mount(createElement(WispChip, { wisp: wisp({ created_at: undefined }), now: CREATED_MS }));
    expect(root.textContent).toContain('TTL unknown');
  });

  it('always shows the id, title and raw type field, never inventing a wisp_type label', async () => {
    const root = await mount(createElement(WispChip, { wisp: wisp(), now: CREATED_MS }));

    expect(root.querySelector('article')?.getAttribute('aria-label')).toBe(
      'bd-mol-fixtures-scratch-wisp-421: Design healthcheck',
    );
    expect(root.textContent).toContain('task');
  });
});

describe('WispStrip', () => {
  it('renders nothing for an empty wisp list', async () => {
    const root = await mount(createElement(WispStrip, { wisps: [] }));
    expect(root.querySelector('section')).toBeNull();
  });

  it('renders one chip per wisp, labelled with the count', async () => {
    const wisps = [wisp({ id: 'w-1' }), wisp({ id: 'w-2', type: 'molecule', title: 'fixdemo' })];
    const root = await mount(createElement(WispStrip, { wisps, now: CREATED_MS }));

    const section = root.querySelector('section');
    expect(section?.getAttribute('aria-label')).toBe('Wisps (2)');
    expect(root.querySelectorAll('article')).toHaveLength(2);
  });

  it('passes the same injected clock down to every chip, no chip reading the real wall clock', async () => {
    const wisps = [wisp({ id: 'w-1', type: 'task' })];
    const now = CREATED_MS + WISP_TTL_MS.task + 1; // just past task's heuristic TTL
    const root = await mount(createElement(WispStrip, { wisps, now }));

    expect(root.textContent).toContain('stale');
  });
});
