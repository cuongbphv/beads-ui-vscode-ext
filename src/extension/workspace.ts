/** Select the workspace whose `bd` commands will read the intended database. */
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { BdContext } from '../shared/types';
import { BdQueries } from './bd/queries';
import { BdService } from './bd/BdService';

const MEMENTO_KEY = 'beadsDashboard.selectedFolder';

export interface BeadsWorkspace {
  folder: vscode.WorkspaceFolder;
  context: BdContext;
}

async function inspect(folder: vscode.WorkspaceFolder): Promise<BeadsWorkspace | undefined> {
  // Use the same executable, cwd and inherited environment as BeadsStore. A
  // worktree can have no local .beads while bd resolves its main worktree's DB.
  const bd = new BdService({
    cwd: folder.uri.fsPath,
    bdPath: vscode.workspace.getConfiguration('beadsDashboard').get<string>('bdPath'),
  });
  try {
    const context = await new BdQueries(bd).context();
    if (!path.isAbsolute(context.beads_dir)) return undefined;
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(context.beads_dir));
    if (stat.type !== vscode.FileType.Directory) return undefined;
    return { folder, context };
  } catch {
    return undefined;
  }
}

export async function findBeadsFolders(): Promise<BeadsWorkspace[]> {
  const checked = await Promise.all((vscode.workspace.workspaceFolders ?? []).map(inspect));
  return checked.filter((candidate): candidate is BeadsWorkspace => candidate !== undefined);
}

/** Remember the selected workspace folder, not the resolved DB path: several
 * worktrees may share a DB while their own cwd remains significant to bd. */
export async function resolveBeadsFolder(
  memento: vscode.Memento,
  askIfAmbiguous: boolean,
): Promise<BeadsWorkspace | undefined> {
  const candidates = await findBeadsFolders();
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const remembered = memento.get<string>(MEMENTO_KEY);
  const match = candidates.find(({ folder }) => folder.uri.toString() === remembered);
  if (match) return match;
  if (!askIfAmbiguous) return candidates[0];

  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.folder.name,
      description: candidate.folder.uri.fsPath,
      detail: `Beads database: ${candidate.context.beads_dir}`,
      candidate,
    })),
    { title: 'Which Beads workspace should be tracked?' },
  );
  if (!picked) return candidates[0];

  await memento.update(MEMENTO_KEY, picked.candidate.folder.uri.toString());
  return picked.candidate;
}

/** The explicit switch command re-probes so newly initialized folders appear. */
export async function pickBeadsFolder(
  memento: vscode.Memento,
  current: BeadsWorkspace | undefined,
): Promise<BeadsWorkspace | undefined> {
  const candidates = await findBeadsFolders();
  if (candidates.length === 0) {
    vscode.window.showWarningMessage(
      'No Beads database resolves from these folders. Check `bd context`, `BEADS_DIR`, or run `bd init`.',
    );
    return undefined;
  }
  if (candidates.length === 1) {
    vscode.window.showInformationMessage(
      `Only one Beads workspace here: ${candidates[0].folder.uri.fsPath} → ${candidates[0].context.beads_dir}`,
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.folder.name,
      description: candidate.folder.uri.fsPath,
      detail: `Database: ${candidate.context.beads_dir}${candidate.folder.uri.toString() === current?.folder.uri.toString() ? ' (currently tracked)' : ''}`,
      candidate,
    })),
    { title: 'Which Beads workspace should be tracked?' },
  );
  if (!picked || picked.candidate.folder.uri.toString() === current?.folder.uri.toString()) return undefined;

  await memento.update(MEMENTO_KEY, picked.candidate.folder.uri.toString());
  return picked.candidate;
}
