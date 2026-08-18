/**
 * Command handlers. These are thin: pick a value, call a mutation, report.
 * Anything that looks like business logic belongs in `bd/` or `shared/model`.
 */
import * as vscode from 'vscode';

import { StatusIndex } from '../shared/model';
import { PRIORITY_LABELS, type Bead, type Priority } from '../shared/types';
import type { DashboardPanel } from './panel/DashboardPanel';
import type { BeadsStore } from './store';
import { toRpcError } from './store';
import type { BeadNode } from './tree/BeadsTreeProvider';

/** Tree nodes arrive as the argument; the palette passes a bare id. */
function resolveId(target: BeadNode | string | undefined): string | undefined {
  if (typeof target === 'string') return target;
  return target?.bead?.id;
}

function beadOf(store: BeadsStore, id: string): Bead | undefined {
  return store.current.snapshot?.beads.find((bead) => bead.id === id);
}

/** Runs a mutation and turns any failure into one actionable message. */
async function guard(action: () => Promise<void>, output: vscode.OutputChannel): Promise<void> {
  try {
    await action();
  } catch (error) {
    const rpcError = toRpcError(error);
    output.appendLine(`command failed: ${rpcError.kind}: ${rpcError.message}`);
    if (rpcError.detail) output.appendLine(rpcError.detail);

    const choice = await vscode.window.showErrorMessage(`bd: ${rpcError.message}`, 'Show Log');
    if (choice === 'Show Log') output.show(true);
  }
}

export interface CommandDeps {
  store: BeadsStore;
  output: vscode.OutputChannel;
  openDashboard: (id?: string) => void;
  panel: () => DashboardPanel | undefined;
  /** Re-runs the multi-root picker and reloads against the chosen folder. */
  selectFolder: () => Promise<void>;
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { store, output } = deps;

  const register = (
    command: string,
    handler: (...args: never[]) => unknown,
  ): vscode.Disposable => vscode.commands.registerCommand(command, handler);

  return [
    register('beadsDashboard.refresh', () => void store.refresh()),

    register('beadsDashboard.showOutput', () => output.show(true)),

    register('beadsDashboard.openDashboard', () => deps.openDashboard()),

    register('beadsDashboard.openBead', (target: BeadNode | string) => {
      const id = resolveId(target);
      if (id) deps.openDashboard(id);
    }),

    register('beadsDashboard.copyId', async (target: BeadNode | string) => {
      const id = resolveId(target);
      if (!id) return;
      await vscode.env.clipboard.writeText(id);
      vscode.window.setStatusBarMessage(`Copied ${id}`, 2000);
    }),

    register('beadsDashboard.claim', async (target: BeadNode | string) => {
      const id = resolveId(target);
      if (!id) return;
      await guard(() => store.mutations.claim(id), output);
    }),

    register('beadsDashboard.setStatus', async (target: BeadNode | string) => {
      const id = resolveId(target);
      const snapshot = store.current.snapshot;
      if (!id || !snapshot) return;

      const index = new StatusIndex(snapshot.vocabulary.statuses);
      const current = beadOf(store, id)?.status;

      // The picker is built from the runtime vocabulary, so a project with
      // custom statuses offers them without any change here.
      const picked = await vscode.window.showQuickPick(
        snapshot.vocabulary.statuses.map((status) => ({
          label: `${status.icon ?? ''} ${status.name}`.trim(),
          description: status.name === current ? 'current' : index.category(status.name),
          detail: status.description,
          value: status.name,
        })),
        { title: `Status for ${id}`, placeHolder: current },
      );
      if (!picked || picked.value === current) return;

      await guard(() => store.mutations.setStatus(id, picked.value), output);
    }),

    register('beadsDashboard.setPriority', async (target: BeadNode | string) => {
      const id = resolveId(target);
      if (!id) return;
      const current = beadOf(store, id)?.priority;

      const picked = await vscode.window.showQuickPick(
        ([0, 1, 2, 3, 4] as Priority[]).map((priority) => ({
          label: PRIORITY_LABELS[priority],
          description: priority === current ? 'current' : undefined,
          value: priority,
        })),
        { title: `Priority for ${id}` },
      );
      if (!picked || picked.value === current) return;

      await guard(() => store.mutations.setPriority(id, picked.value), output);
    }),

    register('beadsDashboard.setAssignee', async (target: BeadNode | string) => {
      const id = resolveId(target);
      if (!id) return;
      const current = beadOf(store, id)?.assignee ?? '';

      const value = await vscode.window.showInputBox({
        title: `Assignee for ${id}`,
        value: current,
        prompt: 'Leave empty to unassign.',
      });
      if (value === undefined || value === current) return;

      await guard(() => store.mutations.setAssignee(id, value), output);
    }),

    register('beadsDashboard.closeBead', async (target: BeadNode | string) => {
      const id = resolveId(target);
      if (!id) return;

      const reason = await vscode.window.showInputBox({
        title: `Close ${id}`,
        prompt: 'Reason (optional). Press Escape to cancel.',
        placeHolder: 'e.g. shipped in 0.2.0',
      });
      // Escape cancels; an empty string is a deliberate "no reason".
      if (reason === undefined) return;

      await guard(() => store.mutations.close(id, reason), output);
    }),

    register('beadsDashboard.selectFolder', () => void deps.selectFolder()),
  ];
}
