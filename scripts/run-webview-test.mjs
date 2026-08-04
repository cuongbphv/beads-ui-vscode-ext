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
 * count must equal `bd stats`, so a webview that paints an empty or stale board
 * fails here rather than looking fine in a screenshot.
 *
 * Isolated on purpose: `--user-data-dir` / `--extensions-dir` point at a temp
 * profile, so the editor window you already have open is never touched and no
 * reload is needed. Nothing here mutates the beads database.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

/** Ground truth, read straight from the CLI rather than from the extension. */
async function bdStats() {
  const options = {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, BD_JSON_ENVELOPE: '0' },
  };
  let stdout;
  try {
    ({ stdout } = await execFileAsync('bd', ['stats', '--json'], options));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ({ stdout } = await execFileAsync('bd', ['stats', '--json'], { ...options, shell: true }));
  }
  const raw = JSON.parse(stdout);
  return raw.summary ?? raw;
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
  console.log(`› bd reports ${stats.total_issues} issues (${stats.ready_issues} ready)`);

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
      '--disable-extensions',
      '--disable-workspace-trust',
      '--disable-gpu',
      '--no-sandbox',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-updates',
      repoRoot,
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
    await window.keyboard.press('Control+Shift+P');
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
      `header issue count matches bd (${rendered} vs ${stats.total_issues})`,
      rendered === stats.total_issues,
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

    // The sidebar is the other half of the UI. It is two views now — "Needs
    // You" and "Epics & Milestones" — so the headings are pane titles, and
    // "Unassigned" rides inside the plan view as its triage queue.
    await window.keyboard.press('Control+Shift+P');
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

    await window.screenshot({ path: join(artifactsDir, 'sidebar.png') });

    // Collapse the side bars so the screenshots show the dashboard, not the
    // explorer. Ctrl+B is the primary side bar, Ctrl+Alt+B the secondary one.
    await window.keyboard.press('Control+B');
    await window.keyboard.press('Control+Alt+B');
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
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    }

    await inner.locator('[role="tab"]:has-text("Roadmap")').first().click();
    await window.waitForTimeout(1500);
    await window.screenshot({ path: join(artifactsDir, 'roadmap.png') });

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
