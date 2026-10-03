import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BdContext } from '../shared/types';

interface Folder { name: string; uri: { fsPath: string; toString(): string } }
const folders: Folder[] = [];
const contexts = new Map<string, BdContext>();
const existingDirectories = new Set<string>();
const quickPick = vi.fn();
const messages = { warning: vi.fn(), info: vi.fn() };

vi.mock('vscode', () => ({
  FileType: { Directory: 2 },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: {
    get workspaceFolders() { return folders; },
    getConfiguration: () => ({ get: () => '/custom/bd' }),
    fs: { stat: async ({ fsPath }: { fsPath: string }) => {
      if (!existingDirectories.has(fsPath)) throw new Error('missing');
      return { type: 2 };
    } },
  },
  window: {
    showQuickPick: quickPick,
    showWarningMessage: messages.warning,
    showInformationMessage: messages.info,
  },
}));

const serviceOptions: Array<{ cwd: string; bdPath?: string }> = [];
vi.mock('../extension/bd/BdService', () => ({
  BdService: class {
    readonly cwd: string;
    constructor(options: { cwd: string; bdPath?: string }) {
      serviceOptions.push(options);
      this.cwd = options.cwd;
    }
  },
}));
vi.mock('../extension/bd/queries', () => ({
  BdQueries: class {
    constructor(private readonly service: { cwd: string }) {}
    async context(): Promise<BdContext> {
      const context = contexts.get(this.service.cwd);
      if (!context) throw new Error('no database');
      return context;
    }
  },
}));

const { findBeadsFolders, resolveBeadsFolder, pickBeadsFolder } = await import('../extension/workspace');

function folder(name: string, fsPath: string): Folder {
  return { name, uri: { fsPath, toString: () => `file://${fsPath}` } };
}

function context(beadsDir: string, additional: Partial<BdContext> = {}): BdContext {
  return { bd_version: '1.3.1', beads_dir: beadsDir, repo_root: '/repo', ...additional };
}

function memento() {
  const values = new Map<string, string>();
  return {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (values.get(key) as T | undefined) ?? defaultValue,
    update: async (key: string, value: string) => { values.set(key, value); },
    keys: () => [...values.keys()],
  };
}

beforeEach(() => {
  folders.length = 0;
  contexts.clear();
  existingDirectories.clear();
  serviceOptions.length = 0;
  quickPick.mockReset();
  messages.warning.mockReset();
  messages.info.mockReset();
});

describe('Beads workspace resolution', () => {
  it('selects an ordinary repo through its CLI context', async () => {
    folders.push(folder('repo', '/repo'));
    contexts.set('/repo', context('/repo/.beads'));
    existingDirectories.add('/repo/.beads');

    const selected = await resolveBeadsFolder(memento(), false);
    expect(selected?.folder.uri.fsPath).toBe('/repo');
    expect(selected?.context.beads_dir).toBe('/repo/.beads');
    expect(serviceOptions).toEqual([{ cwd: '/repo', bdPath: '/custom/bd' }]);
  });

  it('accepts a worktree whose CLI resolves to the main worktree database', async () => {
    folders.push(folder('worktree', '/worktree'));
    contexts.set('/worktree', context('/main/.beads', { is_worktree: true }));
    existingDirectories.add('/main/.beads');

    expect((await resolveBeadsFolder(memento(), false))?.context.beads_dir).toBe('/main/.beads');
  });

  it('remembers the chosen multi-root folder even when databases are shared', async () => {
    folders.push(folder('first', '/first'), folder('second', '/second'));
    contexts.set('/first', context('/shared/.beads'));
    contexts.set('/second', context('/shared/.beads'));
    existingDirectories.add('/shared/.beads');
    const state = memento();
    quickPick.mockImplementation(async (items: Array<{ candidate: { folder: Folder } }>) => items[1]);

    const selected = await resolveBeadsFolder(state, true);
    expect(selected?.folder.name).toBe('second');
    expect((await resolveBeadsFolder(state, false))?.folder.name).toBe('second');
    expect(quickPick).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid BEADS_DIR override reported by bd context', async () => {
    folders.push(folder('repo', '/repo'));
    contexts.set('/repo', context('/external/.beads', { is_redirected: true }));
    existingDirectories.add('/external/.beads');

    expect((await findBeadsFolders())[0]?.context).toMatchObject({
      beads_dir: '/external/.beads', is_redirected: true,
    });
  });

  it('rejects a missing BEADS_DIR target and a folder where bd context fails', async () => {
    folders.push(folder('invalid', '/invalid'), folder('uninitialized', '/empty'));
    contexts.set('/invalid', context('/missing/.beads'));

    expect(await findBeadsFolders()).toEqual([]);
    expect(await pickBeadsFolder(memento(), undefined)).toBeUndefined();
    expect(messages.warning).toHaveBeenCalledWith(expect.stringContaining('bd context'));
  });

  it('shows the actual database when switching folders', async () => {
    folders.push(folder('first', '/first'), folder('second', '/second'));
    contexts.set('/first', context('/first/.beads'));
    contexts.set('/second', context('/external/.beads'));
    existingDirectories.add('/first/.beads');
    existingDirectories.add('/external/.beads');
    quickPick.mockImplementation(async (items: Array<{ candidate: { folder: Folder } }>) => items[1]);

    const picked = await pickBeadsFolder(memento(), await resolveBeadsFolder(memento(), false));
    expect(picked?.folder.name).toBe('second');
    expect(quickPick.mock.calls[0][0][1].detail).toContain('/external/.beads');
  });
});
