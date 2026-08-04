/**
 * Activation.
 *
 * Every degraded state has to be legible: no workspace folder, no `.beads`
 * directory, no `bd` on PATH, or a `bd` that runs but refuses. None of them may
 * throw out of `activate()` — that would leave the view container empty with no
 * explanation.
 */
import * as vscode from 'vscode';

import type { DashboardTab } from '../shared/protocol';
import { registerCommands } from './commands';
import { DashboardPanel } from './panel/DashboardPanel';
import { BeadsStore } from './store';
import { BeadsTreeProvider } from './tree/BeadsTreeProvider';
import { VeloxSync } from './velox/VeloxSync';
import { pickBeadsFolder, resolveBeadsFolder } from './workspace';

let store: BeadsStore | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Beads UI');
  context.subscriptions.push(output);

  const folder = await resolveBeadsFolder(context.workspaceState, false);
  if (!folder) {
    // The tree's viewsWelcome explains what to do; the command still opens so
    // the user gets a real message rather than "command not found".
    await vscode.commands.executeCommand('setContext', 'beadsUi.hasWorkspace', false);
    context.subscriptions.push(
      vscode.commands.registerCommand('beadsUi.openDashboard', () =>
        vscode.window.showWarningMessage(
          'No .beads directory found in this workspace. Run `bd init` in a terminal first.',
        ),
      ),
      vscode.commands.registerCommand('beadsUi.showOutput', () => output.show(true)),
    );
    output.appendLine('No workspace folder contains a .beads directory — staying idle.');
    return;
  }

  output.appendLine(`Beads workspace: ${folder.uri.fsPath}`);
  await vscode.commands.executeCommand('setContext', 'beadsUi.hasWorkspace', true);

  store = new BeadsStore(folder, output);
  context.subscriptions.push(store);

  const tree = new BeadsTreeProvider(store);
  context.subscriptions.push(tree);

  const treeView = vscode.window.createTreeView('beadsUi.tree', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const openDashboard = (id?: string): void => {
    const defaultTab = vscode.workspace
      .getConfiguration('beadsUi')
      .get<DashboardTab>('defaultTab', 'overview');

    const panel = DashboardPanel.show(context, store!, { revealBead }, defaultTab);
    if (id) panel.focus(id);
  };

  /** Selecting an issue in the webview highlights it in the sidebar too. */
  const revealBead = (id: string): void => {
    const node = tree.nodeFor(id);
    if (node) void treeView.reveal(node, { select: true, focus: false, expand: true });
  };

  const velox = new VeloxSync({ store, output, folder: () => folder });

  /**
   * Switching the tracked folder rebuilds the store, the tree and the panel, so
   * it is done by reloading the window rather than by re-threading every
   * reference — the choice is remembered, so the reload lands on it.
   */
  const selectFolder = async (): Promise<void> => {
    const picked = await pickBeadsFolder(context.workspaceState, folder);
    if (!picked) return;

    const choice = await vscode.window.showInformationMessage(
      `Track beads in ${picked.name}?`,
      { detail: 'The window reloads so every view picks up the new folder.', modal: true },
      'Reload Window',
    );
    if (choice === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  };

  context.subscriptions.push(
    ...registerCommands({
      store,
      output,
      openDashboard,
      panel: () => DashboardPanel.active,
      velox,
      selectFolder,
    }),
  );

  // Keep the view container's title badge honest about how much is actionable.
  context.subscriptions.push(
    store.onDidChange((state) => {
      const ready = state.snapshot?.readyIds.length ?? 0;
      treeView.badge = ready > 0 ? { value: ready, tooltip: `${ready} issue(s) ready` } : undefined;
      treeView.description = state.error ? 'bd unavailable' : undefined;
    }),
  );

  const state = await store.refresh();
  if (state.error) {
    // A first-run failure is worth interrupting for: nothing will work until
    // it is fixed, and the message names the fix.
    const action = state.error.kind === 'bd-not-found' ? 'Open Settings' : 'Show Log';
    const choice = await vscode.window.showErrorMessage(`Beads: ${state.error.message}`, action);
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'beadsUi.bdPath');
    } else if (choice === 'Show Log') {
      output.show(true);
    }
  } else {
    output.appendLine(`Loaded ${state.snapshot?.beads.length ?? 0} issues.`);
  }
}

export function deactivate(): void {
  store?.dispose();
  store = undefined;
}
