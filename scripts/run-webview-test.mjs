#!/usr/bin/env node
/**
 * End-to-end webview check.
 *
 *   npm run test:webview
 *
 * Launches a real VS Code in a throwaway profile with this extension loaded,
 * opens the dashboard through the command palette, and reads the *rendered*
 * webview DOM — the one thing the extension-host smoke test cannot see.
 *
 * The assertions cross-check the UI against the `bd` CLI: the header's issue
 * count must equal `bd list --all`'s (not `bd stats`' `total_issues`, which
 * also counts ad-hoc `gate` issues the dashboard itself never shows), so a
 * webview that paints an empty or stale board fails here rather than looking
 * fine in a screenshot.
 *
 * Isolated on purpose: `--user-data-dir` / `--extensions-dir` point at a temp
 * profile, so the editor window you already have open is never touched and no
 * reload is needed. The one exception to "nothing here mutates the beads
 * database" is the Gates assertion: it creates a throwaway human gate via
 * `bd gate create` so the Gates section has something to render, and always
 * resolves it again before the run ends (see `createTempGate` /
 * `resolveAllGatesByReason` in `main`), even on failure.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron } from 'playwright';

import { cleanEnv, scrubProcessEnv } from './lib/clean-env.mjs';

// Read before scrubbing, which removes every VSCODE_* variable. Same default as
// run-electron-test.mjs: the minimum `engines.vscode` promises, not the latest.
const testVersion = process.env.VSCODE_TEST_VERSION ?? '1.105.0';

// downloadAndUnzipVSCode shells out too, so fix the ambient environment as well
// as the one handed to the editor.
scrubProcessEnv();

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = join(repoRoot, 'dist', 'test-artifacts');

/** Long, because a cold VS Code start plus a Dolt open is not fast. */
const LAUNCH_TIMEOUT = 180_000;
const UI_TIMEOUT = 90_000;

/**
 * VS Code's default chord for the Command Palette is `Ctrl+Shift+P` on
 * Windows/Linux but `Cmd+Shift+P` on macOS — hardcoding the former meant
 * every keypress in this script silently no-opped on a Mac runner, hanging
 * on the very first `.quick-input-widget` wait until `UI_TIMEOUT` with no
 * clue why. Same story for the sidebar toggles.
 */
const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';
const PALETTE_KEY = `${MOD_KEY}+Shift+P`;
const TOGGLE_SIDEBAR_KEY = `${MOD_KEY}+B`;
const TOGGLE_SECONDARY_SIDEBAR_KEY = `${MOD_KEY}+Alt+B`;

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

/**
 * Every `bd` call below goes through this one spot, so the ENOENT → retry
 * under a shell fallback (some CI images only resolve `bd` via the shell's
 * PATH lookup, not execFile's direct exec) is written once rather than
 * copy-pasted at each call site.
 */
async function execBd(args) {
  const options = {
    cwd: repoRoot,
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

/** Ground truth, read straight from the CLI rather than from the extension. */
async function bdStats() {
  const { stdout } = await execBd(['stats', '--json']);
  const raw = JSON.parse(stdout);
  return raw.summary ?? raw;
}

/**
 * Every issue `bd list` is willing to show (closed included, via `--all`) —
 * deliberately *not* `bd stats`' `total_issues`, which also counts `gate`-type
 * issues (`bd gate create`'s own ad-hoc issues) that `bd list`/the dashboard
 * both hide by design. The header's "N issues" tracks the latter, so
 * comparing it against `total_issues` looks right on a board that has never
 * had a gate and quietly breaks forever after the first one is ever created
 * (this file's own Gates assertion included) — discovered by that assertion
 * doing exactly that during this file's own development.
 */
async function bdBoardIssues() {
  const { stdout } = await execBd(['list', '--all', '--json']);
  return JSON.parse(stdout);
}

/**
 * Count of `blocks` / `parent-child` edges across the whole board — the same
 * two kinds `graph-layout.ts` renders. The Roadmap tab's graph-shape assertion
 * branches on this instead of assuming the board either has or lacks dependencies: a
 * board with none should show the EmptyState, a board with some should show
 * nodes, and guessing wrong either way would make the check meaningless.
 */
function countGraphEdges(issues) {
  const ids = new Set(issues.map((issue) => issue.id));
  let count = 0;
  for (const issue of issues) {
    for (const dependency of issue.dependencies ?? []) {
      const kind = dependency.type ?? dependency.dependency_type;
      const targetId = dependency.id ?? dependency.depends_on_id;
      if (!kind || !targetId) continue;
      if (kind !== 'blocks' && kind !== 'parent-child') continue;
      if (targetId === issue.id || !ids.has(targetId)) continue;
      count++;
    }
  }
  return count;
}

/**
 * The one place this script is allowed to mutate the real board: an ad-hoc
 * human gate created purely so the Gates section has something to render.
 * Identifying it again for cleanup goes through `findOpenGateIdsByReason`
 * rather than trusting `bd gate create --json`'s return shape (undocumented,
 * and not worth pinning down when re-listing is just as cheap) — that way
 * cleanup in `main`'s `finally` works even if this function's own return
 * value is somehow wrong.
 */
async function createTempGate(blocksId, reason) {
  await execBd(['gate', 'create', '--type=human', `--blocks=${blocksId}`, `--reason=${reason}`, '--json']);
}

/** Every currently-open gate whose reason matches — the reason string is
 * stamped with `Date.now()` by the caller precisely so this lookup can never
 * accidentally match a real, human-created gate. */
async function findOpenGateIdsByReason(reason) {
  const { stdout } = await execBd(['gate', 'list', '--json']);
  let gates;
  try {
    gates = JSON.parse(stdout);
  } catch {
    gates = null;
  }
  const list = Array.isArray(gates) ? gates : (gates?.gates ?? []);
  // `bd gate list --json` has no top-level `reason` field — `bd gate create
  // --reason=...` only ever lands the text inside the gate issue's own
  // `description` (as "Reason: <text>"), confirmed by inspecting a live gate.
  // Matching on `gate.reason` here silently matched nothing on every past
  // run of this script, which is exactly how a gate created by an earlier,
  // buggy run of this test was left open on the real board — see the git
  // history of this file for that incident and its manual cleanup.
  const matches = (gate) =>
    gate.reason === reason || (typeof gate.description === 'string' && gate.description.includes(reason));
  return list.filter(matches).map((gate) => gate.id).filter(Boolean);
}

async function resolveGate(gateId) {
  await execBd(['gate', 'resolve', gateId, '--reason=e2e cleanup']);
}

/** Resolve every open gate matching `reason`, tolerating a partial failure on
 * one gate so the rest still get cleaned up, and reporting every failure
 * back to the caller instead of swallowing it. */
async function resolveAllGatesByReason(reason) {
  const ids = await findOpenGateIdsByReason(reason);
  const errors = [];
  for (const id of ids) {
    await resolveGate(id).catch((error) => errors.push(`${id}: ${error.message}`));
  }
  return errors;
}

/**
 * The folder VS Code should open as its workspace — not always `repoRoot`.
 * `src/extension/workspace.ts` only ever checks `<workspace folder>/.beads`
 * (a plain `fs.stat`, no git-worktree awareness), but a `git worktree` checkout
 * intentionally has no `.beads` of its own — beads' shared Dolt DB lives once,
 * beside the main checkout, and every worktree's `bd` CLI resolves to it via
 * git rather than a local copy. Opening `repoRoot` as the workspace when it IS
 * such a worktree would make the extension activate against zero issues and
 * every assertion here would either time out or false-fail. `--extensionDevelopmentPath`
 * still stays pinned to `repoRoot`, so the code under test is exactly what
 * this checkout has — only the *opened folder* moves, and only for reading:
 * nothing in this script writes a file under it.
 */
async function findBeadsWorkspaceRoot() {
  const hasOwnBeads = await stat(join(repoRoot, '.beads'))
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (hasOwnBeads) return repoRoot;

  let mainRoot;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    mainRoot = dirname(resolve(repoRoot, stdout.trim()));
  } catch {
    return repoRoot; // Not a git checkout at all; nothing more to try.
  }

  const mainHasBeads = await stat(join(mainRoot, '.beads'))
    .then((s) => s.isDirectory())
    .catch(() => false);
  return mainHasBeads ? mainRoot : repoRoot;
}

/** The first ready issue is as good a target as any for the throwaway gate —
 * dynamic on purpose, so this does not hard-code a board state that later
 * changes out from under it. */
async function pickGateBlockCandidate() {
  const { stdout } = await execBd(['ready', '--json']);
  const ready = JSON.parse(stdout);
  const list = Array.isArray(ready) ? ready : (ready?.issues ?? []);
  const candidate = list[0];
  if (!candidate?.id) throw new Error('bd ready returned nothing to gate for the Gates assertion');
  return candidate.id;
}

async function main() {
  await mkdir(artifactsDir, { recursive: true });

  console.log('› building bundles');
  const build = await execFileAsync('npm', ['run', 'build'], {
    cwd: repoRoot,
    shell: process.platform === 'win32',
  }).catch((error) => {
    throw new Error(`build failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  });
  void build;

  const stats = await bdStats();
  console.log(`› bd reports ${stats.total_issues} issues total (${stats.ready_issues} ready)`);

  const boardIssues = await bdBoardIssues();
  const visibleIssueCount = boardIssues.length;
  console.log(`› bd list shows ${visibleIssueCount} issues (what the dashboard itself renders)`);

  const graphEdgeCount = countGraphEdges(boardIssues);
  console.log(`› bd reports ${graphEdgeCount} blocks/parent-child edge(s) for the Roadmap graph shape`);

  const workspaceRoot = await findBeadsWorkspaceRoot();
  if (workspaceRoot !== repoRoot) {
    console.log(`› ${repoRoot} has no .beads of its own (a worktree); opening ${workspaceRoot} instead`);
  }

  console.log(`› resolving VS Code ${testVersion}`);
  const executablePath = await downloadAndUnzipVSCode(testVersion);

  const profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-profile-'));

  // The dashboard takes every colour from the editor's theme, so the theme is
  // part of what is under test. `BEADS_TEST_THEME="Default Light Modern"` runs
  // the same assertions against a light editor.
  const theme = process.env.BEADS_TEST_THEME ?? 'Default Dark Modern';
  await mkdir(join(profileDir, 'User'), { recursive: true });
  await writeFile(
    join(profileDir, 'User', 'settings.json'),
    JSON.stringify({ 'workbench.colorTheme': theme, 'window.commandCenter': false }, null, 2),
    'utf8',
  );
  console.log(`› theme: ${theme}`);
  const extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-exts-'));

  console.log('› launching an isolated editor');
  const app = await _electron.launch({
    executablePath,
    timeout: LAUNCH_TIMEOUT,
    args: [
      `--extensionDevelopmentPath=${repoRoot}`,
      `--user-data-dir=${profileDir}`,
      `--extensions-dir=${extensionsDir}`,
      // NOT `--disable-extensions`: on this VS Code build that flag also
      // disables the extension loaded via `--extensionDevelopmentPath`, so
      // the dashboard's own commands never registered and every assertion
      // below timed out waiting on UI that could never appear. `--user-data-dir`
      // / `--extensions-dir` already point at fresh, empty temp directories,
      // so there is nothing else installed left to disable anyway.
      '--disable-workspace-trust',
      '--disable-gpu',
      '--no-sandbox',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-updates',
      workspaceRoot,
    ],
    env: cleanEnv({ BD_JSON_ENVELOPE: '0' }),
  });

  try {
    const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT });
    window.setDefaultTimeout(UI_TIMEOUT);

    await window.locator('.monaco-workbench').waitFor({ state: 'visible' });
    console.log('› workbench is up');

    // Give the panel a realistic amount of room. The default window is small
    // enough that the dashboard renders in its narrow layout, which makes the
    // screenshots useless for reviewing the wide one.
    await app.evaluate(({ BrowserWindow }) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) return;
      main.unmaximize();
      main.setBounds({ x: 0, y: 0, width: 1600, height: 1000 });
      main.maximize();
    });
    await window.waitForTimeout(800);

    // Drive the palette rather than calling the command directly: this is the
    // same path a user takes, so a broken `when` clause would show up.
    await window.keyboard.press(PALETTE_KEY);
    const palette = window.locator('.quick-input-widget');
    await palette.waitFor({ state: 'visible' });
    await window.locator('.quick-input-box input').fill('>Beads: Open Dashboard');
    await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
    await window.keyboard.press('Enter');

    // VS Code nests the webview: an outer host frame, then the extension's own.
    const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');

    const header = inner.locator('text=/\\d+\\s+issues/');
    await header.first().waitFor();
    const headerText = (await header.first().innerText()).trim();
    const rendered = Number(headerText.match(/(\d+)\s+issues/)?.[1]);

    check(
      `header issue count matches bd (${rendered} vs ${visibleIssueCount})`,
      rendered === visibleIssueCount,
      `webview header read "${headerText}"`,
    );

    for (const tab of ['Overview', 'Roadmap', 'Board']) {
      check(
        `"${tab}" tab is rendered`,
        await inner
          .locator(`[role="tab"]:has-text("${tab}")`)
          .first()
          .isVisible()
          .catch(() => false),
      );
    }

    // An error banner means bd failed behind the UI even if the shell painted.
    check(
      'no error banner',
      (await inner.locator('[role="alert"]').count()) === 0,
      await inner
        .locator('[role="alert"]')
        .first()
        .innerText()
        .catch(() => ''),
    );

    // Checked only now: the activity bar item appears when the contribution is
    // rendered, which lags the workbench becoming visible. Sampling it once at
    // startup is a race, so poll until it shows or the deadline passes.
    //
    // VS Code moves the label between the <li> and the inner <a> across
    // releases, so read every candidate rather than pinning one selector.
    const readActivityLabels = () =>
      window.locator('.activitybar .action-item').evaluateAll((items) =>
        items.map((item) =>
          [
            item.getAttribute('aria-label'),
            item.getAttribute('title'),
            item.querySelector('.action-label')?.getAttribute('aria-label'),
          ]
            .filter(Boolean)
            .join(' | '),
        ),
      );

    let activityLabels = [];
    const deadline = Date.now() + 30_000;
    do {
      activityLabels = await readActivityLabels();
      if (activityLabels.some((label) => /beads/i.test(label))) break;
      await window.waitForTimeout(500);
    } while (Date.now() < deadline);

    // At this window size VS Code pushes later containers into the "Additional
    // Views" overflow, so a bar without "Beads" on it is not yet a failure —
    // open the overflow and look there before deciding.
    let where = 'activity bar';
    if (!activityLabels.some((label) => /beads/i.test(label))) {
      // The overflow button is an icon with no text, so match its aria-label —
      // `hasText` would never find it.
      const overflow = window.locator(
        '.activitybar .action-item[aria-label*="Additional Views" i], ' +
          '.activitybar .action-item:has([aria-label*="Additional Views" i])',
      );
      if ((await overflow.count()) > 0) {
        await overflow.first().click();
        await window.waitForTimeout(500);
        // The overflow menu is rendered outside the activity bar, in whichever
        // context-view layer this release uses; read all of them as text.
        const menuLabels = await window
          .locator('.context-view, .monaco-menu, .quick-input-widget')
          .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
        if (menuLabels.some((label) => /beads/i.test(label))) {
          activityLabels = menuLabels;
          where = 'Additional Views overflow';
        }
        await window.keyboard.press('Escape');
      }
    }

    check(
      'activity bar shows the Beads container',
      activityLabels.some((label) => /beads/i.test(label)),
      `looked in the ${where}; found: ${activityLabels.join(' / ') || '(no items)'}`,
    );

    // `createBeadsStatusBar` (src/extension/status-bar.ts) registers the item
    // with the bare id `beadsDashboard.status`, but VS Code stamps the DOM
    // node's own `id` with the full `<publisher>.<extension-name>.<id>` —
    // confirmed by dumping the real `#workbench.parts.statusbar` markup while
    // writing this assertion, not guessed — hence matching on a suffix
    // instead of the bare id verbatim.
    const statusBarItem = window.locator('[id$="beadsDashboard.status"]');
    await statusBarItem.first().waitFor({ state: 'visible' });
    const statusBarText = await statusBarItem
      .first()
      .innerText()
      .catch(() => '');
    check(
      'status bar shows the ready count',
      /\d+\s*ready/i.test(statusBarText),
      `status bar item read "${statusBarText}"`,
    );

    // The sidebar is the other half of the UI. It is two views now — "Needs
    // You" and "Epics & Milestones" — so the headings are pane titles, and
    // "Unassigned" rides inside the plan view as its triage queue.
    await window.keyboard.press(PALETTE_KEY);
    await window.locator('.quick-input-box input').fill('>Beads: Focus on Epics');
    await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
    await window.keyboard.press('Enter');
    await window.waitForTimeout(1500);

    const paneTitles = await window
      .locator('.pane-header .title')
      .allInnerTexts()
      .catch(() => []);

    for (const [heading, pattern] of [
      ['Needs You', /needs you/i],
      ['Epics & Milestones', /epics\s*&\s*milestones/i],
    ]) {
      check(
        `sidebar shows the "${heading}" view`,
        paneTitles.some((title) => pattern.test(title)),
        `pane titles read: ${paneTitles.join(' / ') || '(none)'}`,
      );
    }

    const treeRows = await window
      .locator('.pane-body .monaco-list-row')
      .allInnerTexts()
      .catch(() => []);
    const treeText = treeRows.join(' | ');

    check(
      'the plan view carries its Unassigned triage queue',
      /Unassigned\s*\(\d+\)/.test(treeText),
      `tree read: ${treeText.slice(0, 400)}`,
    );

    // Every epic reports its own x/y; a row stuck at 0 while bd says otherwise
    // means the rollup is broken.
    check(
      'epic rows report progress counts',
      /\d+\s*\/\s*\d+/.test(treeText),
      treeText.slice(0, 400),
    );

    // Gates: the real board has nothing open right now, so asserting the
    // section is *present* would always be vacuously true — this checks it
    // is correctly absent instead, which a shell that always renders the
    // section regardless of gate count would fail.
    check(
      'no Gates section when the board has no open gates',
      !/Gates\s*\(\d+\)/.test(treeText),
      `tree read: ${treeText.slice(0, 400)}`,
    );

    // `bd` round-trips (Dolt-backed) and the store's own refresh fetch are
    // not instant, and both run again on every `Beads: Refresh`, so a single
    // fixed wait either reads stale state or races the *next* refresh's
    // still-in-flight fetch. Polling for the actual expected shape (up to
    // `timeoutMs`) is the only version of this that isn't a coin flip.
    const readTreeText = () =>
      window
        .locator('.pane-body .monaco-list-row')
        .allInnerTexts()
        .then((rows) => rows.join(' | '))
        .catch(() => '');

    async function refreshAndWaitForTree(predicate, timeoutMs = 20_000) {
      await window.keyboard.press(PALETTE_KEY);
      await window.locator('.quick-input-box input').fill('>Beads: Refresh');
      await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
      await window.keyboard.press('Enter');

      const deadline = Date.now() + timeoutMs;
      let text = await readTreeText();
      while (!predicate(text) && Date.now() < deadline) {
        await window.waitForTimeout(500);
        text = await readTreeText();
      }
      return text;
    }

    // Then prove the section really does light up: a throwaway gate is
    // created on whatever `bd ready` offers first, resolved in `finally` no
    // matter what happens in between so the real board is never left with
    // test debris even if an assertion below throws or fails.
    const gateBlockTarget = await pickGateBlockCandidate();
    const gateReason = `e2e run-webview-test.mjs probe ${Date.now()}`;
    await createTempGate(gateBlockTarget, gateReason);
    try {
      const treeTextWithGate = await refreshAndWaitForTree((text) => /Gates\s*\(1\)/.test(text));
      check(
        'Gates (1) section appears once a gate is open',
        /Gates\s*\(1\)/.test(treeTextWithGate),
        `tree read: ${treeTextWithGate.slice(0, 400)}`,
      );
    } finally {
      // Surfaced as a hard failure, not swallowed: a gate left open on the
      // real board is worse than a noisy log line. Matches by reason rather
      // than a returned id, so this cleans up even if something above threw
      // before an id was ever captured.
      const cleanupErrors = await resolveAllGatesByReason(gateReason);
      for (const message of cleanupErrors) {
        failures.push(`could not resolve the temporary gate ${message}`);
        console.error(`✘ cleanup: could not resolve gate ${message}`);
      }
    }

    // Confirm the cleanup actually took: back to the same absent-section
    // shape the very first Gates check relied on.
    const treeTextAfterCleanup = await refreshAndWaitForTree((text) => !/Gates\s*\(\d+\)/.test(text));
    check(
      'Gates section is gone again after the temporary gate is resolved',
      !/Gates\s*\(\d+\)/.test(treeTextAfterCleanup),
      `tree read: ${treeTextAfterCleanup.slice(0, 400)}`,
    );

    await window.screenshot({ path: join(artifactsDir, 'sidebar.png') });

    // Collapse the side bars so the screenshots show the dashboard, not the
    // explorer. Ctrl+B is the primary side bar, Ctrl+Alt+B the secondary one.
    await window.keyboard.press(TOGGLE_SIDEBAR_KEY);
    await window.keyboard.press(TOGGLE_SECONDARY_SIDEBAR_KEY);
    await window.waitForTimeout(600);

    await window.screenshot({ path: join(artifactsDir, 'overview.png') });

    // The board is where the status→category grouping is actually exercised.
    await inner.locator('[role="tab"]:has-text("Board")').first().click();
    await window.waitForTimeout(1500);
    await window.screenshot({ path: join(artifactsDir, 'board.png') });
    check(
      'board renders at least one column',
      (await inner.locator('text=/Open|In Progress|Done|On Hold/').count()) > 0,
    );

    // beads-ui-vscode-ext-19r.10: the `DragOverlay` ghost used to carry a
    // hardcoded `w-64`, fighting dnd-kit's own `PositionedOverlay` wrapper
    // (which already sizes itself from the *real* dragged card's measured
    // rect at drag-start) from the inside. jsdom returns 0x0 for every
    // `getBoundingClientRect()` call, so no unit test can measure this — only
    // a real, rendered pointer drag in this real editor window can. `article
    // [role="button"]` matches every real card; the ghost is the one `article`
    // dnd-kit renders with no `role` at all, marked `aria-hidden` instead (see
    // `bead-card.tsx`'s `presentational` prop), so it never collides with the
    // selector above.
    {
      const dragSourceCard = inner.locator('article[role="button"]:visible').first();
      await dragSourceCard.waitFor();
      const sourceBox = await dragSourceCard.boundingBox();
      if (!sourceBox) {
        failures.push('drag ghost width check: could not measure the source card before dragging');
      } else {
        const startX = sourceBox.x + sourceBox.width / 2;
        const startY = sourceBox.y + sourceBox.height / 2;

        await window.mouse.move(startX, startY);
        await window.mouse.down();
        // `PointerSensor`'s `activationConstraint: { distance: 4 }` (BoardView.tsx)
        // only starts the drag — and mounts `DragOverlay` — once the pointer has
        // moved more than 4px from where it went down. Two small moves rather
        // than one big jump, so this crosses that threshold the same way a real
        // drag's pointermove stream would rather than skipping straight past it.
        await window.mouse.move(startX + 3, startY + 3);
        await window.mouse.move(startX + 10, startY + 12);

        const ghostCard = inner.locator('article[aria-hidden="true"]').first();
        await ghostCard.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
        const ghostBox = await ghostCard.boundingBox();

        // Release back over the same card/column the drag started from: its
        // status category is unchanged, so `onDragEnd` (BoardView.tsx) takes its
        // early "already in this column" return and calls no `bd` mutation —
        // this check only ever reads the board, the same rule every other
        // assertion in this file follows.
        await window.mouse.move(startX, startY);
        await window.mouse.up();
        await ghostCard.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
        await window.waitForTimeout(300);

        check(
          'drag ghost width matches the source card it was picked up from',
          !!ghostBox && Math.abs(ghostBox.width - sourceBox.width) <= 2,
          `ghost width ${ghostBox?.width ?? '(unmeasured)'}, source card width ${sourceBox.width}`,
        );
      }
    }

    // Finished work starts folded away: the done column's header is a toggle
    // offering to *expand* it. Read the aria-label, which is also the promise
    // made to a screen reader.
    const expandDone = inner.locator('[aria-label^="Expand Done"]');
    check('done column starts collapsed', (await expandDone.count()) > 0);

    if ((await expandDone.count()) > 0) {
      await expandDone.first().click();
      await window.waitForTimeout(400);
      check(
        'the done column unfolds when its header is clicked',
        (await inner.locator('[aria-label^="Collapse Done"]').count()) > 0,
      );
    }

    // Every empty column says what is actually empty rather than "Drop an issue
    // here", so the generic hint must be gone.
    check(
      'empty columns no longer use the generic drop hint',
      (await inner.locator('text="Drop an issue here"').count()) === 0,
    );

    // Swimlanes: the toggle has a title (no aria-label) and reports its own
    // state via aria-pressed (BoardView.tsx). Off, no lane section exists at
    // all — the `[aria-label*=" lane, "]` pattern is what `SwimlaneSection`
    // stamps on each lane (e.g. `"auto-ok lane, 3 issues"`), so its absence
    // is the flat-layout signal, not just an empty string.
    const swimlaneToggle = inner.locator('button[title="Group columns into taxonomy-label lanes"]');
    const swimlaneLanes = inner.locator('[aria-label*=" lane, "]');
    check('swimlane toggle is rendered on the Board tab', (await swimlaneToggle.count()) > 0);

    if ((await swimlaneToggle.count()) > 0) {
      check(
        'board starts in the flat (no-swimlane) layout',
        (await swimlaneLanes.count()) === 0 && (await swimlaneToggle.getAttribute('aria-pressed')) === 'false',
      );

      await swimlaneToggle.first().click();
      await window.waitForTimeout(500);
      check(
        'clicking the toggle switches the board into taxonomy-label lanes',
        (await swimlaneLanes.count()) > 0 && (await swimlaneToggle.getAttribute('aria-pressed')) === 'true',
      );
      await window.screenshot({ path: join(artifactsDir, 'board-swimlanes.png') });

      await swimlaneToggle.first().click();
      await window.waitForTimeout(500);
      check(
        'clicking it again returns the board to the flat layout',
        (await swimlaneLanes.count()) === 0 && (await swimlaneToggle.getAttribute('aria-pressed')) === 'false',
      );
    }

    // The detail pane: Assignee applies on commit like Status and Priority, so
    // there is no Save button left to be inconsistent with them.
    // `:visible` matters: the narrow single-column layout renders the same
    // cards behind a container query, so the first card in DOM order is the
    // hidden one.
    const firstCard = inner.locator('article[role="button"]:visible').first();
    if ((await firstCard.count()) > 0) {
      await firstCard.click();
      const detail = inner.locator('aside[aria-label^="Details for"]');
      await detail.first().waitFor();
      // `has-text` is a substring match over the whole subtree, so it hits any
      // button whose issue title happens to contain the word. Match the button's
      // own accessible name instead, and say what was found when it fails.
      const saveButtons = await detail
        .locator('button')
        .filter({ hasText: /^\s*save\s*$/i })
        .allInnerTexts();
      check(
        'detail pane has no Save button beside the assignee field',
        saveButtons.length === 0,
        `found: ${saveButtons.join(' / ')}`,
      );
      check(
        'the assignee field says when it applies',
        (await detail.locator('text=/Applies on Enter/').count()) > 0,
      );

      // Comment composer: rendered unconditionally by bead-detail.tsx, even
      // at zero comments, so its presence must not depend on this issue
      // already having any. No submission here — reading the board is fine,
      // writing to it through the UI is not something this e2e run should do.
      const commentDraft = detail.locator('#comment-draft');
      check(
        'the comment composer is visible in the detail pane',
        await commentDraft
          .first()
          .isVisible()
          .catch(() => false),
      );
      check(
        'the comment composer has an "Add a comment" label',
        (await detail.locator('label', { hasText: 'Add a comment' }).count()) > 0,
      );

      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    }

    // Graph used to be its own tab; beads-ui-vscode-ext-615 folded it into the
    // Roadmap tab as a third shape (`RoadmapView.tsx`'s `role="group"
    // aria-label="Roadmap shape"` segmented control) alongside Timeline and
    // List. Only beads carrying a `blocks` / `parent-child` edge are drawn at
    // all (graph-layout.ts), so which branch is correct — nodes or the
    // EmptyState — depends on whether the real board has any such edge right
    // now, hence branching on `graphEdgeCount` measured up front rather than
    // assuming either shape.
    await inner.locator('[role="tab"]:has-text("Roadmap")').first().click();
    await window.waitForTimeout(1000);

    const roadmapShapeGroup = inner.locator('[role="group"][aria-label="Roadmap shape"]');
    await roadmapShapeGroup.first().waitFor();
    await roadmapShapeGroup.locator('button:has-text("Graph")').first().click();
    await window.waitForTimeout(1000);
    if (graphEdgeCount > 0) {
      check('Roadmap graph shape renders an svg', (await inner.locator('svg').count()) > 0);
      check(
        'Roadmap graph shape renders at least one dependency node',
        (await inner.locator('svg [role="button"]').count()) > 0,
      );
      await window.screenshot({ path: join(artifactsDir, 'graph.png') });
    } else {
      check(
        'Roadmap graph shape shows the EmptyState when the board has no dependency edges',
        (await inner.locator('text=/No dependencies to show/').count()) > 0,
      );
    }

    // Back to the default Timeline shape for the roadmap screenshot below.
    await roadmapShapeGroup.locator('button:has-text("Timeline")').first().click();
    await window.waitForTimeout(1500);
    await window.screenshot({ path: join(artifactsDir, 'roadmap.png') });

    // Fleet (beads-ui-vscode-ext-37b): reads `~/.claude/projects`, so whether
    // this real editor session shows actual orchestrator/worker rows depends
    // on whether *this* run happens to match the opened workspace's own
    // mangled-cwd directory — not something to assume either way. Assert on
    // whichever real, recognized state actually rendered instead: worker
    // rows, or one of `FleetView`/`WorkerList`'s own empty/degraded states.
    await inner.locator('[role="tab"]:has-text("Fleet")').first().click();
    await window.waitForTimeout(1500);

    const fleetLoading = inner.locator('[aria-busy="true"][aria-label="Loading fleet"]');
    if ((await fleetLoading.count()) > 0) {
      await fleetLoading
        .first()
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => {});
    }

    const fleetWorkerRows = inner.locator('li[role="button"][aria-label^="Worker "]');
    const fleetEmptyStates = inner.locator(
      'text=/No fleet data yet|No fleet activity|No Claude Code session data/',
    );
    const fleetWorkerCount = await fleetWorkerRows.count();
    const fleetEmptyCount = await fleetEmptyStates.count();

    check(
      'Fleet tab renders a real state (worker rows or a recognized empty/degraded state)',
      fleetWorkerCount > 0 || fleetEmptyCount > 0,
    );
    await window.screenshot({ path: join(artifactsDir, 'fleet.png') });

    if (fleetWorkerCount > 0) {
      // Real fleet data: exercise the click-to-select transcript wiring for real.
      const firstWorker = fleetWorkerRows.first();
      await firstWorker.click();
      await window.waitForTimeout(800);

      const transcriptPane = inner.locator('aside[aria-label^="Transcript for"]');
      check('clicking a Fleet worker row opens its transcript pane', (await transcriptPane.count()) > 0);
      check(
        'the selected worker row exposes aria-current="true"',
        (await firstWorker.getAttribute('aria-current')) === 'true',
      );

      const closeButton = inner.locator('button[aria-label="Close transcript"]');
      if ((await closeButton.count()) > 0) {
        await closeButton.first().click();
        await window.waitForTimeout(400);
        check(
          'closing the transcript pane removes it from the DOM',
          (await transcriptPane.count()) === 0,
        );
      }
    } else {
      check(
        'Fleet tab shows a recognized empty/degraded state when there is no worker data',
        fleetEmptyCount > 0,
      );
    }

    console.log(`› screenshots written to ${artifactsDir}`);
  } catch (error) {
    // Capture whatever is on screen; a blank webview is itself the diagnosis.
    await app
      .windows()[0]
      ?.screenshot({ path: join(artifactsDir, 'failure.png') })
      .catch(() => {});
    failures.push(`threw: ${error.message}`);
    console.error(error);
  } finally {
    await app.close().catch(() => {});
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await rm(extensionsDir, { recursive: true, force: true }).catch(() => {});
  }

  if (failures.length) {
    console.error(`\n✘ Webview test failed (${failures.length}):`);
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exit(1);
  }
  console.log('\n✔ Webview test passed.');
}

await main();
