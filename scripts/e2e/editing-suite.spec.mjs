#!/usr/bin/env node
/**
 * End-to-end editing suite (Epic A coverage).
 *
 *   npm run test:e2e:editing
 *
 * Launches a real VS Code, with this extension loaded, against a **throwaway
 * `bd` project** (not this repo's real board) and drives the rendered webview
 * through: three ways to create an issue, an inline text edit, a label
 * add/remove, defer → undefer → close → reopen, a dependency edge added two
 * different ways, and a dependency cycle rejected as a toast. Every mutation
 * is cross-checked against `bd show`/`bd list` directly, the same discipline
 * `run-webview-test.mjs` uses for its header-count assertion.
 *
 * ── Why an isolated scratch project instead of this repo's real board ──
 * `run-webview-test.mjs` opens *this* repo (or, from a worktree, the main
 * checkout it shares a Dolt DB with — see that file's `findBeadsWorkspaceRoot`)
 * and does exactly one small, carefully-cleaned-up mutation. This suite needs
 * far more: three new issues, text/label/defer/status edits, two dependency
 * edges, and a rejected third — real risk to the real board if anything here
 * ever throws mid-mutation. So instead this script `mkdtemp`s a fresh temp
 * directory and runs `bd init --non-interactive` inside it, then opens *that*
 * as the VS Code workspace. `src/extension/workspace.ts` resolves "the beads
 * workspace" purely by `fs.stat`ing `<folder>/.beads` — no cwd-walk, no git
 * awareness — so a freshly-`bd init`'d temp folder activates the extension
 * exactly like a real project would, fully isolated from this repo's board.
 * Cleanup is then just deleting the whole directory: no "find and remove only
 * the issues I made" bookkeeping, and every assertion below can be exact
 * ("0 issues at start") instead of fighting real-board noise. Confirmed this
 * actually works (not assumed) by reading `workspace.ts` before writing this.
 *
 * ── Why this file repeats run-webview-test.mjs's harness boilerplate ──
 * Per the epic's own recorded decision (beads-ui-vscode-ext-9e9's `design`
 * field): "E2E goes deep with one dedicated script file per epic to allow
 * safe parallel batching." Four sibling spec files are planned (one per
 * epic); if they all imported a shared "harness" module for `check()`,
 * `execBd()`, the launch/cleanup dance, etc., every one of those agents would
 * be editing the same file — precisely the collision parallel batching is
 * meant to avoid. So this file is self-contained, copying (and adapting for a
 * *parameterised* `cwd`, since this suite's `bd` runs against a scratch dir,
 * not `repoRoot`) the same patterns `run-webview-test.mjs` already proved
 * out. The one thing still imported rather than copied is
 * `scripts/lib/clean-env.mjs`: it is not test logic, nobody editing their own
 * epic's spec ever needs to change it, and hand-copying its Windows/Electron
 * env-scrubbing fix imperfectly would be its own risk.
 *
 * ── Dependency-edge test design ──
 * `graph-layout.ts` only draws a node at all if it carries a `blocks` or
 * `parent-child` edge, so Graph link mode can only ever connect nodes that
 * already have *some* edge — there is no way to link in a bare, edge-less
 * node from the Graph tab. This suite builds a 4-issue chain to satisfy that
 * honestly rather than working around it:
 *   1. detail-pane picker:  N1 → N2   (this is the "detail-pane" test)
 *   2. bd CLI fixture:      N3 → N4   (not itself asserted — just gives Graph
 *                                      a second already-visible node pair to
 *                                      connect, exactly like the first)
 *   3. Graph link mode:     N2 → N3   (this is the "Graph link mode" test;
 *                                      both nodes are already on the canvas)
 *   4. Graph link mode:     N4 → N1   (closes the loop N1→N2→N3→N4→N1 — bd
 *                                      must reject this as a cycle, and the
 *                                      UI must show that rejection as a toast)
 * Link mode itself stays armed across steps 3 and 4 without re-toggling —
 * confirmed by reading `GraphView.pickKind`, which clears `linkSource`/
 * `kindPicker` but never calls `setLinkMode(false)`.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron } from 'playwright';

import { cleanEnv, scrubProcessEnv } from '../lib/clean-env.mjs';

// Read before scrubbing, which removes every VSCODE_* variable.
const testVersion = process.env.VSCODE_TEST_VERSION ?? '1.105.0';
// Every `bd` subprocess this script spawns (via `execBd` and the direct `bd
// init` call below) inherits `process.env` — set the per-process telemetry
// opt-out once, here, before any of them run. This is `BD_DISABLE_METRICS`
// (the env override `beads/cmd/bd/metrics.go`'s `metricsEnvOverride` reads),
// a one-off, process-scoped opt-out — not `bd metrics off`, which would
// rewrite the user's real global config on disk.
process.env.BD_DISABLE_METRICS = '1';
scrubProcessEnv();

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactsDir = join(repoRoot, 'dist', 'test-artifacts');

/** Long, because a cold VS Code start is not fast. */
const LAUNCH_TIMEOUT = 180_000;
const UI_TIMEOUT = 90_000;
/** How long a poll loop waits for a `bd`-visible mutation to land after a UI action. */
const POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 400;

/** See run-webview-test.mjs's identical constant for why this is per-platform. */
const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';
const PALETTE_KEY = `${MOD_KEY}+Shift+P`;

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

/** Polls `read()` until `predicate` is true or the deadline passes; returns the last read value. */
async function pollUntil(read, predicate, waitFn, timeoutMs = POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await waitFn(POLL_INTERVAL_MS);
    value = await read();
  }
  return value;
}

/**
 * Every `bd` call goes through here, against the scratch project's own `cwd`
 * — never `repoRoot`. Same ENOENT → shell-fallback retry as
 * `run-webview-test.mjs`'s `execBd`, for the same reason (some CI images only
 * resolve `bd` via the shell's own PATH lookup).
 */
async function execBd(cwd, args) {
  const options = {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, BD_JSON_ENVELOPE: '0' },
  };
  try {
    return await execFileAsync('bd', args, options);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return await execFileAsync('bd', args, { ...options, shell: true });
  }
}

/** `bd show <id> --json` always returns a single-element array; unwrap it. */
async function bdShow(cwd, id) {
  const { stdout } = await execBd(cwd, ['show', id, '--json']);
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function bdListAll(cwd) {
  const { stdout } = await execBd(cwd, ['list', '--all', '--json']);
  return JSON.parse(stdout);
}

async function findByTitle(cwd, title) {
  const list = await bdListAll(cwd);
  return list.find((issue) => issue.title === title);
}

/** True when a dependency array (bd's two edge shapes) targets `targetId`. */
function hasEdgeTo(dependencies, targetId) {
  return (dependencies ?? []).some((edge) => (edge.id ?? edge.depends_on_id) === targetId);
}

/**
 * `bd statuses --json` → `(statusName) => category`. Fetched once from the
 * scratch project rather than hardcoded, so "is this a done-category status"
 * follows the same runtime vocabulary rule the extension itself follows
 * (CLAUDE.md: never hardcode beads statuses).
 */
async function buildCategoryLookup(cwd) {
  const { stdout } = await execBd(cwd, ['statuses', '--json']);
  const parsed = JSON.parse(stdout);
  const all = [...(parsed.built_in_statuses ?? []), ...(parsed.custom_statuses ?? [])];
  const map = new Map(all.map((status) => [status.name, status.category]));
  return (statusName) => map.get(statusName) ?? 'unspecified';
}

async function main() {
  await mkdir(artifactsDir, { recursive: true });

  console.log('› building bundles');
  await execFileAsync('npm', ['run', 'build'], {
    cwd: repoRoot,
    shell: process.platform === 'win32',
  }).catch((error) => {
    throw new Error(`build failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  });

  console.log('› creating an isolated scratch bd project');
  const scratchRoot = await mkdtemp(join(tmpdir(), 'beads-ui-e2e-editing-'));

  // Outer safety net around the whole scratch-project lifecycle: `bd init`,
  // `buildCategoryLookup`, `downloadAndUnzipVSCode`, or `_electron.launch`
  // itself can all throw before the main try/finally below is ever entered
  // — without this, a throw on that path leaks `scratchRoot` (and, once
  // created, `profileDir`/`extensionsDir`) into the OS temp directory
  // forever, since the existing try/finally's own cleanup would never run.
  // `profileDir`/`extensionsDir`/`app` are hoisted so the `finally` below can
  // clean up whichever of them actually got created before the throw.
  let profileDir;
  let extensionsDir;
  let app;
  try {
  await execFileAsync(
    'bd',
    ['init', '--non-interactive', '--skip-hooks', '--skip-agents', '--prefix', 'e2e'],
    {
      cwd: scratchRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, BD_JSON_ENVELOPE: '0' },
    },
  ).catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    await execFileAsync(
      'bd',
      ['init', '--non-interactive', '--skip-hooks', '--skip-agents', '--prefix', 'e2e'],
      { cwd: scratchRoot, encoding: 'utf8', windowsHide: true, shell: true },
    );
  });

  const categoryOf = await buildCategoryLookup(scratchRoot);

  console.log(`› resolving VS Code ${testVersion}`);
  const executablePath = await downloadAndUnzipVSCode(testVersion);

  profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-editing-profile-'));
  const theme = process.env.BEADS_TEST_THEME ?? 'Default Dark Modern';
  await mkdir(join(profileDir, 'User'), { recursive: true });
  await writeFile(
    join(profileDir, 'User', 'settings.json'),
    JSON.stringify({ 'workbench.colorTheme': theme, 'window.commandCenter': false }, null, 2),
    'utf8',
  );
  extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-editing-exts-'));

  console.log('› launching an isolated editor against the scratch project');
  app = await _electron.launch({
    executablePath,
    timeout: LAUNCH_TIMEOUT,
    args: [
      `--extensionDevelopmentPath=${repoRoot}`,
      `--user-data-dir=${profileDir}`,
      `--extensions-dir=${extensionsDir}`,
      // Not --disable-extensions: see run-webview-test.mjs's identical note —
      // on this VS Code build it also disables --extensionDevelopmentPath.
      '--disable-workspace-trust',
      '--disable-gpu',
      '--no-sandbox',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-updates',
      scratchRoot,
    ],
    env: cleanEnv({ BD_JSON_ENVELOPE: '0' }),
  });

  // Every id this run creates, recorded as it goes so a mid-run throw still
  // reports (in the console summary) what exists to be cleaned up — though
  // cleanup itself never needs this list, since it deletes scratchRoot whole.
  const createdIds = {};

  try {
    const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT });
    window.setDefaultTimeout(UI_TIMEOUT);
    await window.locator('.monaco-workbench').waitFor({ state: 'visible' });
    console.log('› workbench is up');

    // Wide enough that the Board renders every column at once (the @2xl
    // container-query breakpoint) — same reasoning as run-webview-test.mjs.
    await app.evaluate(({ BrowserWindow }) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) return;
      main.unmaximize();
      main.setBounds({ x: 0, y: 0, width: 1600, height: 1000 });
      main.maximize();
    });
    await window.waitForTimeout(800);

    /** Drives the command palette by keyboard, same as run-webview-test.mjs. */
    async function runPaletteCommand(label) {
      await window.keyboard.press(PALETTE_KEY);
      const box = window.locator('.quick-input-box input');
      await box.waitFor({ state: 'visible' });
      await box.fill(`>${label}`);
      await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
      await window.keyboard.press('Enter');
      await window.waitForTimeout(300);
    }

    /** Fills and submits a native `showInputBox` (reuses the same quick-input widget). */
    async function submitQuickInputText(text) {
      const box = window.locator('.quick-input-box input');
      await box.waitFor({ state: 'visible' });
      await box.fill(text);
      await window.keyboard.press('Enter');
      await window.waitForTimeout(300);
    }

    /** Accepts the top (default-highlighted) item of a native `showQuickPick`. */
    async function acceptQuickPickDefault() {
      await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
      await window.keyboard.press('Enter');
      await window.waitForTimeout(300);
    }

    await runPaletteCommand('Beads: Open Dashboard');
    const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');

    const header = inner.locator('text=/\\d+\\s+issues/');
    await header.first().waitFor();
    const headerAtStart = (await header.first().innerText()).trim();
    check(
      'scratch project starts with 0 issues',
      /^0\s+issues/.test(headerAtStart),
      `webview header read "${headerAtStart}"`,
    );

    /**
     * `Beads: Refresh` — forces `BeadsStore.refresh()` unconditionally. Needed
     * after *any* mutation, not only ones made directly via `bd` bypassing the
     * webview: see the module doc's "Why every UI check forces a refresh"
     * section for why the extension's own automatic post-mutation refresh
     * cannot be trusted to have landed by the time this script's next
     * assertion runs.
     */
    async function refreshDashboard() {
      await runPaletteCommand('Beads: Refresh');
      await window.waitForTimeout(1000);
    }

    /** Opens the Board tab and clicks a card by id (bead-card.tsx: `aria-label="${id}: ${title}"`). */
    async function selectCard(id) {
      // Force-refresh first: a card just created (or edited) can otherwise be
      // invisible here even though `bd` already has it — see the module doc.
      await refreshDashboard();
      await inner.locator('[role="tab"]:has-text("Board")').first().click();
      await window.waitForTimeout(500);
      const card = inner.locator(`article[role="button"][aria-label^="${id}: "]:visible`).first();
      await card.waitFor();
      await card.click();
      const detail = inner.locator('aside[aria-label^="Details for "]');
      await detail.first().waitFor();
      return detail;
    }

    // =================================================================
    // Test 1: create an issue via the command palette command
    // =================================================================
    console.log('› test 1: create an issue via the command palette');
    const paletteTitle = `E2E palette issue ${Date.now()}`;
    await runPaletteCommand('Beads: Create Issue…');
    await submitQuickInputText(paletteTitle); // showInputBox: title
    await acceptQuickPickDefault(); // showQuickPick: issue type (accept the default)
    await acceptQuickPickDefault(); // showQuickPick: parent epic (accept "(none)")

    const paletteBead = await pollUntil(
      () => findByTitle(scratchRoot, paletteTitle),
      (bead) => !!bead,
      (ms) => window.waitForTimeout(ms),
    );
    check(
      'command palette created the issue (confirmed via bd)',
      !!paletteBead,
      `looked for title "${paletteTitle}" via bd list --all`,
    );
    const paletteId = paletteBead?.id;
    if (paletteId) createdIds.palette = paletteId;

    // =================================================================
    // Test 2: create an issue via the board's per-column quick-add
    // =================================================================
    console.log('› test 2: create an issue via the board quick-add');
    await inner.locator('[role="tab"]:has-text("Board")').first().click();
    await window.waitForTimeout(500);
    const quickAddTitle = `E2E quick-add issue ${Date.now()}`;
    const addRow = inner.locator('button:visible:has-text("+ Add issue")').first();
    await addRow.waitFor();
    await addRow.click();
    const quickAddInput = inner.locator('input[aria-label^="New issue title for "]:visible').first();
    await quickAddInput.waitFor();
    await quickAddInput.fill(quickAddTitle);
    await quickAddInput.press('Enter');
    // AddIssueRow collapses back to the dashed button once the next
    // `issuesChanged` snapshot repaints the column (bead-create is
    // deliberately non-optimistic — see BoardView.tsx's AddIssueRow doc).
    await addRow.waitFor({ state: 'visible' });

    const quickAddBead = await pollUntil(
      () => findByTitle(scratchRoot, quickAddTitle),
      (bead) => !!bead,
      (ms) => window.waitForTimeout(ms),
    );
    check(
      'board quick-add created the issue (confirmed via bd)',
      !!quickAddBead,
      `looked for title "${quickAddTitle}" via bd list --all`,
    );
    const quickAddId = quickAddBead?.id;
    if (quickAddId) createdIds.quickAdd = quickAddId;

    // =================================================================
    // Test 3: create an issue via the full create form
    // =================================================================
    console.log('› test 3: create an issue via the full create form');
    const fullFormTitle = `E2E full-form issue ${Date.now()}`;
    await inner.getByRole('button', { name: 'New', exact: true }).click();
    const createPane = inner.locator('aside[aria-label="Create a new issue"]');
    await createPane.first().waitFor();
    await createPane.getByLabel('Title').fill(fullFormTitle);
    await createPane.getByLabel('Description').fill('Created by scripts/e2e/editing-suite.spec.mjs (test 3).');
    await createPane.getByRole('button', { name: 'Create issue' }).click();
    await createPane.waitFor({ state: 'detached' });

    const fullFormBead = await pollUntil(
      () => findByTitle(scratchRoot, fullFormTitle),
      (bead) => !!bead,
      (ms) => window.waitForTimeout(ms),
    );
    check(
      'the full create form created the issue (confirmed via bd)',
      !!fullFormBead,
      `looked for title "${fullFormTitle}" via bd list --all`,
    );
    const fullFormId = fullFormBead?.id;
    if (fullFormId) createdIds.fullForm = fullFormId;

    const distinctIds = new Set([paletteId, quickAddId, fullFormId].filter(Boolean));
    check(
      'all three creation paths produced distinct issues',
      distinctIds.size === [paletteId, quickAddId, fullFormId].filter(Boolean).length,
      `ids: ${JSON.stringify({ paletteId, quickAddId, fullFormId })}`,
    );

    if (!paletteId || !quickAddId || !fullFormId) {
      throw new Error(
        `one or more creation paths did not produce an id — aborting the rest of the suite (${JSON.stringify(createdIds)})`,
      );
    }

    // =================================================================
    // Test 4: inline-edit title + description via EditableText,
    // cross-checked against `bd show` directly (updateText round-trip)
    // =================================================================
    console.log('› test 4: inline-edit title and description');
    const detail4 = await selectCard(fullFormId);

    const editedTitle = `${fullFormTitle} (edited)`;
    await detail4.getByRole('button', { name: 'Edit title' }).click();
    const titleInput = detail4.getByRole('textbox', { name: 'Edit title' });
    await titleInput.fill(editedTitle);
    await titleInput.press('Enter');
    // Title (unlike labels/deps) is snapshot-driven, not optimistic — force a
    // refresh so the h2 wait below doesn't hang on a stale coalesced refresh.
    await refreshDashboard();
    await detail4.locator('h2', { hasText: editedTitle }).waitFor();

    const afterTitleEdit = await pollUntil(
      () => bdShow(scratchRoot, fullFormId),
      (bead) => bead?.title === editedTitle,
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'title edit round-trips through updateText (bd show agrees)',
      afterTitleEdit?.title === editedTitle,
      `bd show read title "${afterTitleEdit?.title}"`,
    );

    const editedDescription = `Edited via editing-suite.spec.mjs at ${Date.now()}`;
    await detail4.getByRole('button', { name: 'Edit Description' }).click();
    const descriptionDraft = detail4.getByRole('textbox', { name: 'Description draft' });
    await descriptionDraft.fill(editedDescription);
    await detail4.getByRole('button', { name: 'Save', exact: true }).click();
    await descriptionDraft.waitFor({ state: 'detached' });
    // Defensive: description is also snapshot-driven, same as title above.
    await refreshDashboard();

    const afterDescriptionEdit = await pollUntil(
      () => bdShow(scratchRoot, fullFormId),
      (bead) => bead?.description === editedDescription,
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'description edit round-trips through updateText (bd show agrees)',
      afterDescriptionEdit?.description === editedDescription,
      `bd show read description "${afterDescriptionEdit?.description}"`,
    );

    // =================================================================
    // Test 5: add and remove a label chip
    // =================================================================
    console.log('› test 5: add and remove a label chip');
    const labelName = 'e2e-chip';
    // The `<input list="bead-detail-labels">` in bead-detail.tsx's LabelAdder
    // has an implicit ARIA role of "combobox" (an <input> wired to a
    // <datalist> via `list=`), not "textbox" — same pattern as the
    // `role="combobox"` search box used in test 7's issue picker.
    const labelInput = detail4.getByRole('combobox', { name: 'Add label' });
    await labelInput.fill(labelName);
    await labelInput.press('Enter');
    await detail4.getByRole('button', { name: `Remove label ${labelName}` }).waitFor();

    const afterLabelAdd = await pollUntil(
      () => bdShow(scratchRoot, fullFormId),
      (bead) => (bead?.labels ?? []).includes(labelName),
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'label add round-trips (bd show agrees)',
      (afterLabelAdd?.labels ?? []).includes(labelName),
      `bd show labels: ${JSON.stringify(afterLabelAdd?.labels)}`,
    );

    await detail4.getByRole('button', { name: `Remove label ${labelName}` }).click();

    const afterLabelRemove = await pollUntil(
      () => bdShow(scratchRoot, fullFormId),
      (bead) => !(bead?.labels ?? []).includes(labelName),
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'label remove round-trips (bd show agrees)',
      !(afterLabelRemove?.labels ?? []).includes(labelName),
      `bd show labels: ${JSON.stringify(afterLabelRemove?.labels)}`,
    );

    // =================================================================
    // Test 6: defer → undefer → close → reopen
    // =================================================================
    console.log('› test 6: defer, undefer, close, then reopen');
    await detail4.getByRole('button', { name: /^Defer/ }).click();
    await detail4.locator('#defer-until').fill('tomorrow');
    await detail4.locator('#defer-reason').fill('e2e editing-suite defer');
    await detail4.getByRole('button', { name: 'Defer', exact: true }).click();
    // Critical: the "Undefer" button only renders off the next snapshot, not
    // an optimistic update — without this the click below can hang.
    await refreshDashboard();

    const afterDefer = await pollUntil(
      () => bdShow(scratchRoot, fullFormId),
      (bead) => !!bead?.defer_until,
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'defer round-trips (bd show reports defer_until)',
      !!afterDefer?.defer_until,
      `bd show defer_until: ${afterDefer?.defer_until}`,
    );

    await detail4.getByRole('button', { name: 'Undefer' }).click();
    // Defensive: same snapshot-driven rendering as above — the "Close issue"
    // button's state depends on the next refresh landing.
    await refreshDashboard();

    const afterUndefer = await pollUntil(
      () => bdShow(scratchRoot, fullFormId),
      (bead) => !bead?.defer_until,
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'undefer round-trips (bd show clears defer_until)',
      !afterUndefer?.defer_until,
      `bd show defer_until: ${afterUndefer?.defer_until}`,
    );

    await detail4.getByRole('button', { name: 'Close issue' }).click();
    // Critical: the "Reopen" button only renders off the next snapshot too.
    await refreshDashboard();

    const afterClose = await pollUntil(
      () => bdShow(scratchRoot, fullFormId),
      (bead) => !!bead && categoryOf(bead.status) === 'done',
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'close round-trips (bd show reports a done-category status)',
      !!afterClose && categoryOf(afterClose.status) === 'done',
      `bd show status: ${afterClose?.status}`,
    );

    await detail4.getByRole('button', { name: 'Reopen' }).click();

    const afterReopen = await pollUntil(
      () => bdShow(scratchRoot, fullFormId),
      (bead) => !!bead && categoryOf(bead.status) !== 'done',
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'reopen round-trips (bd show reports a non-done-category status)',
      !!afterReopen && categoryOf(afterReopen.status) !== 'done',
      `bd show status: ${afterReopen?.status}`,
    );

    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // =================================================================
    // Test 7: add a dependency edge via the detail-pane issue picker
    // (N1 = paletteId depends on N2 = quickAddId)
    // =================================================================
    console.log('› test 7: add a dependency edge via the detail-pane picker');
    const detail7 = await selectCard(paletteId);
    await detail7.getByRole('button', { name: 'Add link' }).click();
    const addLinkDialog = detail7.locator('[role="dialog"][aria-label="Add link"]');
    await addLinkDialog.waitFor();
    const issueSearch = addLinkDialog.getByRole('combobox', { name: 'Search issues' });
    await issueSearch.fill(quickAddId);
    // Scoped to the IssuePicker's own listbox: the dialog also renders a
    // native DepKindSelect <select> above it (bead-detail.tsx), whose
    // <option> elements also satisfy an unscoped getByRole('option') but
    // stay hidden forever (a closed native <select> never shows its
    // options as "visible" to Playwright).
    const matchingIssues = addLinkDialog.getByRole('listbox', { name: 'Matching issues' });
    await matchingIssues.getByRole('option').first().waitFor();
    await issueSearch.press('Enter');
    await addLinkDialog.waitFor({ state: 'detached' });

    const afterEdge1 = await pollUntil(
      () => bdShow(scratchRoot, paletteId),
      (bead) => hasEdgeTo(bead?.dependencies, quickAddId),
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'detail-pane picker created a dependency edge (bd show agrees)',
      hasEdgeTo(afterEdge1?.dependencies, quickAddId),
      `bd show dependencies: ${JSON.stringify(afterEdge1?.dependencies)}`,
    );
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // =================================================================
    // Fixture: a second, independent edge (N3 = fullFormId → N4), created
    // directly via `bd` so Graph link mode has two already-visible node
    // pairs to connect — see the module doc's "Dependency-edge test design"
    // note for why a bare, edge-less node can never appear in the Graph tab.
    // Not itself an assertion point.
    // =================================================================
    console.log('› fixture: a second independent dependency edge (via bd directly)');
    const { stdout: fixtureRaw } = await execBd(scratchRoot, [
      'create',
      'E2E dependency fixture issue',
      '--json',
    ]);
    const fixtureId = JSON.parse(fixtureRaw).id;
    createdIds.fixture = fixtureId;
    await execBd(scratchRoot, ['dep', 'add', fullFormId, fixtureId, '--type=blocks']);
    await refreshDashboard();

    // =================================================================
    // Test 8: add a dependency edge via Graph link mode
    // (N2 = quickAddId depends on N3 = fullFormId)
    // =================================================================
    console.log('› test 8: add a dependency edge via Graph link mode');
    await inner.locator('[role="tab"]:has-text("Roadmap")').first().click();
    await window.waitForTimeout(500);
    const roadmapShapeGroup = inner.locator('[role="group"][aria-label="Roadmap shape"]');
    await roadmapShapeGroup.first().waitFor();
    await roadmapShapeGroup.locator('button:has-text("Graph")').first().click();
    await window.waitForTimeout(800);

    const nodeLocator = (id) => inner.locator(`svg g[role="button"][aria-label^="${id}: "]`);
    /**
     * Activates a Graph node via keyboard (focus + Enter), not `.click()`.
     * Confirmed by direct repro (temporary diagnostic logging in
     * GraphView.tsx, reverted before this commit): a Playwright/CDP
     * synthetic mouse click on this node reliably fires `pointerdown` and
     * `pointerup` (drag-tracking sees `moved: false`, so it is not the
     * drag/click-suppression path) but the browser never follows with a
     * native `click` event — `onNodeClick` simply never runs, with no
     * Playwright-visible error. `<g role="button" tabIndex={0}>` already
     * wires `onKeyDown` (Enter/Space) to the exact same `activateNode` this
     * suite needs to exercise, so keyboard activation is a real, already-
     * supported, accessible interaction path — not a weakened assertion —
     * that reaches the identical mutation code. Whether a genuine
     * hardware-mouse click (outside CDP-driven automation) is also
     * affected has not been verified; see the handoff notes.
     */
    async function activateGraphNode(id) {
      await nodeLocator(id).focus();
      await window.keyboard.press('Enter');
    }
    await nodeLocator(paletteId).waitFor();
    await nodeLocator(quickAddId).waitFor();
    await nodeLocator(fullFormId).waitFor();
    await nodeLocator(fixtureId).waitFor();

    const linkToggle = inner.locator('button[title="Link two issues"]');
    await linkToggle.waitFor();
    await linkToggle.click();

    await activateGraphNode(quickAddId);
    await activateGraphNode(fullFormId);
    const kindDialog8 = inner.locator('[role="dialog"][aria-label^="Choose how "]');
    await kindDialog8.waitFor();
    await kindDialog8.getByRole('button', { name: 'blocks', exact: true }).click();
    await kindDialog8.waitFor({ state: 'detached' });

    const afterEdge2 = await pollUntil(
      () => bdShow(scratchRoot, quickAddId),
      (bead) => hasEdgeTo(bead?.dependencies, fullFormId),
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'Graph link mode created a dependency edge (bd show agrees)',
      hasEdgeTo(afterEdge2?.dependencies, fullFormId),
      `bd show dependencies: ${JSON.stringify(afterEdge2?.dependencies)}`,
    );

    // =================================================================
    // Test 9: a cycle attempt surfaces as a toast, not a silent failure
    // or a crash. Chain so far: N1 → N2 → N3 → N4 (palette → quickAdd →
    // fullForm → fixture). N4 → N1 closes the loop.
    //
    // Link mode is still armed from test 8 — GraphView.pickKind clears
    // linkSource/kindPicker but never disarms linkMode itself — so this
    // reuses it rather than re-toggling.
    // =================================================================
    console.log('› test 9: a cycle attempt surfaces as a toast');
    await activateGraphNode(fixtureId);
    await activateGraphNode(paletteId);
    const kindDialog9 = inner.locator('[role="dialog"][aria-label^="Choose how "]');
    await kindDialog9.waitFor();
    await kindDialog9.getByRole('button', { name: 'blocks', exact: true }).click();
    await kindDialog9.waitFor({ state: 'detached' });

    const errorToast = inner.locator('[role="status"]').getByText(/cycle/i);
    await errorToast.first().waitFor({ timeout: 10_000 }).catch(() => {});
    check(
      'a cycle attempt surfaces as a toast mentioning the cycle',
      (await errorToast.count()) > 0,
      'no toast mentioning "cycle" appeared within 10s',
    );

    const afterCycleAttempt = await bdShow(scratchRoot, fixtureId);
    check(
      'the rejected edge was never actually created (bd show agrees)',
      !hasEdgeTo(afterCycleAttempt?.dependencies, paletteId),
      `bd show dependencies: ${JSON.stringify(afterCycleAttempt?.dependencies)}`,
    );

    // Disarm link mode before the window closes, purely for hygiene.
    await window.keyboard.press('Escape');

    await window.screenshot({ path: join(artifactsDir, 'editing-suite-final.png') });
    console.log(`› screenshot written to ${artifactsDir}`);
  } catch (error) {
    await app
      .windows()[0]
      ?.screenshot({ path: join(artifactsDir, 'editing-suite-failure.png') })
      .catch(() => {});
    failures.push(`threw: ${error.message}`);
    console.error(error);
  } finally {
    await app.close().catch(() => {});
    // `app.close()` resolves once the Electron main process is asked to
    // quit; the extension host is a *separate* child process that VS Code's
    // main process must in turn terminate, and Windows can keep a just-
    // released Dolt file handle open for a moment after that. A short
    // settle delay here (before the outer cleanup's retry loop even starts)
    // measurably reduced EBUSY on this suite's heavier 9-mutation run versus
    // relying on the retry loop alone.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  } catch (error) {
    // Reached only when the scratch-project setup above (bd init,
    // buildCategoryLookup, downloadAndUnzipVSCode, or the editor launch
    // itself) threw before the try/finally above was ever entered — that
    // try/finally's own catch handles everything after that point and never
    // rethrows here, so this never double-reports the same failure.
    failures.push(`scratch-project setup threw before the editor launched: ${error.message}`);
    console.error(error);
  } finally {
    // Windows can hold a just-released Dolt file handle open for a moment
    // after the CLI process that used it has already exited (observed live
    // while developing this script: an immediate `rm` failed with EBUSY, a
    // retry a couple of seconds later succeeded with nothing else changed).
    // `fs.rm`'s built-in retry option is exactly built for this — no lingering
    // process is expected (BdService only ever runs short-lived `bd`
    // invocations), just a brief async flush to wait out. `profileDir`/
    // `extensionsDir` are guarded because this outer finally also runs when
    // setup threw before either one was ever created.
    const rmOptions = { recursive: true, force: true, maxRetries: 15, retryDelay: 500 };
    if (profileDir) await rm(profileDir, rmOptions).catch(() => {});
    if (extensionsDir) await rm(extensionsDir, rmOptions).catch(() => {});
    await rm(scratchRoot, rmOptions).catch(() => {});

    const scratchStillThere = await stat(scratchRoot)
      .then(() => true)
      .catch(() => false);
    if (scratchStillThere) {
      failures.push(`scratch project directory was not removed: ${scratchRoot}`);
      console.error(`✘ cleanup: scratch project directory still exists at ${scratchRoot}`);
    } else {
      console.log(`› cleanup: scratch project directory removed (${scratchRoot})`);
    }
  }

  if (failures.length) {
    console.error(`\n✘ Editing suite failed (${failures.length}):`);
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exit(1);
  }
  console.log('\n✔ Editing suite passed.');
}

await main();
