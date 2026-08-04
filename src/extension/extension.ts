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
import { ActorResolver } from './actor';
import { registerCommands } from './commands';
import { DashboardPanel } from './panel/DashboardPanel';
import { BeadsStore, bindVisibility } from './store';
import { BeadsTreeProvider } from './tree/BeadsTreeProvider';
import { VeloxSync } from './velox/VeloxSync';
import { pickBeadsFolder, resolveBeadsFolder } from './workspace';

let store: BeadsStore | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Beads Dashboard');
  context.subscriptions.push(output);

  const folder = await resolveBeadsFolder(context.workspaceState, false);
  if (!folder) {
    // The tree's viewsWelcome explains what to do; the command still opens so
    // the user gets a real message rather than "command not found".
    await vscode.commands.executeCommand('setContext', 'beadsDashboard.hasWorkspace', false);
    context.subscriptions.push(
      vscode.commands.registerCommand('beadsDashboard.openDashboard', () =>
        vscode.window.showWarningMessage(
          'No .beads directory found in this workspace. Run `bd init` in a terminal first.',
        ),
      ),
      vscode.commands.registerCommand('beadsDashboard.showOutput', () => output.show(true)),
    );
    output.appendLine('No workspace folder contains a .beads directory — staying idle.');
    return;
  }

  output.appendLine(`Beads workspace: ${folder.uri.fsPath}`);
  await vscode.commands.executeCommand('setContext', 'beadsDashboard.hasWorkspace', true);

  store = new BeadsStore(folder, output);
  context.subscriptions.push(store);

  const actor = new ActorResolver(folder.uri.fsPath);
  const tree = new BeadsTreeProvider(store, actor, 'plan');
  const mineTree = new BeadsTreeProvider(store, actor, 'mine');
  context.subscriptions.push(
    actor,
    tree,
    mineTree,
    actor.onDidChange(() => {
      tree.refresh();
      mineTree.refresh();
    }),
  );
  // Fire-and-forget: the identity probe shells out to git, and the tree is
  // useful before it lands.
  void actor.resolve();

  // "Needs You" is declared first in package.json, so it sits on top.
  const mineView = vscode.window.createTreeView('beadsDashboard.needsYou', {
    treeDataProvider: mineTree,
  });
  const treeView = vscode.window.createTreeView('beadsDashboard.tree', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(mineView, treeView);

  // Live refresh is paid for by whoever is looking: each view holds the store's
  // poll gate open only while it is actually on screen.
  for (const view of [mineView, treeView]) {
    context.subscriptions.push(
      bindVisibility(store, {
        get visible() {
          return view.visible;
        },
        onDidChange: (listener) => view.onDidChangeVisibility(() => listener()),
      }),
    );
  }

  const openDashboard = (id?: string): void => {
    const defaultTab = vscode.workspace
      .getConfiguration('beadsDashboard')
      .get<DashboardTab>('defaultTab', 'overview');

    const panel = DashboardPanel.show(context, store!, { revealBead }, defaultTab);
    if (id) panel.focus(id);
  };

  /**
   * Selecting an issue in the webview highlights it in the sidebar too. The plan
   * view is exhaustive, so it is tried first; "Needs You" only ever holds a
   * subset, and revealing there would scroll a view the issue may not be in.
   */
  const revealBead = (id: string): void => {
    const planNode = tree.nodeFor(id);
    if (planNode) {
      void treeView.reveal(planNode, { select: true, focus: false, expand: true });
      return;
    }
    const mineNode = mineTree.nodeFor(id);
    if (mineNode) void mineView.reveal(mineNode, { select: true, focus: false, expand: true });
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
      await vscode.commands.executeCommand('workbench.action.openSettings', 'beadsDashboard.bdPath');
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
