/**
 * Keeping a Velox roadmap and the beads tracker in step.
 *
 * Two directions, both explicit and both previewed before anything is written:
 *
 *   import — roadmap rows with no bead become beads (`bd create`, parented to
 *            the milestone epic when one exists)
 *   export — roadmap checkboxes are flipped to match each bead's status
 *
 * Nothing here runs on activation, on a timer, or as a side effect of another
 * command. The parsing and diffing live in `shared/velox.ts`; this file only
 * does I/O, the QuickPicks, and the diff preview.
 */
import * as vscode from 'vscode';

import { StatusIndex } from '../../shared/model';
import {
  applyFlips,
  parseRoadmap,
  planExport,
  planImport,
  type ExportFlip,
  type ImportItem,
  type Roadmap,
} from '../../shared/velox';
import type { Bead } from '../../shared/types';
import type { BeadsStore } from '../store';
import { toRpcError } from '../store';

/** Where Velox keeps its roadmaps, relative to the workspace folder. */
const ROADMAP_GLOB = '.velox/docs/roadmaps/*.md';

export interface VeloxDeps {
  store: BeadsStore;
  output: vscode.OutputChannel;
  folder: () => vscode.WorkspaceFolder | undefined;
}

interface LoadedRoadmap {
  uri: vscode.Uri;
  text: string;
  roadmap: Roadmap;
}

export class VeloxSync {
  constructor(private readonly deps: VeloxDeps) {}

  /** Roadmap files in the tracked folder, parsed. Empty when Velox is absent. */
  private async load(): Promise<LoadedRoadmap[]> {
    const folder = this.deps.folder();
    if (!folder) return [];

    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, ROADMAP_GLOB),
      '**/node_modules/**',
    );
    found.sort((a, b) => a.path.localeCompare(b.path));

    const loaded: LoadedRoadmap[] = [];
    for (const uri of found) {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(bytes);
      const relative = vscode.workspace.asRelativePath(uri, false);
      const roadmap = parseRoadmap(text, relative);
      // A markdown file under roadmaps/ with no task table is not a roadmap.
      if (roadmap.tasks.length > 0) loaded.push({ uri, text, roadmap });
    }
    return loaded;
  }

  /**
   * Let the user pick which roadmaps to act on. One file is used directly; the
   * "All" entry is offered first because syncing the whole set is the common case.
   */
  private async pick(files: LoadedRoadmap[], title: string): Promise<LoadedRoadmap[] | undefined> {
    if (files.length === 0) {
      vscode.window.showInformationMessage(
        'No Velox roadmap found. Expected task tables in .velox/docs/roadmaps/.',
      );
      return undefined;
    }
    if (files.length === 1) return files;

    const picked = await vscode.window.showQuickPick(
      [
        { label: `$(files) All roadmaps`, description: `${files.length} files`, files },
        ...files.map((file) => ({
          label: file.roadmap.milestone || file.roadmap.file,
          description: `${file.roadmap.tasks.length} tasks`,
          files: [file],
        })),
      ],
      { title, placeHolder: 'Which roadmap?' },
    );
    return picked?.files;
  }

  private async beads(): Promise<{ beads: Bead[]; index: StatusIndex } | undefined> {
    const snapshot =
      this.deps.store.current.snapshot ?? (await this.deps.store.refresh()).snapshot;
    if (!snapshot) {
      vscode.window.showErrorMessage('bd returned no data, so there is nothing to compare against.');
      return undefined;
    }
    return { beads: snapshot.beads, index: new StatusIndex(snapshot.vocabulary.statuses) };
  }

  /**
   * beads → roadmap. Flips `[ ]`/`[~]`/`[x]` to match each bead's status
   * category, after showing exactly which rows would change.
   */
  async exportToRoadmap(): Promise<void> {
    const files = await this.pick(await this.load(), 'Export beads status to roadmap');
    if (!files) return;

    const data = await this.beads();
    if (!data) return;

    const plans = files.map((file) => ({
      file,
      plan: planExport(file.roadmap, data.beads, (bead) => data.index.category(bead.status)),
    }));

    const flips = plans.flatMap((entry) =>
      entry.plan.flips.map((flip) => ({ entry, flip })),
    );
    const unmatched = plans.reduce((sum, entry) => sum + entry.plan.unmatched.length, 0);

    if (flips.length === 0) {
      vscode.window.showInformationMessage(
        `Roadmap already matches beads.${unmatched ? ` ${unmatched} row(s) have no bead.` : ''}`,
      );
      return;
    }

    const chosen = await vscode.window.showQuickPick(
      flips.map(({ entry, flip }) => ({
        label: `${flip.task.id}  ${flip.from} → ${flip.to}`,
        description: describeFlip(flip),
        detail: `${entry.file.roadmap.file} · line ${flip.task.line + 1}`,
        picked: true,
        entry,
        flip,
      })),
      {
        title: `Flip ${flips.length} roadmap row(s)`,
        canPickMany: true,
        placeHolder: 'Untick anything you do not want written.',
      },
    );
    if (!chosen || chosen.length === 0) return;

    const note = `synced from beads ${new Date().toISOString().slice(0, 10)}`;
    let written = 0;

    for (const file of files) {
      const forFile = chosen.filter((item) => item.entry.file === file).map((item) => item.flip);
      if (forFile.length === 0) continue;

      // Re-read rather than trusting the copy loaded a few seconds ago: the
      // agent may have rewritten the roadmap while the QuickPick was open.
      const current = new TextDecoder().decode(await vscode.workspace.fs.readFile(file.uri));
      const next = applyFlips(current, forFile, note);
      if (next === current) {
        this.deps.output.appendLine(
          `velox: ${file.roadmap.file} changed on disk; ${forFile.length} flip(s) skipped`,
        );
        continue;
      }

      await vscode.workspace.fs.writeFile(file.uri, new TextEncoder().encode(next));
      written += forFile.length;
      this.deps.output.appendLine(`velox: flipped ${forFile.length} row(s) in ${file.roadmap.file}`);
    }

    const action = await vscode.window.showInformationMessage(
      `Updated ${written} roadmap row(s).`,
      'Open Roadmap',
    );
    if (action === 'Open Roadmap' && files[0]) {
      await vscode.window.showTextDocument(files[0].uri);
    }
  }

  /**
   * roadmap → beads. Creates one issue per untracked row, linked to the
   * milestone epic when the tracker already has one.
   */
  async importToBeads(): Promise<void> {
    const files = await this.pick(await this.load(), 'Import roadmap tasks into beads');
    if (!files) return;

    const data = await this.beads();
    if (!data) return;

    const plans = files.map((file) => ({ file, plan: planImport(file.roadmap, data.beads) }));
    const creatable = plans.flatMap((entry) =>
      entry.plan.create.map((item) => ({ entry, item })),
    );
    const tracked = plans.reduce((sum, entry) => sum + entry.plan.existing.length, 0);

    if (creatable.length === 0) {
      vscode.window.showInformationMessage(
        `Every roadmap task already has a bead (${tracked} matched).`,
      );
      return;
    }

    const chosen = await vscode.window.showQuickPick(
      creatable.map(({ entry, item }) => ({
        label: item.title,
        description: `P${item.priority} · ${item.labels.join(', ')}`,
        detail: `${entry.file.roadmap.file} · ${item.task.slice ?? item.task.milestone}`,
        picked: true,
        item,
        entry,
      })),
      {
        title: `Create ${creatable.length} bead(s) from the roadmap`,
        canPickMany: true,
        placeHolder: `${tracked} row(s) already tracked. Untick anything you do not want created.`,
      },
    );
    if (!chosen || chosen.length === 0) return;

    const confirm = await vscode.window.showWarningMessage(
      `Create ${chosen.length} issue(s) with bd?`,
      { modal: true, detail: 'This runs `bd create` once per issue. Nothing is pushed or synced.' },
      'Create',
    );
    if (confirm !== 'Create') return;

    const epics = milestoneEpics(data.beads);
    let created = 0;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Importing roadmap tasks' },
      async (progress) => {
        for (const { item } of chosen) {
          progress.report({
            increment: 100 / chosen.length,
            message: item.task.id,
          });
          try {
            const id = await this.deps.store.mutations.create({
              title: item.title,
              description: item.description,
              type: typeFor(item),
              priority: item.priority,
              labels: item.labels,
              parent: epics.get(milestoneCode(item.task.milestone) ?? ''),
              externalRef: `velox:${item.task.id}`,
            });
            created += 1;
            this.deps.output.appendLine(`velox: created ${id} for ${item.task.id}`);
          } catch (error) {
            const rpcError = toRpcError(error);
            this.deps.output.appendLine(`velox: ${item.task.id} failed: ${rpcError.message}`);
          }
        }
      },
    );

    await this.deps.store.refresh();
    const failed = chosen.length - created;
    vscode.window.showInformationMessage(
      failed > 0
        ? `Created ${created} issue(s); ${failed} failed — see the Beads UI log.`
        : `Created ${created} issue(s) from the roadmap.`,
    );
  }

  /** A read-only report: what each side knows that the other does not. */
  async showStatus(): Promise<void> {
    const files = await this.load();
    if (files.length === 0) {
      vscode.window.showInformationMessage('No Velox roadmap found in this workspace.');
      return;
    }
    const data = await this.beads();
    if (!data) return;

    const lines: string[] = ['# Velox ↔ beads sync status', ''];

    for (const file of files) {
      const exported = planExport(file.roadmap, data.beads, (bead) =>
        data.index.category(bead.status),
      );
      const imported = planImport(file.roadmap, data.beads);

      lines.push(
        `## ${file.roadmap.milestone || file.roadmap.file}`,
        '',
        `- file: \`${file.roadmap.file}\``,
        `- tasks in roadmap: ${file.roadmap.tasks.length}`,
        `- tracked in beads: ${imported.existing.length}`,
        `- missing from beads: ${imported.create.length}`,
        `- checkboxes out of date: ${exported.flips.length}`,
        '',
      );

      if (exported.flips.length > 0) {
        lines.push('| Task | Roadmap | beads | Issue |', '|---|---|---|---|');
        for (const flip of exported.flips) {
          lines.push(
            `| ${flip.task.id} | ${flip.from} | ${flip.to} | ${flip.bead.id} — ${flip.bead.status} |`,
          );
        }
        lines.push('');
      }

      if (imported.create.length > 0) {
        lines.push('Missing beads:', '');
        for (const item of imported.create) lines.push(`- ${item.title}`);
        lines.push('');
      }
    }

    const document = await vscode.workspace.openTextDocument({
      content: lines.join('\n'),
      language: 'markdown',
    });
    await vscode.window.showTextDocument(document, { preview: true });
  }
}

function describeFlip(flip: ExportFlip): string {
  return `${flip.bead.id} is ${flip.bead.status}`;
}

/** `M004 — Settings…` → `M004`. */
function milestoneCode(milestone: string): string | undefined {
  const match = /^(M\d{3})/.exec(milestone);
  return match ? match[1] : undefined;
}

/** Milestone code → the epic bead that represents it, when one exists. */
function milestoneEpics(beads: Bead[]): Map<string, string> {
  const epics = new Map<string, string>();
  for (const bead of beads) {
    if (bead.issue_type !== 'epic') continue;
    const code = milestoneCode(bead.title);
    if (code && !epics.has(code)) epics.set(code, bead.id);
  }
  return epics;
}

/**
 * The roadmap's own "Type" column is a UI/API hint, not a beads issue type, so
 * only the values beads actually accepts are passed through.
 */
const BD_TYPES = new Set(['task', 'bug', 'feature', 'epic', 'chore', 'decision']);

function typeFor(item: ImportItem): string {
  const kind = item.task.kind?.toLowerCase();
  return kind && BD_TYPES.has(kind) ? kind : 'task';
}
