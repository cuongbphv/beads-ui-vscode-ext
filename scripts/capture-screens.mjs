#!/usr/bin/env node
/**
 * Screenshot pass over the whole surface: dashboard tabs, the Epic → Task
 * sidebar, and the settings the extension contributes.
 *
 *   npm run capture                          # this repo's own tracker
 *   npm run capture:demo                     # the seeded Harbor workspace
 *   node scripts/capture-screens.mjs --workspace <dir> --id-prefix harbor-
 *
 * Shares the isolation rules of run-webview-test.mjs — throwaway profile, real
 * `bd` data, read-only — but reports nothing: it exists to produce images for a
 * human to look at, not to assert.
 *
 * Which workspace matters more than it sounds: shot against this repo, every
 * chart is 98% Done and the product photographs as finished. `--workspace`
 * exists so the README can show a project that is actually in flight —
 * see scripts/seed-demo-workspace.mjs.
 *
 * Two widgets fetch nothing until a user clicks something — the sync-status
 * chip's Refresh action and the health scorecard drawer's "Run checks" — so
 * this pipeline clicks them for real and waits for the result before
 * shooting `overview-health.png`, rather than shipping their empty states.
 * The Molecules tab gets its own real-data pass too, off the molecule
 * `npm run demo:seed` pours (see scripts/lib/molecule-demo-seed.mjs).
 */
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron } from 'playwright';

import { cleanEnv, scrubProcessEnv } from './lib/clean-env.mjs';
import { defaultDemoDir, DEMO_ID_PREFIX } from './lib/demo-workspace.mjs';
import { FORMULA_NAME as MOLECULE_FORMULA_NAME } from './lib/molecule-demo-seed.mjs';

const testVersion = process.env.VSCODE_TEST_VERSION ?? '1.105.0';
scrubProcessEnv();

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Committed, not dist/: these images are what README.md points at.
const outDir = join(repoRoot, 'docs', 'screenshots');

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

/** `--demo` is `--workspace <the seeded Harbor workspace>` without typing a path. */
const demo = argv.includes('--demo');

/** The folder the editor opens. Defaults to this repo, which is the fallback. */
const workspace = resolve(flag('--workspace') ?? (demo ? defaultDemoDir() : repoRoot));
/** Issue-id prefix, used to find a row to open the detail pane on. */
const idPrefix = flag('--id-prefix') ?? (demo ? DEMO_ID_PREFIX : 'beads-ui-vscode-ext-');

const LAUNCH_TIMEOUT = 180_000;

/**
 * VS Code's default chord for the Command Palette is `Ctrl+Shift+P` on
 * Windows/Linux but `Cmd+Shift+P` on macOS — hardcoding the former means every
 * keypress here silently no-ops on a Mac runner, hanging on `.quick-input-widget`
 * until its own wait times out with no clue why. Same fix as
 * `run-webview-test.mjs`'s `PALETTE_KEY`, ported here since this script has its
 * own separate `runCommand`.
 */
const PALETTE_KEY = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';

/** Run a command through the palette, the way a user would. */
async function runCommand(window, title) {
  await window.keyboard.press(PALETTE_KEY);
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
  console.log(`› launching an isolated editor on ${workspace}`);
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
      workspace,
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

  // Nothing is touched before the shots: the README should show what the
  // extension does on first open — closed issues on the board with the Done
  // column folded, and the Roadmap hiding them behind its own "N closed hidden"
  // chip. Posing the UI first would document a state no user starts in.
  for (const tab of ['Overview', 'Roadmap', 'Board']) {
    await inner.locator(`[role="tab"]:has-text("${tab}")`).first().click();
    await shot(window, tab.toLowerCase());

    if (tab === 'Overview') {
      await inner.locator('section[aria-label="Ready to start"]').evaluate((section) => {
        section.scrollIntoView({ block: 'start' });
        section.closest('[class*="overflow-y-auto"]')?.scrollBy(0, -24);
      });
      await shot(window, 'overview-ready');
    }

    if (tab === 'Board') {
      await inner.getByRole('button', { name: /Ready only/ }).click();
      await shot(window, 'board-ready');
      await inner.getByRole('button', { name: /Ready only/ }).click();
      // Swimlanes: 'board' above is the default, unposed view. Toggle the
      // taxonomy-lane grouping on for a second shot, then back off — leaving
      // it on would pose Board differently for anything that revisits the tab
      // later (there isn't anything today, but this is cheap insurance).
      const swimlaneToggle = inner.getByRole('button', { name: 'Swimlanes' });
      await swimlaneToggle.click();
      await shot(window, 'board-swimlanes');
      await swimlaneToggle.click();
    }
  }

  // ── Overview: sync-status chip refreshed, health scorecard run ─────────────
  // Both are fetch-on-demand by design (see sync-status-chip.tsx and
  // health-scorecard.tsx's own doc comments) — no mount effect, no poll-tick
  // subscription. A plain capture only ever shows the chip absent (nothing
  // fetched yet) and the drawer's "No checks run yet" empty state. Trigger
  // the real user actions and wait for them to settle before shooting, rather
  // than documenting a state no one who has clicked anything ever sees. This
  // runs after the unposed Overview/Roadmap/Board shots above so it never
  // poses those.
  await inner.locator('[role="tab"]:has-text("Overview")').first().click();
  await window.waitForTimeout(400);

  await inner.locator('button[title="Refresh from bd"]').first().click();
  await inner.locator('[data-testid="sync-mode"]').first().waitFor({ timeout: 20_000 });

  await inner.getByRole('button', { name: 'Project health' }).click();
  await inner.getByRole('button', { name: 'Run checks', exact: true }).click();
  await window.waitForTimeout(300);
  // The button's own label is the settle signal: `HealthScorecard` renders
  // "Running checks…" only while `loading` is true, "Run checks" once the
  // call lands either way (success or error) — no report-shaped text to
  // wait on that would break if every check comes back clean.
  await inner.getByRole('button', { name: 'Run checks', exact: true }).waitFor({ timeout: 30_000 });
  // The stat-tile grid renders as soon as the report lands, but the drawer
  // sits below Overview's own (long) ready/blocked lists — without scrolling
  // it into frame the shot would only ever catch the "Run checks · Checked…"
  // row, not the populated tiles that are the whole point of this capture.
  await inner.locator('section[aria-label="Project health"]').scrollIntoViewIfNeeded();
  await shot(window, 'overview-health');

  // ── Graph: the dependency DAG, folded into Roadmap as a third shape ─────────
  // (Graph used to be its own top-level tab; it is now a `ShapeButton` inside
  // Roadmap alongside Timeline/List — see RoadmapView.tsx.)
  await inner.locator('[role="tab"]:has-text("Roadmap")').first().click();
  await window.waitForTimeout(300);
  await inner.getByRole('button', { name: 'Graph', exact: true }).click();
  await shot(window, 'graph');

  // A selected issue opens the detail pane, which is its own layout branch —
  // switch back to the Timeline shape first, since the task-row selector
  // below only matches Timeline's rendering. `exact: true` on both: the
  // Graph shape's own SVG nodes carry aria-labels like "…on the deploy
  // timeline", which a substring match on "Timeline" would also catch.
  await inner.getByRole('button', { name: 'Timeline', exact: true }).click();
  await window.waitForTimeout(600);
  // Task rows title their button "<id>: <title>"; epic rows carry only a title,
  // so the prefix is what separates a task row from its epic.
  await inner
    .locator(`button[title^="${idPrefix}"]`)
    .first()
    .click({ timeout: 10_000 })
    .catch(() => {});
  await shot(window, 'roadmap-detail');

  // The comment/append-note composer lives at the bottom of the detail pane —
  // always rendered (so it is reachable with zero comments), but below the
  // fold on first open. Scroll it into frame for a shot dedicated to it,
  // rather than assuming roadmap-detail.png caught it by accident.
  const commentDraft = inner.getByPlaceholder('Write a comment…');
  await commentDraft.scrollIntoViewIfNeeded().catch(() => {});
  await shot(window, 'detail-comments');

  // ── Fleet: the worker/worktree list, then one worker's live transcript ─────
  // `npm run demo:seed` seeds a real wt-* worktree and a real
  // ~/.claude/projects/<encoded-cwd> session/worker pair for this — see
  // scripts/lib/fleet-demo-seed.mjs — so this is the same discovery path a
  // real fleet uses, not a fixture the extension is told to trust.
  await inner.locator('[role="tab"]:has-text("Fleet")').first().click();
  await window.waitForTimeout(600);
  await inner.getByRole('button', { name: /^(?:Claude Code|Codex) worker /i }).first().click();
  await window.waitForTimeout(600);
  await shot(window, 'fleet');
  await inner.locator('details:has(summary:has-text("Tool result"))').first().locator('summary').click();
  await shot(window, 'fleet-transcript');

  // ── Molecules: bd mol cards, gates, and a step list in 5 distinct states ───
  // `npm run demo:seed` pours a real molecule via `bd mol distill`/`bd mol
  // pour` (see scripts/lib/molecule-demo-seed.mjs) — same discovery path a
  // real molecule uses, not a fixture the extension is told to trust. Against
  // a workspace with no molecules (e.g. this repo's own tracker without
  // `--demo`), the tab's own empty state is what gets shot instead, which is
  // still the real, correct rendering for that project.
  await inner.locator('[role="tab"]:has-text("Molecules")').first().click();
  // `getMolSnapshot` fans out to several `bd mol`/`bd gate` reads (see its
  // own doc comment in queries.ts) — slower than a tab switch, so a fixed
  // wait here caught the tab mid-`Skeleton` on the first attempt. Wait for
  // whichever real outcome actually lands: a molecule card, or (against a
  // workspace with none, e.g. this repo's own tracker without `--demo`) the
  // tab's own empty state — either is the real, correct rendering to shoot.
  const moleculeCardLocator = inner.locator('article[role="button"]', {
    hasText: MOLECULE_FORMULA_NAME,
  });
  await Promise.race([
    moleculeCardLocator.first().waitFor({ timeout: 20_000 }),
    inner.getByText('No molecules in this project').waitFor({ timeout: 20_000 }),
  ]).catch(() => {});
  await shot(window, 'molecules');

  const moleculeCard = moleculeCardLocator.first();
  if (await moleculeCard.count().catch(() => 0)) {
    await moleculeCard.click();
    // Same fetch-then-render gap as above, for `useMolDetail`'s `showMolecule`
    // call — wait for an actual step row rather than a fixed timeout that
    // would just as easily catch the step list's own loading `Skeleton`.
    await inner
      .locator(`section[aria-label="${MOLECULE_FORMULA_NAME} steps"] article`)
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => {});
    await shot(window, 'molecules-detail');
  }

  // ── Settings the extension contributes ─────────────────────────────────────
  await runCommand(window, 'Preferences: Open Settings (UI)');
  await window.locator('.settings-editor').waitFor({ state: 'visible' });
  // The settings editor focuses its search box on open, and the box itself is a
  // suggest-widget whose markup moves between releases — type instead of
  // pinning a selector.
  await window.waitForTimeout(800);
  await window.keyboard.type('beadsDashboard');
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
