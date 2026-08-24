// @vitest-environment jsdom

/**
 * `MoleculesView`: wires `useMolecules()` to the loading/empty states and
 * `MoleculeCard` list, using REAL bd 1.2.2 fixture data from
 * `src/test/fixtures/mol/` (bead beads-ui-vscode-ext-8eo.1) run through the
 * same `shared/mol.ts` parsers the extension host uses — never an invented
 * mock shape. The hook's own fetch/refetch contract is `use-molecules.test.tsx`'s
 * subject; this file checks that mount drives `getMolSnapshot`, that each
 * snapshot shape renders the right view, that a card click reaches
 * `onSelect` (bead 8eo.3) AND now also opens the inline step-list detail
 * (bead 8eo.4, `MoleculeDetail`/`useMolDetail`), and that a step click
 * inside that detail reaches `onSelect` with the STEP's id, not the
 * molecule root's — the actual `StepList` rendering (states, parallel
 * groups, gate badges) is `step-list.test.tsx`'s subject, not this file's.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { toMolProgress, toMolWisp, type MolDetail, type MolListItem, type MolSnapshot } from '../shared/mol';
import type { HostEvent } from '../shared/protocol';
import type { Bead, BdGate } from '../shared/types';
// Static JSON imports (`resolveJsonModule`), not `node:fs` + `import.meta.url`:
// this file is a `.tsx` test, so it is typechecked under
// `tsconfig.webview.json`, which declares `types: []` (no ambient `node`
// globals) — unlike the plain-node `mol-fixtures.test.ts`/`mol-model.test.ts`
// suites that read these same files with `readFileSync`. Both routes load the
// identical, real bd 1.2.2 capture on disk.
import gateListFixture from './fixtures/mol/gate-list.json';
import listTypeMoleculeFixture from './fixtures/mol/list-type-molecule.json';
import molProgressFixture from './fixtures/mol/mol-progress.json';
import molShowParallelFixture from './fixtures/mol/mol-show-parallel.json';
import molStaleFixture from './fixtures/mol/mol-stale.json';
import wispListFixture from './fixtures/mol/wisp-list.json';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown }>,
  listeners: new Set<(event: HostEvent) => void>(),
  pending: [] as Array<{ resolve: (value: unknown) => void; reject: (cause: unknown) => void }>,
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: unknown) => {
    rpc.calls.push({ method, params });
    return new Promise((resolve, reject) => {
      rpc.pending.push({ resolve, reject });
    });
  },
  onHostEvent: (listener: (event: HostEvent) => void) => {
    rpc.listeners.add(listener);
    return () => rpc.listeners.delete(listener);
  },
  asRpcError: (cause: unknown) => ({ message: String(cause), kind: 'unknown' as const }),
}));

const { MoleculesView } = await import('../webview/views/MoleculesView');

function fireIssuesChanged(): void {
  for (const listener of [...rpc.listeners]) {
    listener({ kind: 'event', name: 'issuesChanged', snapshot: {} as never });
  }
}

/** Resolves the oldest still-pending RPC call — getMolSnapshot or showMolecule alike. */
async function resolveOldest(value: MolSnapshot | MolDetail): Promise<void> {
  const call = rpc.pending.shift();
  if (!call) throw new Error('no pending RPC call to resolve');
  await act(async () => call.resolve(value));
}

// Real fixture-derived data (bead beads-ui-vscode-ext-8eo.1 captures), run
// through the same parsers `BdQueries.molSnapshot` uses.
const rootBead = (listTypeMoleculeFixture as unknown as Bead[])[0];
const stepIssues = (molShowParallelFixture as unknown as { issues: Bead[] }).issues;
const beadsByIdFixture = new Map(stepIssues.map((issue) => [issue.id, issue]));
const healthyProgress = toMolProgress(molProgressFixture);
const wispRows = (wispListFixture as unknown as { wisps: unknown[] }).wisps.map(toMolWisp);
const staleRow = (
  molStaleFixture as unknown as { stale_molecules: Array<{ id: string; title: string }> }
).stale_molecules[0];
const gateFixtures = gateListFixture as unknown as BdGate[];

function populatedSnapshot(overrides: Partial<MolSnapshot> = {}): MolSnapshot {
  const healthy: MolListItem = { root: rootBead, progress: healthyProgress, stale: false, degraded: false };
  const stale: MolListItem = {
    root: {
      id: staleRow.id,
      title: staleRow.title,
      status: 'open',
      priority: 2,
      issue_type: 'epic',
    },
    progress: null,
    stale: true,
    degraded: false,
  };
  return {
    molecules: [healthy, stale],
    wisps: wispRows,
    gates: [],
    fetchedAt: new Date().toISOString(),
    degraded: false,
    ...overrides,
  };
}

function emptySnapshot(): MolSnapshot {
  return { molecules: [], wisps: [], gates: [], fetchedAt: new Date().toISOString(), degraded: false };
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
  rpc.calls.length = 0;
  rpc.listeners.clear();
  rpc.pending.length = 0;
});

async function mount(
  options: {
    beadsById?: ReadonlyMap<string, Bead>;
    onSelect?: (id: string) => void;
    selectedId?: string;
  } = {},
): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () =>
    mounted?.render(
      createElement(MoleculesView, {
        beadsById: options.beadsById ?? beadsByIdFixture,
        onSelect: options.onSelect ?? (() => {}),
        selectedId: options.selectedId,
      }),
    ),
  );
  return container;
}

describe('MoleculesView', () => {
  it('fetches getMolSnapshot on mount and shows a loading state before it settles', async () => {
    const el = await mount();

    expect(rpc.calls).toEqual([{ method: 'getMolSnapshot', params: undefined }]);
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders the empty state for a zero-molecule snapshot', async () => {
    const el = await mount();
    await resolveOldest(emptySnapshot());

    expect(el.textContent).toContain('No molecules in this project');
    expect(el.textContent).toContain('bd mol pour');
  });

  it('renders a card per molecule from the real fixture snapshot: id, title, progress, current step', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot());

    expect(el.textContent).toContain(rootBead.id);
    expect(el.textContent).toContain(rootBead.title);
    // mol-progress.json: 1/4 steps, 25%.
    expect(el.textContent).toContain('1/4 steps');
    expect(el.textContent).toContain('25%');
    // current_step_id in mol-progress.json resolves via beadsById to its real title.
    expect(el.textContent).toContain('Implement auth part A');
  });

  it('shows a stale badge only on the molecule bd mol stale flagged', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot());

    const cards = Array.from(el.querySelectorAll('article'));
    const healthyCard = cards.find((card) => card.textContent?.includes(rootBead.id));
    const staleCard = cards.find((card) => card.textContent?.includes(staleRow.id));

    expect(healthyCard?.textContent).not.toContain('stale');
    expect(staleCard?.textContent).toContain('stale');
    // No progress fixture exists for the stale (epic) row — the card must
    // degrade quietly, never fabricate a bar.
    expect(staleCard?.textContent).toContain('No progress data.');
  });

  it('shows the degraded banner when the snapshot reports a failed per-molecule progress read', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot({ degraded: true }));

    expect(el.textContent).toContain('could not be read');
  });

  it('calls onSelect with the molecule root id when its card is clicked', async () => {
    const onSelect = vi.fn();
    const el = await mount({ onSelect });
    await resolveOldest(populatedSnapshot());

    const card = el.querySelector(`article[aria-label^="${rootBead.id}"]`) as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => card.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSelect).toHaveBeenCalledWith(rootBead.id);
  });

  it('refetches getMolSnapshot on issuesChanged while mounted', async () => {
    await mount();
    await resolveOldest(populatedSnapshot());
    rpc.calls.length = 0;

    await act(async () => fireIssuesChanged());

    expect(rpc.calls).toEqual([{ method: 'getMolSnapshot', params: undefined }]);
    await resolveOldest(emptySnapshot());
  });

  it('opens the inline step-list detail for a molecule when its card is clicked, fetching showMolecule for its id', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot());

    const card = el.querySelector(`article[aria-label^="${rootBead.id}"]`) as HTMLElement;
    await act(async () => card.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(rpc.calls).toEqual([
      { method: 'getMolSnapshot', params: undefined },
      { method: 'showMolecule', params: { id: rootBead.id } },
    ]);
    expect(el.querySelector(`section[aria-label="${rootBead.title} steps"]`)).not.toBeNull();
  });

  it('a step click inside the opened detail calls onSelect with the STEP id, not the molecule root id', async () => {
    const onSelect = vi.fn();
    const el = await mount({ onSelect });
    await resolveOldest(populatedSnapshot());

    const card = el.querySelector(`article[aria-label^="${rootBead.id}"]`) as HTMLElement;
    await act(async () => card.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    onSelect.mockClear(); // clear the root-id call the card click itself made

    await resolveOldest({
      root: rootBead,
      steps: [{ issue: stepIssues[1], status: 'ready', is_current: false }],
      parallelAvailable: false,
      progress: null,
    });

    const stepRow = Array.from(el.querySelectorAll('section article')).find((row) =>
      row.getAttribute('aria-label')?.startsWith(stepIssues[1].id),
    ) as HTMLElement;
    expect(stepRow).toBeDefined();
    await act(async () => stepRow.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSelect).toHaveBeenCalledWith(stepIssues[1].id);
    expect(onSelect).not.toHaveBeenCalledWith(rootBead.id);
  });

  it('renders gate cards at the top of the view from snapshot.gates, with zero new RPC calls beyond getMolSnapshot', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot({ gates: gateFixtures }));

    // Real fixture: one human, one timer, one gh:pr gate — see gate-list.json.
    const section = el.querySelector('section[aria-label^="Gates ("]');
    expect(section?.getAttribute('aria-label')).toBe('Gates (3)');
    expect(el.textContent).toContain('Waiting on a person');
    // Only the one getMolSnapshot round trip fired — gate cards cost no new reads.
    expect(rpc.calls).toEqual([{ method: 'getMolSnapshot', params: undefined }]);

    const humanCard = section?.querySelector('article[aria-label^="bd-mol-fixtures-scratch-wb6"]');
    const timerCard = section?.querySelector('article[aria-label^="bd-mol-fixtures-scratch-qpb"]');
    expect(humanCard?.querySelector('button')?.textContent).toContain('Resolve');
    expect(timerCard?.querySelector('button')).toBeNull();
  });

  it('renders no gate section when snapshot.gates is empty, even with molecules present', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot({ gates: [] }));

    expect(el.querySelector('section[aria-label^="Gates ("]')).toBeNull();
  });

  it('does not show the full "No molecules" empty state when gates exist but there are zero molecules', async () => {
    const el = await mount();
    await resolveOldest({
      molecules: [],
      wisps: [],
      gates: gateFixtures,
      fetchedAt: new Date().toISOString(),
      degraded: false,
    });

    expect(el.textContent).not.toContain('No molecules in this project');
    expect(el.querySelector('section[aria-label^="Gates ("]')).not.toBeNull();
  });

  it('does not show the full "No molecules" empty state when only wisps exist (zero molecules, zero gates)', async () => {
    const el = await mount();
    await resolveOldest({
      molecules: [],
      wisps: wispRows,
      gates: [],
      fetchedAt: new Date().toISOString(),
      degraded: false,
    });

    expect(el.textContent).not.toContain('No molecules in this project');
    expect(el.querySelector('section[aria-label^="Wisps ("]')).not.toBeNull();
  });

  it('renders the wisp strip from snapshot.wisps with zero new RPC calls beyond getMolSnapshot', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot());

    // Real fixture wisp-list.json: 5 rows (1 "molecule" root + 4 "task" steps).
    const section = el.querySelector('section[aria-label^="Wisps ("]');
    expect(section?.getAttribute('aria-label')).toBe('Wisps (5)');
    expect(el.querySelectorAll('section[aria-label^="Wisps ("] article')).toHaveLength(5);
    expect(rpc.calls).toEqual([{ method: 'getMolSnapshot', params: undefined }]);
  });

  it('renders no wisp section when snapshot.wisps is empty, even with molecules present', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot({ wisps: [] }));

    expect(el.querySelector('section[aria-label^="Wisps ("]')).toBeNull();
  });

  it('closes the detail section when its close button is clicked', async () => {
    const el = await mount();
    await resolveOldest(populatedSnapshot());

    const card = el.querySelector(`article[aria-label^="${rootBead.id}"]`) as HTMLElement;
    await act(async () => card.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await resolveOldest({ root: rootBead, steps: [], parallelAvailable: false, progress: null });

    const closeButton = el.querySelector('button[aria-label="Close step list"]') as HTMLElement;
    await act(async () => closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(el.querySelector(`section[aria-label="${rootBead.title} steps"]`)).toBeNull();
  });
});
