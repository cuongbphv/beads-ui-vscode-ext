#!/usr/bin/env node
/**
 * Screenshot pass over the whole surface: dashboard tabs, the Epic → Task
 * sidebar, and the settings the extension contributes.
 *
 *   npm run capture
 *
 * Shares the isolation rules of run-webview-test.mjs — throwaway profile, real
 * `bd` data, read-only — but reports nothing: it exists to produce images for a
 * human to look at, not to assert.
 */
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron } from 'playwright';

import { cleanEnv, scrubProcessEnv } from './lib/clean-env.mjs';

const testVersion = process.env.VSCODE_TEST_VERSION ?? '1.105.0';
scrubProcessEnv();

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Committed, not dist/: these images are what README.md points at.
const outDir = join(repoRoot, 'docs', 'screenshots');

const LAUNCH_TIMEOUT = 180_000;

/** Run a command through the palette, the way a user would. */
async function runCommand(window, title) {
  await window.keyboard.press('Control+Shift+P');
  await window.locator('.quick-input-widget').waitFor({ state: 'visible' });
  await window.locator('.quick-input-box input').fill(`>${title}`);
  await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
  await window.keyboard.press('Enter');
  await window.locator('.quick-input-widget').waitFor({ state: 'hidden' }).catch(() => {});
}

async function shot(window, name) {
  await window.waitForTimeout(1200);
  const path = join(outDir, `${name}.png`);
  await window.screenshot({ path });
  console.log(`  ▸ ${name}.png`);
}

const app = await (async () => {
  await mkdir(outDir, { recursive: true });
  console.log(`› resolving VS Code ${testVersion}`);
  const executablePath = await downloadAndUnzipVSCode(testVersion);
  const profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-profile-'));
  const extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-exts-'));
  console.log('› launching an isolated editor');
  const launched = await _electron.launch({
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
  launched.cleanup = async () => {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await rm(extensionsDir, { recursive: true, force: true }).catch(() => {});
  };
  return launched;
})();

try {
  const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT });
  window.setDefaultTimeout(90_000);
  await window.locator('.monaco-workbench').waitFor({ state: 'visible' });

  // The default 1440×900 leaves the dashboard cramped next to the sidebar and
  // the chat pane; widen so the detail pane docks rather than covering.
  await window.setViewportSize({ width: 1680, height: 1000 }).catch(() => {});

  // Dismiss the "extensions are disabled" toast so it stops covering content.
  await window
    .locator('.notifications-toasts .codicon-notifications-clear')
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});

  // The Chat pane opens by default and eats ~20% of the width in every shot.
  // Close it via the palette, then fall back to its own close button — the
  // command title has moved between releases, the button has not.
  await runCommand(window, 'View: Close Secondary Side Bar').catch(() => {});
  const auxBar = window.locator('.part.auxiliarybar');
  if (await auxBar.isVisible().catch(() => false)) {
    await auxBar.locator('.codicon-close').first().click({ timeout: 5000 }).catch(() => {});
  }
  await window.waitForTimeout(500);

  // ── Sidebar: the Epic → Task tree ──────────────────────────────────────────
  const beadsActivity = window.locator('.activitybar .action-item[aria-label*="Beads" i]').first();
  await beadsActivity.waitFor({ state: 'visible' });
  await beadsActivity.click();
  await window.locator('.pane-body .monaco-list-row').first().waitFor();
  await shot(window, 'sidebar-tree-collapsed');

  // Expand the first few epics so the hierarchy is actually visible.
  for (let i = 0; i < 4; i += 1) {
    const twistie = window.locator('.pane-body .monaco-tl-twistie.collapsed').first();
    if ((await twistie.count()) === 0) break;
    await twistie.click().catch(() => {});
    await window.waitForTimeout(400);
  }
  await shot(window, 'sidebar-tree-expanded');

  // ── Dashboard ──────────────────────────────────────────────────────────────
  await runCommand(window, 'Beads: Open Dashboard');
  const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');
  await inner.locator('text=/\\d+\\s+issues/').first().waitFor();

  // App.tsx defaults the query to `includeClosed: false`, which hides finished
  // work — a milestone then shows only its leftovers and reads as barely
  // started. Tick "Closed" so every screenshot shows the full task list.
  //
  // The filter bar lives in RoadmapView and BoardView, not OverviewView, so the
  // toggle has to be reached from Roadmap first. `query` is App-level state, so
  // ticking it once also applies to Board. Overview reads `snapshot` and is
  // unaffected either way.
  await inner.locator('[role="tab"]:has-text("Roadmap")').first().click();
  const closedToggle = inner.locator('label:has-text("Closed") input[type="checkbox"]').first();
  await closedToggle.waitFor({ state: 'visible' });
  if (!(await closedToggle.isChecked())) {
    await closedToggle.check();
    await window.waitForTimeout(600);
  }

  for (const tab of ['Overview', 'Roadmap', 'Board']) {
    await inner.locator(`[role="tab"]:has-text("${tab}")`).first().click();
    await shot(window, tab.toLowerCase());
  }

  // A selected issue opens the detail pane, which is its own layout branch.
  await inner.locator('[role="tab"]:has-text("Roadmap")').first().click();
  await window.waitForTimeout(600);
  await inner
    .locator('text=/beads-ui-vscode-ext-/')
    .first()
    .click({ timeout: 10_000 })
    .catch(() => {});
  await shot(window, 'roadmap-detail');

  // ── Settings the extension contributes ─────────────────────────────────────
  await runCommand(window, 'Preferences: Open Settings (UI)');
  await window.locator('.settings-editor').waitFor({ state: 'visible' });
  // The settings editor focuses its search box on open, and the box itself is a
  // suggest-widget whose markup moves between releases — type instead of
  // pinning a selector.
  await window.waitForTimeout(800);
  await window.keyboard.type('beadsUi');
  await window.locator('.settings-editor .setting-item').first().waitFor();
  await shot(window, 'settings');

  console.log(`\n✔ screenshots in ${outDir}`);
} catch (error) {
  // A failure shot is a debugging artifact, not documentation — keep it out of
  // the committed screenshot directory.
  const failureDir = join(repoRoot, 'dist', 'test-artifacts');
  await mkdir(failureDir, { recursive: true }).catch(() => {});
  await app
    .windows()[0]
    ?.screenshot({ path: join(failureDir, 'capture-failure.png') })
    .catch(() => {});
  console.error('\n✘ capture failed');
  console.error(error);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  await app.cleanup();
}
