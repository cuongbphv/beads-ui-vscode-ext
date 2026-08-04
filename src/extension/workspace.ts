/**
 * Which folder is "the beads workspace".
 *
 * Multi-root is common (a repo plus its docs, a monorepo of services), and only
 * some folders have a `.beads` directory. We detect by looking for the
 * directory, never by reading anything inside it.
 */
import * as vscode from 'vscode';

const MEMENTO_KEY = 'beadsDashboard.selectedFolder';

async function hasBeadsDir(folder: vscode.WorkspaceFolder): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, '.beads'));
    return stat.type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

export async function findBeadsFolders(): Promise<vscode.WorkspaceFolder[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const checked = await Promise.all(
    folders.map(async (folder) => ((await hasBeadsDir(folder)) ? folder : undefined)),
  );
  return checked.filter((folder): folder is vscode.WorkspaceFolder => folder !== undefined);
}

/**
 * Resolve the folder to track. With several candidates we remember the user's
 * choice for the workspace rather than asking on every window reload.
 */
export async function resolveBeadsFolder(
  memento: vscode.Memento,
  askIfAmbiguous: boolean,
): Promise<vscode.WorkspaceFolder | undefined> {
  const candidates = await findBeadsFolders();
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const remembered = memento.get<string>(MEMENTO_KEY);
  const match = candidates.find((folder) => folder.uri.toString() === remembered);
  if (match) return match;

  if (!askIfAmbiguous) return candidates[0];

  const picked = await vscode.window.showQuickPick(
    candidates.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { title: 'Which folder holds the beads database?' },
  );
  if (!picked) return candidates[0];

  await memento.update(MEMENTO_KEY, picked.folder.uri.toString());
  return picked.folder;
}

/**
 * The explicit "switch folder" command (T403).
 *
 * Always asks, even when a choice was remembered, and reports what the
 * workspace actually offers — a single-candidate workspace has nothing to pick
 * and saying so is more useful than a one-item QuickPick.
 */
export async function pickBeadsFolder(
  memento: vscode.Memento,
  current: vscode.WorkspaceFolder | undefined,
): Promise<vscode.WorkspaceFolder | undefined> {
  const candidates = await findBeadsFolders();

  if (candidates.length === 0) {
    vscode.window.showWarningMessage(
      'No folder in this workspace has a .beads directory. Run `bd init` where you want the tracker.',
    );
    return undefined;
  }
  if (candidates.length === 1) {
    vscode.window.showInformationMessage(
      `Only one beads folder here: ${candidates[0].uri.fsPath}`,
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      detail: folder.uri.toString() === current?.uri.toString() ? 'currently tracked' : undefined,
      folder,
    })),
    { title: 'Which folder holds the beads database?' },
  );
  if (!picked || picked.folder.uri.toString() === current?.uri.toString()) return undefined;

  await memento.update(MEMENTO_KEY, picked.folder.uri.toString());
  return picked.folder;
}
