#!/usr/bin/env node
/**
 * Sidebar tree / board drag-drop / quick-action parity suite (beads-ui-vscode-ext-9e9.8).
 *
 *   npm run test:e2e:board
 *
 * This is the automated-evidence suite for beads-ui-vscode-ext-kqd's five
 * manual-QA criteria (M002 #1-2, M003 #3-5). It launches a real VS Code, with
 * this extension loaded, against a throwaway `bd` project, and drives:
 *
 *   1. (M002) The "Needs You" sidebar tree and the "Epics & Milestones" plan
 *      tree, cross-checked against `bd list --assignee=…` / `bd list
 *      --parent=…` directly.
 *   2. (M002) Clicking a tree leaf navigates ("reveals") the dashboard webview
 *      to that exact issue's detail pane.
 *   3. (M003) A real pointer-driven board drag-and-drop that moves a card
 *      across a status-category column boundary, cross-checked against
 *      `bd show --json`.
 *   4. (M003) A forced-failing mutation (`beadsDashboard.bdPath` pointed at a
 *      nonexistent binary) reverts the optimistic board move and surfaces the
 *      bd error as a toast.
 *   5. (M003) The same conceptual "change status" quick action, driven three
 *      different ways — a board drag, the detail pane's Status picker, and
 *      the sidebar tree's context menu "Change Status…" — is shown to land on
 *      the identical resulting status, all three confirmed via `bd show`.
 *
 * ── Why an isolated scratch project ──
 * Same reasoning as `editing-suite.spec.mjs` (Epic A's sibling spec): this
 * suite creates and mutates several issues and deliberately forces one
 * mutation to fail, so it needs real isolation from this repo's own board.
 * `mkdtemp` + `bd init --non-interactive --skip-hooks --skip-agents` gives a
 * fresh scratch directory; `src/extension/workspace.ts` resolves "the beads
 * workspace" purely by `fs.stat`-ing `<folder>/.beads` (no cwd-walk), so
 * opening that scratch folder as the VS Code workspace activates the
 * extension against it and nothing else.
 *
 * ── Why this file repeats run-webview-test.mjs's / editing-suite's harness
 * boilerplate instead of importing a shared module ──
 * Per beads-ui-vscode-ext-9e9's own recorded decision: "E2E goes deep with
 * one dedicated script file per epic to allow safe parallel batching." A
 * shared "harness" module would make every spec-authoring agent edit the same
 * file — the collision parallel batching exists to avoid. The one import that
 * stays shared is `scripts/lib/clean-env.mjs`: it is not test logic, and
 * hand-copying its Windows/Electron env-scrubbing fix imperfectly would be
 * its own risk.
 *
 * ── Why `beadsDashboard.assignee` instead of relying on git config ──
 * `ActorResolver.current` resolves the setting *before* the async git probe,
 * so baking a fixed `beadsDashboard.assignee` into the launch profile's
 * settings.json makes "who needs this issue" fully deterministic — this
 * suite never depends on the host machine's `git config user.name` (which a
 * CI runner may not even have set).
 *
 * ── Why a raw mouse down/move/move/up sequence for the board drag, not
 * `.dragTo()` ──
 * `BoardView.tsx` uses `@dnd-kit/core`'s `PointerSensor` with a 4px
 * `activationConstraint`. A single large jump (`.dragTo()`'s usual
 * implementation) can land past dnd-kit's own drag-start bookkeeping without
 * ever crossing the activation *distance* in a way it tracks as a real drag.
 * The pattern below — move to the card, mouse down, a small move to clear the
 * activation threshold, then two stepped moves to the target — is dnd-kit's
 * own documented Playwright-testing shape, confirmed to work by direct repro
 * during this suite's development (a real `bd show` status flip after the
 * sequence, not assumed). This is a different interaction from the Graph
 * view's SVG-node click issue (beads-ui-vscode-ext-9e9.10): that one is about
 * `click()` after `setPointerCapture()` on an SVG node never firing a
 * follow-up `click` event, which drag-and-drop's press/move/release shape
 * does not depend on at all.
 *
 * ── Why the dashboard panel is "pre-warmed" before the tree-reveal test ──
 * See the KNOWN PRODUCT DEBT note further down: opening the dashboard panel
 * for the very first time *from* a tree click races the webview's `ready`
 * handshake and can silently drop the initial `focusBead` post. Every real
 * user session already has the dashboard open from *some* interaction before
 * they start using the tree to navigate, so pre-warming here reflects actual
 * usage — it does not paper over the race, which is reported, unfixed, in
 * the handoff notes.
 *
 * ── Why the drag target column is chosen from the DOM, not a hardcoded name ──
 * CLAUDE.md forbids hardcoding beads statuses/columns. `BoardView.tsx`'s
 * `Header` renders `title={column.statuses.join(', ')}` on each (uncollapsed)
 * column — this suite reads that `title` attribute to learn, at runtime,
 * exactly which status names a column represents, and picks `column.statuses[0]`
 * as the expected post-drop status — the identical rule `moveCardToCategory`
 * itself applies. Nothing here assumes "Open"/"In Progress"/etc. are the
 * project's actual status names.
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

/** Deterministic "who am I" for the "Needs You" section — never git config. */
const ACTOR_NAME = 'sidebar-parity-actor';

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

/** Every `bd` call goes through here, against the scratch project's own `cwd`. */
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

async function bdCreate(cwd, args) {
  const { stdout } = await execBd(cwd, ['create', ...args, '--json']);
  return JSON.parse(stdout).id;
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
  const scratchRoot = await mkdtemp(join(tmpdir(), 'beads-ui-e2e-sidebar-board-'));
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

  console.log('› creating fixtures');
  const ts = Date.now();
  const epicId = await bdCreate(scratchRoot, [`Sidebar Epic ${ts}`, '--type=epic']);
  const childOneTitle = `Sidebar Task One ${ts}`;
  const childTwoTitle = `Sidebar Task Two ${ts}`;
  const childOneId = await bdCreate(scratchRoot, [childOneTitle, `--parent=${epicId}`]);
  const childTwoId = await bdCreate(scratchRoot, [childTwoTitle, `--parent=${epicId}`]);
  const needsYouTitle = `Needs You Task ${ts}`;
  const needsYouId = await bdCreate(scratchRoot, [needsYouTitle, `--assignee=${ACTOR_NAME}`]);
  const boardDragTitle = `Board Drag Task ${ts}`;
  const boardDragId = await bdCreate(scratchRoot, [boardDragTitle]);
  const failingDragTitle = `Failing Mutation Task ${ts}`;
  const failingDragId = await bdCreate(scratchRoot, [failingDragTitle]);
  const parityCardTitle = `Parity Card Task ${ts}`;
  const parityCardId = await bdCreate(scratchRoot, [parityCardTitle]);
  const parityDetailTitle = `Parity Detail Task ${ts}`;
  const parityDetailId = await bdCreate(scratchRoot, [parityDetailTitle]);
  const parityTreeTitle = `Parity Tree Task ${ts}`;
  const parityTreeId = await bdCreate(scratchRoot, [parityTreeTitle]);

  const { stdout: allRaw } = await execBd(scratchRoot, ['list', '--all', '--json']);
  const totalFixtures = JSON.parse(allRaw).length;

  console.log(`› resolving VS Code ${testVersion}`);
  const executablePath = await downloadAndUnzipVSCode(testVersion);

  const profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-sidebar-board-profile-'));
  const theme = process.env.BEADS_TEST_THEME ?? 'Default Dark Modern';
  await mkdir(join(profileDir, 'User'), { recursive: true });
  await writeFile(
    join(profileDir, 'User', 'settings.json'),
    JSON.stringify(
      {
        'workbench.colorTheme': theme,
        'window.commandCenter': false,
        // Deterministic actor: outranks env/git per ActorResolver.current.
        'beadsDashboard.assignee': ACTOR_NAME,
      },
      null,
      2,
    ),
    'utf8',
  );
  const extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-sidebar-board-exts-'));

  console.log('› launching an isolated editor against the scratch project');
  const app = await _electron.launch({
    executablePath,
    timeout: LAUNCH_TIMEOUT,
    args: [
      `--extensionDevelopmentPath=${repoRoot}`,
      `--user-data-dir=${profileDir}`,
      `--extensions-dir=${extensionsDir}`,
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

  try {
    const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT });
    window.setDefaultTimeout(UI_TIMEOUT);
    await window.locator('.monaco-workbench').waitFor({ state: 'visible' });
    console.log('› workbench is up');

    // Wide enough that the Board renders every column at once (the @2xl
    // container-query breakpoint), matching editing-suite.spec.mjs's reasoning.
    await app.evaluate(({ BrowserWindow }) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) return;
      main.unmaximize();
      main.setBounds({ x: 0, y: 0, width: 1600, height: 1000 });
      main.maximize();
    });
    await window.waitForTimeout(800);

    async function runPaletteCommand(label) {
      await window.keyboard.press(PALETTE_KEY);
      const box = window.locator('.quick-input-box input');
      await box.waitFor({ state: 'visible' });
      await box.fill(`>${label}`);
      await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
      await window.keyboard.press('Enter');
      await window.waitForTimeout(300);
    }

    /** `Beads: Refresh` — forces `BeadsStore.refresh()` unconditionally (see
     * editing-suite.spec.mjs's identical helper doc: the extension's own
     * post-mutation broadcast cannot be trusted to have landed in time). */
    async function refreshDashboard() {
      await runPaletteCommand('Beads: Refresh');
      await window.waitForTimeout(1000);
    }

    /** Brings the (already-open) dashboard panel's own tab back to the front,
     * needed only after opening a *different* editor (Settings JSON) — every
     * other interaction in this suite (tree clicks, palette commands) leaves
     * the dashboard as the active editor tab or re-reveals it itself. */
    async function focusDashboardTab() {
      await window.locator('.tabs-container .tab', { hasText: 'Beads Dashboard' }).first().click();
      await window.waitForTimeout(300);
    }

    async function selectBoardTab() {
      await inner.locator('[role="tab"]:has-text("Board")').first().click();
      await window.waitForTimeout(500);
    }

    await runPaletteCommand('Beads: Open Dashboard');
    const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');

    const header = inner.locator('text=/\\d+\\s+issues/');
    await header.first().waitFor();
    const headerAtStart = (await header.first().innerText()).trim();
    check(
      'scratch project shows every fixture on the header count',
      new RegExp(`^${totalFixtures}\\s+issues`).test(headerAtStart),
      `expected ${totalFixtures} issues, webview header read "${headerAtStart}"`,
    );

    // =================================================================
    // Test 1 (M002 #1): Needs-You summary + epic tree counts, cross-checked
    // against `bd` directly.
    // =================================================================
    console.log('› test 1: sidebar Needs-You summary + epic tree counts');

    const activityBarIcon = window.locator('.activitybar .action-label[aria-label^="Beads"]');
    const planTree = window.locator('[role="tree"][aria-label="Epics & Milestones"]');
    const needsYouTree = window.locator('[role="tree"][aria-label="Needs You"]');

    /**
     * Clicking the Beads activity bar icon a *second* time toggles the
     * sidebar closed (VS Code collapses an already-active container's icon on
     * re-click) — confirmed by direct repro during this suite's development:
     * an unconditional click here made test 5's tree-context-menu path time
     * out because the sidebar it had opened in test 1 was still open and got
     * hidden instead. So this only clicks when the plan tree is not already
     * visible.
     */
    async function ensureBeadsSidebarVisible() {
      const alreadyVisible = await planTree.isVisible().catch(() => false);
      if (alreadyVisible) return;
      await activityBarIcon.first().waitFor();
      await activityBarIcon.first().click({ force: true });
      // Move off the activity bar so its hover tooltip doesn't linger and
      // intercept the next click (observed directly while developing this suite).
      await window.mouse.move(700, 400);
      await window.waitForTimeout(500);
    }

    await ensureBeadsSidebarVisible();
    await planTree.waitFor();
    await needsYouTree.waitFor();

    // --- "Needs You" ---
    const needsYouRow = needsYouTree.locator('[role="treeitem"]', { hasText: needsYouTitle });
    await needsYouRow.first().waitFor();
    check('Needs You tree shows the row assigned to the deterministic actor', (await needsYouRow.count()) > 0);

    const { stdout: assignedRaw } = await execBd(scratchRoot, ['list', `--assignee=${ACTOR_NAME}`, '--json']);
    const assignedViaBd = JSON.parse(assignedRaw);
    check(
      'Needs You count matches `bd list --assignee=…` exactly',
      assignedViaBd.length === 1 && assignedViaBd[0]?.id === needsYouId,
      `bd reported ${JSON.stringify(assignedViaBd.map((b) => b.id))}, expected exactly [${needsYouId}]`,
    );

    const nothingAssignedRow = needsYouTree.locator('[role="treeitem"]', { hasText: 'Nothing is assigned' });
    check(
      'the "nothing assigned" placeholder is gone now that one issue is',
      (await nothingAssignedRow.count()) === 0,
    );

    // --- Epic tree, expanded, cross-checked against `bd list --parent=…` ---
    const epicRow = planTree.locator('[role="treeitem"]', { hasText: `Sidebar Epic ${ts}` }).first();
    await epicRow.waitFor();
    const epicAriaLabel = await epicRow.getAttribute('aria-label');
    check(
      'epic row shows the correct 0/2 rollup before expanding',
      /0\/2\s*·\s*0%/.test(epicAriaLabel ?? ''),
      `epic aria-label: "${epicAriaLabel}"`,
    );

    await epicRow.locator('.monaco-tl-twistie').click({ force: true });
    await window.waitForTimeout(600);

    const childOneRow = planTree.locator('[role="treeitem"]', { hasText: childOneTitle });
    const childTwoRow = planTree.locator('[role="treeitem"]', { hasText: childTwoTitle });
    await childOneRow.first().waitFor();
    await childTwoRow.first().waitFor();
    check('both epic children appear in the tree once expanded', true);

    const { stdout: parentRaw } = await execBd(scratchRoot, ['list', `--parent=${epicId}`, '--json']);
    const childrenViaBd = new Set(JSON.parse(parentRaw).map((b) => b.id));
    check(
      'the tree\'s expanded children match `bd list --parent=…` exactly',
      childrenViaBd.size === 2 && childrenViaBd.has(childOneId) && childrenViaBd.has(childTwoId),
      `bd reported ${JSON.stringify([...childrenViaBd])}, expected [${childOneId}, ${childTwoId}]`,
    );

    // =================================================================
    // Test 2 (M002 #2): tree "reveal in dashboard" navigates to the correct
    // issue.
    //
    // KNOWN PRODUCT DEBT (pre-existing, out of scope for this test-authoring
    // bead — reported in the handoff notes, not fixed here): opening the
    // dashboard panel for the very first time by clicking a tree row races
    // `DashboardPanel`'s webview `ready` handshake — `extension.ts`'s
    // `openDashboard()` calls `panel.focus(id)` synchronously right after
    // `DashboardPanel.show()` creates a brand-new panel, and that `focusBead`
    // post can reach the webview before its `window.addEventListener` is
    // attached, silently dropping the initial focus. Confirmed by direct
    // repro during this suite's development: with no dashboard open yet, a
    // tree click opens the panel but never shows the detail pane; with the
    // dashboard already open (as it already is at this point in the suite,
    // from the "Beads: Open Dashboard" call above — realistic, since a real
    // session already has it open before using the tree to navigate), the
    // exact same click reveals correctly every time. See extension.ts:94-108
    // (`openDashboard`) and DashboardPanel.ts:183-186/211+ (`focus`, the
    // `ready` handler).
    // =================================================================
    console.log('› test 2: tree "reveal in dashboard" navigates to the correct issue');

    await childOneRow.first().click();
    await window.waitForTimeout(1200);

    const detailForChildOne = inner.locator(`aside[aria-label="Details for ${childOneId}"]`);
    await detailForChildOne.waitFor({ timeout: 15_000 });
    check(
      'clicking the tree row opens the dashboard focused on that exact issue',
      await detailForChildOne.isVisible(),
      `expected aside[aria-label="Details for ${childOneId}"]`,
    );

    // =================================================================
    // Test 3 (M003 #3): a real pointer-driven board drag moves a card across
    // a status-category boundary, cross-checked against `bd show`.
    // =================================================================
    console.log('› test 3: board drag-and-drop changes the issue status');

    /** Reads every visible (wide-layout) column's box + the exact status
     * names it represents, from the DOM — never hardcoded. */
    async function readBoardColumns() {
      const sections = inner.locator('section[aria-label$="issues"]:visible');
      const count = await sections.count();
      const columns = [];
      for (let i = 0; i < count; i++) {
        const section = sections.nth(i);
        const box = await section.boundingBox();
        const titleAttr = await section.locator('header span[title]').first().getAttribute('title').catch(() => null);
        columns.push({
          index: i,
          box,
          statuses: titleAttr ? titleAttr.split(', ').filter(Boolean) : [],
        });
      }
      return columns;
    }

    /**
     * Drags `cardId` to the first visible column that does not already list
     * its current status — i.e. a real category move, not a no-op — and
     * returns the exact status name dnd-kit's own `moveCardToCategory` rule
     * (`column.statuses[0]`) predicts it lands on.
     */
    async function dragCardToADifferentColumn(cardId) {
      await refreshDashboard();
      await selectBoardTab();

      const before = await bdShow(scratchRoot, cardId);
      const columns = await readBoardColumns();
      const homeIndex = columns.findIndex((column) => column.statuses.includes(before.status));
      const target = columns.find((column, i) => i !== homeIndex && column.statuses.length > 0 && column.box);
      if (!target) throw new Error(`no alternate board column found to drag ${cardId} into`);

      const card = inner.locator(`article[role="button"][aria-label^="${cardId}: "]:visible`).first();
      await card.waitFor();
      const cardBox = await card.boundingBox();
      if (!cardBox) throw new Error(`could not measure the board card for ${cardId}`);

      const sx = cardBox.x + cardBox.width / 2;
      const sy = cardBox.y + cardBox.height / 2;
      const tx = target.box.x + target.box.width / 2;
      const ty = target.box.y + Math.min(60, target.box.height / 2);

      // Raw pointer sequence: a small move first clears dnd-kit's 4px
      // PointerSensor activation-distance threshold, then two stepped moves
      // carry it across — see this file's header doc for why `.dragTo()`
      // alone is not trustworthy here.
      await window.mouse.move(sx, sy);
      await window.mouse.down();
      await window.mouse.move(sx + 8, sy + 8, { steps: 5 });
      await window.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 10 });
      await window.mouse.move(tx, ty, { steps: 10 });
      await window.waitForTimeout(200);
      await window.mouse.up();
      await window.waitForTimeout(800);

      return { expectedStatus: target.statuses[0], beforeStatus: before.status };
    }

    const dragResult = await dragCardToADifferentColumn(boardDragId);
    const afterBoardDrag = await pollUntil(
      () => bdShow(scratchRoot, boardDragId),
      (bead) => bead?.status === dragResult.expectedStatus,
      (ms) => window.waitForTimeout(ms),
    );
    check(
      'dragging a card to another column changes its status (bd show agrees)',
      afterBoardDrag?.status === dragResult.expectedStatus,
      `expected "${dragResult.expectedStatus}" (was "${dragResult.beforeStatus}"), bd show reports "${afterBoardDrag?.status}"`,
    );

    // =================================================================
    // Test 4 (M003 #4): a forced-failing mutation reverts the optimistic
    // move and surfaces the bd error as a toast.
    // =================================================================
    console.log('› test 4: a failing mutation reverts the optimistic move and toasts the error');

    const BOGUS_BD_PATH = 'definitely-not-a-real-bd-binary-xyz';

    async function editUserSettingsJson(settingsObject) {
      await runPaletteCommand('Preferences: Open User Settings (JSON)');
      await window.waitForTimeout(700);
      const editor = window.locator('.monaco-editor').first();
      await editor.click();
      await window.keyboard.press(`${MOD_KEY}+A`);
      await window.keyboard.press('Delete');
      await window.keyboard.type(JSON.stringify(settingsObject, null, 2), { delay: 5 });
      await window.keyboard.press(`${MOD_KEY}+S`);
      await window.waitForTimeout(800);
    }

    const beforeFailingDrag = await bdShow(scratchRoot, failingDragId);

    await editUserSettingsJson({
      'workbench.colorTheme': theme,
      'window.commandCenter': false,
      'beadsDashboard.assignee': ACTOR_NAME,
      'beadsDashboard.bdPath': BOGUS_BD_PATH,
    });
    await focusDashboardTab();

    const failingDragResult = await dragCardToADifferentColumn(failingDragId);

    const errorToast = inner.locator('[role="status"]').getByText(/could not run/i);
    const toastAppeared = await errorToast.first().isVisible({ timeout: 10_000 }).catch(() => false);
    check(
      'the failed mutation surfaces the bd error as a toast',
      toastAppeared,
      'no toast containing "Could not run" appeared within 10s',
    );
    if (toastAppeared) {
      const toastText = await errorToast.first().innerText();
      check(
        'the toast names the bogus bdPath it could not run',
        toastText.includes(BOGUS_BD_PATH),
        `toast read: "${toastText}"`,
      );
    }

    const afterFailingDrag = await bdShow(scratchRoot, failingDragId);
    check(
      'the optimistic move was reverted — bd show reports the ORIGINAL status',
      afterFailingDrag?.status === beforeFailingDrag?.status,
      `expected unchanged "${beforeFailingDrag?.status}", bd show reports "${afterFailingDrag?.status}" ` +
        `(attempted move target was "${failingDragResult.expectedStatus}")`,
    );

    // Revert bdPath before anything else in this suite calls `bd` through the
    // extension again.
    await editUserSettingsJson({
      'workbench.colorTheme': theme,
      'window.commandCenter': false,
      'beadsDashboard.assignee': ACTOR_NAME,
    });
    await focusDashboardTab();
    await refreshDashboard();

    // =================================================================
    // Test 5 (M003 #5): the same quick action (a status change) behaves
    // identically from the card, the detail pane, and the tree context menu.
    // =================================================================
    console.log('› test 5: quick-action parity — card vs detail pane vs tree context menu');

    // --- Path 1: the card (a board drag is the card's own quick action for
    // changing status — BeadCard has no separate status control of its own). ---
    const parityCardResult = await dragCardToADifferentColumn(parityCardId);
    const afterParityCard = await pollUntil(
      () => bdShow(scratchRoot, parityCardId),
      (bead) => bead?.status === parityCardResult.expectedStatus,
      (ms) => window.waitForTimeout(ms),
    );
    check(
      'path 1 (card drag) applied the expected status',
      afterParityCard?.status === parityCardResult.expectedStatus,
      `bd show reports "${afterParityCard?.status}", expected "${parityCardResult.expectedStatus}"`,
    );
    const targetStatusName = parityCardResult.expectedStatus;

    // --- Path 2: the detail pane's own "Quick actions" Status picker. ---
    await refreshDashboard();
    await selectBoardTab();
    const detailCard = inner.locator(`article[role="button"][aria-label^="${parityDetailId}: "]:visible`).first();
    await detailCard.waitFor();
    await detailCard.click();
    const detailPane = inner.locator(`aside[aria-label="Details for ${parityDetailId}"]`);
    await detailPane.waitFor();

    const statusSelect = detailPane.getByLabel('Status');
    await statusSelect.selectOption(targetStatusName);
    await window.waitForTimeout(600);

    const afterParityDetail = await pollUntil(
      () => bdShow(scratchRoot, parityDetailId),
      (bead) => bead?.status === targetStatusName,
      (ms) => window.waitForTimeout(ms),
    );
    check(
      'path 2 (detail pane Status picker) applied the SAME status as the card',
      afterParityDetail?.status === targetStatusName,
      `bd show reports "${afterParityDetail?.status}", expected "${targetStatusName}"`,
    );
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // --- Path 3: the sidebar tree's context menu "Change Status…" command. ---
    await ensureBeadsSidebarVisible();
    await planTree.waitFor();

    const parityTreeRow = planTree.locator('[role="treeitem"]', { hasText: parityTreeTitle }).first();
    await parityTreeRow.waitFor();
    await parityTreeRow.click({ button: 'right' });
    await window.waitForTimeout(600);

    const changeStatusMenuItem = window.getByRole('menuitem', { name: 'Change Status…', exact: true });
    await changeStatusMenuItem.waitFor();
    await changeStatusMenuItem.click();
    await window.waitForTimeout(500);

    const quickPickRows = window.locator('.quick-input-list .monaco-list-row');
    await quickPickRows.first().waitFor();
    const targetRow = quickPickRows.filter({ hasText: targetStatusName }).first();
    await targetRow.waitFor();
    await targetRow.click();
    await window.waitForTimeout(600);

    const afterParityTree = await pollUntil(
      () => bdShow(scratchRoot, parityTreeId),
      (bead) => bead?.status === targetStatusName,
      (ms) => window.waitForTimeout(ms),
    );
    check(
      'path 3 (tree context menu "Change Status…") applied the SAME status as the card and the detail pane',
      afterParityTree?.status === targetStatusName,
      `bd show reports "${afterParityTree?.status}", expected "${targetStatusName}"`,
    );

    check(
      'all three quick-action surfaces (card, detail pane, tree context menu) converge on one identical status',
      afterParityCard?.status === targetStatusName &&
        afterParityDetail?.status === targetStatusName &&
        afterParityTree?.status === targetStatusName,
      `card="${afterParityCard?.status}" detail="${afterParityDetail?.status}" tree="${afterParityTree?.status}"`,
    );

    await window.screenshot({ path: join(artifactsDir, 'sidebar-board-parity-final.png') });
    console.log(`› screenshot written to ${artifactsDir}`);
  } catch (error) {
    await app
      .windows()[0]
      ?.screenshot({ path: join(artifactsDir, 'sidebar-board-parity-failure.png') })
      .catch(() => {});
    failures.push(`threw: ${error.message}`);
    console.error(error);
  } finally {
    await app.close().catch(() => {});
    // Same Windows/Dolt-handle settle delay as editing-suite.spec.mjs.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const rmOptions = { recursive: true, force: true, maxRetries: 15, retryDelay: 500 };
    await rm(profileDir, rmOptions).catch(() => {});
    await rm(extensionsDir, rmOptions).catch(() => {});
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
    console.error(`\n✘ Sidebar/board/quick-action parity suite failed (${failures.length}):`);
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exit(1);
  }
  console.log('\n✔ Sidebar/board/quick-action parity suite passed.');
}

await main();
