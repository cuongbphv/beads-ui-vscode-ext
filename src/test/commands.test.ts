/**
 * `beadsDashboard.createBead`: the InputBox → QuickPick(type) → QuickPick(parent)
 * → `mutations.create` → `openDashboard` flow.
 *
 * Follows the `router.test.ts` precedent: a minimal `vi.mock('vscode', ...)`
 * covering only what `commands.ts` touches, plus a fake store/mutations pair
 * that records calls instead of shelling out to `bd`.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { CreateBeadParams } from '../shared/protocol';
import type { Bead, BdVocabulary, DashboardSnapshot } from '../shared/types';

/** The QuickPick item shape every step of this command uses (`value` carries the picked id/name). */
interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  value: string | undefined;
}

type Handler = (...args: never[]) => unknown;

const registered = new Map<string, Handler>();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((command: string, handler: Handler) => {
      registered.set(command, handler);
      return { dispose: vi.fn() };
    }),
  },
  window: {
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));

const vscode = await import('vscode');
const { registerCommands } = await import('../extension/commands');
import type { BeadsStore } from '../extension/store';

/**
 * The real `vscode.window.showQuickPick` is heavily overloaded and its type
 * declaration forbids extra properties on plain `QuickPickItem`. The command
 * under test always calls it with a `value`-carrying item, so the mock is
 * cast once, here, to the shape it is actually used with.
 */
const showQuickPick = vscode.window.showQuickPick as unknown as Mock<
  (items: PickItem[], options?: unknown) => Promise<PickItem | undefined>
>;

/** Records every call so a test can assert on the exact params passed through. */
class FakeMutations {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async setStatus(id: string, status: string, observedStatus: string): Promise<void> {
    this.calls.push({ method: 'setStatus', args: [id, status, observedStatus] });
  }

  async setAssignee(id: string, assignee: string, observedAssignee: string): Promise<void> {
    this.calls.push({ method: 'setAssignee', args: [id, assignee, observedAssignee] });
  }

  async create(input: CreateBeadParams): Promise<{ id: string }> {
    this.calls.push({ method: 'create', args: [input] });
    return { id: 'bd-new-1' };
  }
}

const vocabulary: BdVocabulary = {
  statuses: [],
  types: [
    { name: 'task', description: 'A unit of work' },
    { name: 'bug', description: 'Something broken' },
  ],
};

const epicA: Bead = {
  id: 'bd-epic-a',
  title: 'Epic A',
  status: 'open',
  priority: 2,
  issue_type: 'epic',
};

const taskB: Bead = {
  id: 'bd-task-b',
  title: 'Task B',
  status: 'open',
  priority: 2,
  issue_type: 'task',
};

function makeSnapshot(): DashboardSnapshot {
  return {
    context: {} as DashboardSnapshot['context'],
    vocabulary,
    stats: {} as DashboardSnapshot['stats'],
    beads: [epicA, taskB],
    readyIds: [],
    blockedIds: [],
    gates: [],
    truncated: false,
    fetchedAt: new Date().toISOString(),
  };
}

function makeStore(mutations: FakeMutations, snapshot: DashboardSnapshot | undefined, freshBead?: Bead): BeadsStore {
  return {
    current: { snapshot, loading: false },
    mutations,
    queries: { show: vi.fn(async (id: string) => ({
      bead: freshBead?.id === id ? freshBead : snapshot?.beads.find((bead) => bead.id === id) ?? null,
      comments: [],
    })) },
  } as unknown as BeadsStore;
}

/** Registers the commands and returns the `createBead` handler, ready to invoke. */
function createBeadHandler(
  mutations: FakeMutations,
  openDashboard: Mock<(id?: string) => void>,
  snapshot: DashboardSnapshot | undefined,
  freshBead?: Bead,
): Handler {
  registered.clear();
  registerCommands({
    store: makeStore(mutations, snapshot, freshBead),
    output: { appendLine: vi.fn(), show: vi.fn() } as unknown as import('vscode').OutputChannel,
    openDashboard,
    panel: () => undefined,
    selectFolder: vi.fn(async () => undefined),
  });
  const handler = registered.get('beadsDashboard.createBead');
  if (!handler) throw new Error('beadsDashboard.createBead was not registered');
  return handler;
}

describe('beadsDashboard.createBead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the issue and opens it once title, type and parent are all picked', async () => {
    const mutations = new FakeMutations();
    const openDashboard: Mock<(id?: string) => void> = vi.fn();
    const handler = createBeadHandler(mutations, openDashboard, makeSnapshot());

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('  Fix the flaky test  ');
    showQuickPick
      .mockResolvedValueOnce({ label: 'bug', description: undefined, detail: 'Something broken', value: 'bug' })
      .mockResolvedValueOnce({ label: 'Epic A', description: 'bd-epic-a', value: 'bd-epic-a' });

    await handler();

    expect(mutations.calls).toEqual([
      { method: 'create', args: [{ title: 'Fix the flaky test', type: 'bug', parent: 'bd-epic-a' }] },
    ]);
    expect(openDashboard).toHaveBeenCalledWith('bd-new-1');
  });

  it('creates with no parent when "(none)" is picked', async () => {
    const mutations = new FakeMutations();
    const openDashboard: Mock<(id?: string) => void> = vi.fn();
    const handler = createBeadHandler(mutations, openDashboard, makeSnapshot());

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('Untriaged idea');
    showQuickPick
      .mockResolvedValueOnce({ label: 'task', description: undefined, detail: 'A unit of work', value: 'task' })
      .mockResolvedValueOnce({ label: '(none)', value: undefined });

    await handler();

    expect(mutations.calls).toEqual([
      { method: 'create', args: [{ title: 'Untriaged idea', type: 'task', parent: undefined }] },
    ]);
    expect(openDashboard).toHaveBeenCalledWith('bd-new-1');
  });

  it('offers the QuickPick type list built from the runtime vocabulary, not a hardcoded set', async () => {
    const mutations = new FakeMutations();
    const handler = createBeadHandler(mutations, vi.fn<(id?: string) => void>(), makeSnapshot());

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('Title');
    showQuickPick.mockResolvedValueOnce(undefined); // cancel at type step

    await handler();

    const typeItems = showQuickPick.mock.calls[0]?.[0];
    expect(typeItems).toEqual([
      { label: 'task', description: undefined, detail: 'A unit of work', value: 'task' },
      { label: 'bug', description: undefined, detail: 'Something broken', value: 'bug' },
    ]);
  });

  it('offers the epics from the snapshot plus a "(none)" option at the parent step', async () => {
    const mutations = new FakeMutations();
    const handler = createBeadHandler(mutations, vi.fn<(id?: string) => void>(), makeSnapshot());

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('Title');
    showQuickPick
      .mockResolvedValueOnce({ label: 'task', description: undefined, detail: 'A unit of work', value: 'task' })
      .mockResolvedValueOnce(undefined); // cancel at parent step

    await handler();

    const parentItems = showQuickPick.mock.calls[1]?.[0];
    expect(parentItems).toEqual([
      { label: '(none)', value: undefined },
      { label: 'Epic A', description: 'bd-epic-a', value: 'bd-epic-a' },
    ]);
  });

  it('rejects a blank title via the InputBox validator without opening any QuickPick', async () => {
    const mutations = new FakeMutations();
    const handler = createBeadHandler(mutations, vi.fn<(id?: string) => void>(), makeSnapshot());

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);
    await handler();

    const options = vi.mocked(vscode.window.showInputBox).mock.calls.at(-1)?.[0];
    expect(options?.validateInput?.('   ')).toBe('Title is required.');
    expect(options?.validateInput?.('ok')).toBeUndefined();
  });

  it('aborts cleanly when the InputBox is cancelled (Escape)', async () => {
    const mutations = new FakeMutations();
    const openDashboard: Mock<(id?: string) => void> = vi.fn();
    const handler = createBeadHandler(mutations, openDashboard, makeSnapshot());

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);

    await handler();

    expect(showQuickPick).not.toHaveBeenCalled();
    expect(mutations.calls).toEqual([]);
    expect(openDashboard).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('aborts cleanly when the type QuickPick is cancelled', async () => {
    const mutations = new FakeMutations();
    const openDashboard: Mock<(id?: string) => void> = vi.fn();
    const handler = createBeadHandler(mutations, openDashboard, makeSnapshot());

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('Title');
    showQuickPick.mockResolvedValueOnce(undefined);

    await handler();

    expect(showQuickPick).toHaveBeenCalledTimes(1);
    expect(mutations.calls).toEqual([]);
    expect(openDashboard).not.toHaveBeenCalled();
  });

  it('aborts cleanly when the parent QuickPick is cancelled', async () => {
    const mutations = new FakeMutations();
    const openDashboard: Mock<(id?: string) => void> = vi.fn();
    const handler = createBeadHandler(mutations, openDashboard, makeSnapshot());

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('Title');
    showQuickPick
      .mockResolvedValueOnce({ label: 'task', description: undefined, detail: 'A unit of work', value: 'task' })
      .mockResolvedValueOnce(undefined);

    await handler();

    expect(showQuickPick).toHaveBeenCalledTimes(2);
    expect(mutations.calls).toEqual([]);
    expect(openDashboard).not.toHaveBeenCalled();
  });

  it('does nothing when there is no snapshot yet', async () => {
    const mutations = new FakeMutations();
    const openDashboard: Mock<(id?: string) => void> = vi.fn();
    const handler = createBeadHandler(mutations, openDashboard, undefined);

    await handler();

    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(mutations.calls).toEqual([]);
    expect(openDashboard).not.toHaveBeenCalled();
  });
});

describe('guarded tree quick actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the freshly loaded status to the mutation', async () => {
    const mutations = new FakeMutations();
    const snapshot = makeSnapshot();
    snapshot.vocabulary.statuses = [
      { name: 'open', category: 'active' },
      { name: 'in_progress', category: 'wip' },
    ];
    createBeadHandler(mutations, vi.fn(), snapshot, { ...taskB, status: 'in_progress' });
    showQuickPick.mockResolvedValueOnce({ label: 'open', value: 'open' });

    await registered.get('beadsDashboard.setStatus')?.('bd-task-b' as never);

    expect(mutations.calls).toEqual([{ method: 'setStatus', args: ['bd-task-b', 'open', 'in_progress'] }]);
  });

  it('passes a freshly loaded assignee when the snapshot is stale', async () => {
    const mutations = new FakeMutations();
    createBeadHandler(mutations, vi.fn(), makeSnapshot(), { ...taskB, assignee: 'bob' });
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('ana');

    await registered.get('beadsDashboard.setAssignee')?.('bd-task-b' as never);

    expect(mutations.calls).toEqual([{ method: 'setAssignee', args: ['bd-task-b', 'ana', 'bob'] }]);
  });
});
