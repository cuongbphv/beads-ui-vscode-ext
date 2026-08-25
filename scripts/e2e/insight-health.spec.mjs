#!/usr/bin/env node
/**
 * End-to-end insight & health suite (Epic C coverage, bead
 * beads-ui-vscode-ext-9e9.6).
 *
 *   npm run test:e2e:insight
 *
 * Launches a real VS Code, with this extension loaded, against a throwaway
 * `bd` project and drives the rendered webview through: the blocker
 * inspector's transitive "Blocked by" chain, the on-demand health scorecard's
 * "Run checks" flow (all four checks, plus a drill-down into a real,
 * non-empty one), the "Change history" timeline after a real edit, and the
 * server-side search fallback that only exists once the workspace is
 * genuinely truncated. Every mutation and every rendered fact is
 * cross-checked against `bd` directly.
 *
 * ── Why an isolated scratch project (not this repo's real board) ──
 * Same reasoning as `scripts/e2e/editing-suite.spec.mjs` (bead 9e9.4): a
 * `mkdtemp`'d temp dir, `bd init --non-interactive` inside it, opened as the
 * VS Code workspace. `src/extension/workspace.ts` resolves "the beads
 * workspace" purely by `fs.stat`-ing `<folder>/.beads`, so a freshly-init'd
 * scratch folder activates the extension exactly like a real project would,
 * fully isolated from this repo's own board. Cleanup is just deleting the
 * directory.
 *
 * ── Why this file repeats run-webview-test.mjs/editing-suite's harness ──
 * Per the epic's own recorded decision (beads-ui-vscode-ext-9e9's `design`
 * field): "E2E goes deep with one dedicated script file per epic to allow
 * safe parallel batching." Sibling spec files exist per epic; importing a
 * shared "harness" module would make every agent editing their own epic's
 * spec collide on the same file. The one thing still imported rather than
 * copied is `scripts/lib/clean-env.mjs` — not test logic, and nobody editing
 * their own epic's spec ever needs to change it.
 *
 * ── Why `beadsDashboard.issueLimit` is pinned to 50, not left at 2000 ──
 * `snapshot.truncated` (`BdQueries.snapshot` in `src/extension/bd/queries.ts`)
 * is `beads.length >= limit`, and `limit` comes straight from the
 * `beadsDashboard.issueLimit` workspace setting (`src/extension/store.ts`).
 * Forcing a *real* truncation at the setting's real-world default of 2000
 * would mean creating 2000 real issues just to make one RPC exist — instead
 * this suite writes a workspace-scoped `.vscode/settings.json` pinning the
 * setting to 50, which is that setting's own JSON-schema `minimum`
 * (`package.json`'s `contributes.configuration`) — the cheapest value that
 * is still a legitimate, in-range configuration a real user could set. Then
 * it creates enough real issues to cross that real threshold. Nothing about
 * `snapshot.truncated` or the server-search activation condition is faked;
 * only the size of "enough issues" is made cheap.
 *
 * ── Blocker-chain edge direction, verified live before writing this file ──
 * `bd dep add A B --type=blocks` makes A *depend on* B (bd's own --help:
 * "issue-123 depends on (is blocked by) the specified issue") — so B is what
 * blocks A. Confirmed by creating a real 3-node chain in a throwaway
 * directory and reading `bd show`'s JSON back: `A.dependencies` contains B
 * with `dependency_type: "blocks"`, `B.dependencies` contains C the same
 * way. `buildBlockerChain` (src/shared/blocker-chain.ts) walks exactly that
 * direction from the inspected bead outward, so this suite wires N1 → N2 →
 * N3 (N1 depends on N2, N2 depends on N3) and expects N1's "Blocked by"
 * section to list N2 at depth 1 and N3 at depth 2.
 *
 * ── Health scorecard: what "one failing check" coverage actually means here ──
 * The bead's own description asks for "per-check results without blanking
 * on one failing check". All four checks this drawer fans out to (`bd
 * stale`, `bd orphans`, `bd lint`, `bd dep cycles`) are simple, deterministic,
 * read-only local Dolt reads with no discovered real failure mode against a
 * healthy scratch project — forcing one to actually error (`ok: false`)
 * would require corrupting the scratch project's own database, which risks
 * destabilizing every other check in this suite for a condition no real user
 * hits by clicking "Run checks". Per this bead's own "don't fake it"
 * discipline (applied here to *any* check outcome, not only the search
 * truncation condition it was written about), this suite does not fake an
 * `ok: false` state. Instead it exercises the real, heterogeneous result the
 * fixture issues naturally produce: `stale`/`orphans`/`cycles` genuinely
 * empty (`ok: true`, 0 items — the same "success" tile rendering an
 * artificially-failed check would otherwise be confused with), and `lint`
 * genuinely non-empty (every fixture issue is a bare `task` with no
 * "Acceptance Criteria" section, which `bd lint` really does flag) —
 * asserting all four tiles render side by side, plus drilling into the one
 * with real findings. This is a real gap in coverage of the `ok: false`
 * rendering path specifically; see the handoff notes for why it was left
 * this way rather than guessed at.
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

/**
 * The `beadsDashboard.issueLimit` value this run pins the scratch workspace
 * to — see the module doc's "Why `beadsDashboard.issueLimit` is pinned to
 * 50" section. Must match the setting's real JSON-schema `minimum` in
 * `package.json`, not just any small number, so the configuration this
 * suite exercises is one a real user could actually save.
 */
const ISSUE_LIMIT = 50;
/**
 * Comfortably more than `ISSUE_LIMIT` once summed with this run's four fixed
 * fixture issues (the blocker chain's three plus the history target), so
 * several fillers are guaranteed to land outside `bd list --all --limit
 * ISSUE_LIMIT`'s loaded window regardless of bd's internal sort order:
 * (55 fillers + 4 fixtures) − 50 loaded = 9 excluded, of which at most 4 can
 * be fixtures, so at least 5 fillers are always excluded.
 */
const FILLER_COUNT = 55;

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

async function bdList(cwd, args) {
  const { stdout } = await execBd(cwd, ['list', ...args]);
  return JSON.parse(stdout);
}

async function bdCreate(cwd, title, extraArgs = []) {
  const { stdout } = await execBd(cwd, ['create', title, '--json', ...extraArgs]);
  return JSON.parse(stdout).id;
}

/**
 * `bd`'s two accepted dependency-edge shapes, normalised — same idea as
 * editing-suite's `hasEdgeTo`, extended to also check the edge's kind (this
 * suite needs to confirm not just *that* an edge exists but that it is
 * specifically a `blocks` edge, since that is what `buildBlockerChain` walks).
 */
function edgeTargetId(edge) {
  return edge.id ?? edge.depends_on_id;
}
function edgeKind(edge) {
  return edge.type ?? edge.dependency_type;
}
function hasBlocksEdgeTo(dependencies, targetId) {
  return (dependencies ?? []).some(
    (edge) => edgeTargetId(edge) === targetId && edgeKind(edge) === 'blocks',
  );
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
  const scratchRoot = await mkdtemp(join(tmpdir(), 'beads-ui-e2e-insight-'));
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

  console.log(`› pinning beadsDashboard.issueLimit to ${ISSUE_LIMIT} (workspace-scoped)`);
  await mkdir(join(scratchRoot, '.vscode'), { recursive: true });
  await writeFile(
    join(scratchRoot, '.vscode', 'settings.json'),
    JSON.stringify({ 'beadsDashboard.issueLimit': ISSUE_LIMIT }, null, 2),
    'utf8',
  );

  console.log('› building a real 3-deep blocker chain via bd directly (N1 depends on N2 depends on N3)');
  const runId = Date.now();
  const n1Id = await bdCreate(scratchRoot, `E2E blocker N1 top ${runId}`);
  const n2Id = await bdCreate(scratchRoot, `E2E blocker N2 mid ${runId}`);
  const n3Id = await bdCreate(scratchRoot, `E2E blocker N3 bottom ${runId}`);
  await execBd(scratchRoot, ['dep', 'add', n1Id, n2Id, '--type=blocks']);
  await execBd(scratchRoot, ['dep', 'add', n2Id, n3Id, '--type=blocks']);

  console.log('› creating a dedicated issue for the history-timeline test');
  const historyId = await bdCreate(scratchRoot, `E2E history target ${runId}`);

  console.log(`› resolving VS Code ${testVersion}`);
  const executablePath = await downloadAndUnzipVSCode(testVersion);

  const profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-insight-profile-'));
  const theme = process.env.BEADS_TEST_THEME ?? 'Default Dark Modern';
  await mkdir(join(profileDir, 'User'), { recursive: true });
  await writeFile(
    join(profileDir, 'User', 'settings.json'),
    JSON.stringify({ 'workbench.colorTheme': theme, 'window.commandCenter': false }, null, 2),
    'utf8',
  );
  const extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-insight-exts-'));

  console.log('› launching an isolated editor against the scratch project');
  const app = await _electron.launch({
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

  try {
    const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT });
    window.setDefaultTimeout(UI_TIMEOUT);
    await window.locator('.monaco-workbench').waitFor({ state: 'visible' });
    console.log('› workbench is up');

    // Wide enough that the Board renders every column at once, and the detail
    // pane splits beside the tab content rather than overlaying it — same
    // reasoning as editing-suite.spec.mjs.
    await app.evaluate(({ BrowserWindow }) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) return;
      main.unmaximize();
      main.setBounds({ x: 0, y: 0, width: 1600, height: 1000 });
      main.maximize();
    });
    await window.waitForTimeout(800);

    /** Drives the command palette by keyboard, same as editing-suite.spec.mjs. */
    async function runPaletteCommand(label) {
      await window.keyboard.press(PALETTE_KEY);
      const box = window.locator('.quick-input-box input');
      await box.waitFor({ state: 'visible' });
      await box.fill(`>${label}`);
      await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
      await window.keyboard.press('Enter');
      await window.waitForTimeout(300);
    }

    await runPaletteCommand('Beads: Open Dashboard');
    const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');

    const header = inner.locator('text=/\\d+\\s+issues/');
    await header.first().waitFor();

    /**
     * `Beads: Refresh` — forces `BeadsStore.refresh()` unconditionally.
     * Needed after any mutation made directly via `bd` (bypassing the
     * webview) — see editing-suite.spec.mjs's identical helper's doc for why
     * the extension's own automatic post-mutation refresh cannot be trusted
     * to have landed by the time this script's next assertion runs (known
     * debt: bead 9e9.9).
     */
    async function refreshDashboard() {
      await runPaletteCommand('Beads: Refresh');
      await window.waitForTimeout(1000);
    }

    /** Opens the Board tab and clicks a card by id (bead-card.tsx: `aria-label="${id}: ${title}"`). */
    async function selectCard(id) {
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

    /** Closes the detail pane and settles, same as editing-suite.spec.mjs between tests. */
    async function closeDetail() {
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    }

    // =================================================================
    // Test 1: the blocker inspector renders a real transitive chain
    // (N1 is blocked by N2 directly, and by N3 transitively through N2)
    // =================================================================
    console.log('› test 1: blocker inspector renders the transitive blocker chain');
    const detail1 = await selectCard(n1Id);
    // `Section` (bead-detail.tsx) renders `<h3>{icon}Blocked by</h3><ul>…</ul>`
    // as siblings under the same `<section>` — `locator.filter({has: …})`
    // scoped to an inner locator built from a *different* root locator
    // (`detail1`, not the candidate `section` itself) does not actually
    // scope the match here (confirmed empirically: it returns 0 matches even
    // against a `Blocked by` section proven present via a raw innerHTML
    // dump), so this walks from the heading to its sibling `<ul>` via xpath
    // instead of trying to filter the section from the outside in.
    const blockedByHeading = detail1.locator('h3', { hasText: 'Blocked by' });
    await blockedByHeading.first().waitFor();
    const blockedByList = blockedByHeading.locator('xpath=following-sibling::ul[1]');
    await blockedByList.first().waitFor();

    const n2Row = blockedByList.getByRole('button', { name: new RegExp(n2Id) });
    const n3Row = blockedByList.getByRole('button', { name: new RegExp(n3Id) });
    await n2Row.first().waitFor({ timeout: 10_000 }).catch(() => {});
    await n3Row.first().waitFor({ timeout: 10_000 }).catch(() => {});
    check(
      'the direct blocker (N2, depth 1) renders in the Blocked-by chain',
      (await n2Row.count()) > 0,
      `looked for a row mentioning ${n2Id} under "Blocked by"`,
    );
    check(
      'the transitive blocker (N3, depth 2, reached only through N2) renders in the Blocked-by chain',
      (await n3Row.count()) > 0,
      `looked for a row mentioning ${n3Id} under "Blocked by"`,
    );

    // Cross-check the chain's two edges against bd directly.
    const n1Show = await bdShow(scratchRoot, n1Id);
    check(
      'bd show agrees N1 depends on (is blocked by) N2 via a blocks edge',
      hasBlocksEdgeTo(n1Show?.dependencies, n2Id),
      `bd show dependencies: ${JSON.stringify(n1Show?.dependencies)}`,
    );
    const n2Show = await bdShow(scratchRoot, n2Id);
    check(
      'bd show agrees N2 depends on (is blocked by) N3, closing the transitive chain',
      hasBlocksEdgeTo(n2Show?.dependencies, n3Id),
      `bd show dependencies: ${JSON.stringify(n2Show?.dependencies)}`,
    );

    await closeDetail();

    // =================================================================
    // Test 2: the health scorecard runs its four checks on demand and
    // renders per-check results — including a real, non-empty one (Lint,
    // since every fixture issue so far is a bare task with no Acceptance
    // Criteria section) alongside three real, genuinely-empty ones. See the
    // module doc's "Health scorecard" section for why an actually-failing
    // (`ok: false`) check is not exercised here.
    // =================================================================
    console.log('› test 2: health scorecard runs checks and renders per-check results');
    await inner.locator('[role="tab"]:has-text("Overview")').first().click();
    await window.waitForTimeout(500);

    const healthSection = inner.locator('section[aria-label="Project health"]');
    await healthSection.first().waitFor();
    await healthSection.getByRole('button', { name: 'Project health' }).click();
    await healthSection.getByRole('button', { name: 'Run checks' }).click();

    const tiles = healthSection.locator('.card-raise');
    await pollUntil(
      () => tiles.count(),
      (count) => count >= 4,
      (ms) => window.waitForTimeout(ms),
      20_000,
    );
    check('all four health-check tiles rendered', (await tiles.count()) >= 4, `saw ${await tiles.count()} tiles`);

    async function tileValue(label) {
      const tile = tiles.filter({ hasText: label });
      await tile.first().waitFor();
      return (await tile.first().locator('p').first().innerText()).trim();
    }

    const [staleRaw, orphansRaw, lintRaw, cyclesRaw] = await Promise.all([
      execBd(scratchRoot, ['stale', '--days', '30', '--json']).then((r) => JSON.parse(r.stdout)),
      execBd(scratchRoot, ['orphans', '--json']).then((r) => JSON.parse(r.stdout)),
      execBd(scratchRoot, ['lint', '--json']).then((r) => JSON.parse(r.stdout)),
      execBd(scratchRoot, ['dep', 'cycles', '--json']).then((r) => JSON.parse(r.stdout)),
    ]);
    const staleCount = Array.isArray(staleRaw) ? staleRaw.length : 0;
    const orphansCount = Array.isArray(orphansRaw) ? orphansRaw.length : 0;
    const lintResults = Array.isArray(lintRaw?.results) ? lintRaw.results : [];
    const cyclesCount = Array.isArray(cyclesRaw) ? cyclesRaw.length : 0;

    check(
      'Stale tile value matches bd stale --days 30 --json directly',
      (await tileValue('Stale')) === String(staleCount),
      `expected "${staleCount}"`,
    );
    check(
      'Orphans tile value matches bd orphans --json directly',
      (await tileValue('Orphans')) === String(orphansCount),
      `expected "${orphansCount}"`,
    );
    check(
      'Lint tile value matches bd lint --json directly (a real, non-empty result)',
      (await tileValue('Lint')) === String(lintResults.length) && lintResults.length > 0,
      `expected "${lintResults.length}" (>0)`,
    );
    check(
      'Dep cycles tile value matches bd dep cycles --json directly',
      (await tileValue('Dep cycles')) === String(cyclesCount),
      `expected "${cyclesCount}"`,
    );

    // Drill into the one real, non-empty check: every fixture issue created
    // so far should appear in bd's own lint findings, and in the UI's
    // drill-down once that tile is clicked.
    const lintTile = tiles.filter({ hasText: 'Lint' });
    await lintTile.first().click();
    const lintFindingIds = new Set(lintResults.map((finding) => finding.id));
    check(
      'bd lint really flagged every fixture issue (bare tasks, no Acceptance Criteria)',
      [n1Id, n2Id, n3Id, historyId].every((id) => lintFindingIds.has(id)),
      `bd lint ids: ${JSON.stringify([...lintFindingIds])}`,
    );
    for (const id of [n1Id, n2Id, n3Id, historyId]) {
      const row = healthSection.getByText(id, { exact: false });
      check(
        `lint drill-down renders a row for ${id}`,
        (await row.count()) > 0,
        `looked for ${id} in the Lint drill-down`,
      );
    }

    // =================================================================
    // Test 3: the Change-history timeline shows a real edit's diff
    // =================================================================
    console.log('› test 3: change-history timeline shows a real edit');
    const detail3 = await selectCard(historyId);
    const beforeShow = await bdShow(scratchRoot, historyId);
    check('history target starts at the default priority (P2)', beforeShow?.priority === 2, `bd show priority: ${beforeShow?.priority}`);

    // The Priority `<select>` is only *implicitly* labelled (a wrapping
    // `<label>` with the text in a `<span>`, no `htmlFor`/`id` pair) —
    // confirmed empirically that `getByLabel` does not resolve that pattern
    // here (it returns zero matches even though the label/control nesting is
    // exactly what the accname spec describes), so this locates the select
    // via its wrapping label's text instead.
    await detail3.locator('label:has-text("Priority") select').selectOption('0');

    const afterPriorityChange = await pollUntil(
      () => bdShow(scratchRoot, historyId),
      (bead) => bead?.priority === 0,
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'priority edit round-trips through setPriority (bd show agrees)',
      afterPriorityChange?.priority === 0,
      `bd show priority: ${afterPriorityChange?.priority}`,
    );

    await refreshDashboard();
    const historyToggle = detail3.getByRole('button', { name: 'Change history' });
    await historyToggle.waitFor();
    await historyToggle.click();

    // Same reasoning as test 1's `blockedByList`: walk from the toggle button
    // to its sibling `<div>` (only rendered once `historyOpen`) rather than
    // scoping a `section`/`{has: …}` locator, which does not reliably scope
    // here. The rows list sits inside that div, one level deeper.
    const historyRows = historyToggle.locator('xpath=following-sibling::div[1]//ul/li');
    await pollUntil(
      () => historyRows.count(),
      (count) => count > 0,
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    const historyRowCount = await historyRows.count();
    check('at least one HistoryEvent row renders after the edit', historyRowCount > 0, `saw ${historyRowCount} rows`);
    const historyText = historyRowCount > 0 ? await historyRows.first().innerText() : '';
    check(
      'the rendered history row describes the priority change',
      /priority/i.test(historyText),
      `row text: "${historyText}"`,
    );

    // Cross-check directly against `bd history` — newest commit first, so
    // element 0 is the P0 write and element 1 is the original P2 create.
    const { stdout: historyRaw } = await execBd(scratchRoot, ['history', historyId, '--json']);
    const historyEntries = JSON.parse(historyRaw);
    check(
      'bd history reports at least two commits (create + the priority edit)',
      Array.isArray(historyEntries) && historyEntries.length >= 2,
      `bd history entries: ${historyEntries?.length}`,
    );
    check(
      'bd history agrees the newest commit set priority to 0',
      historyEntries?.[0]?.Issue?.priority === 0,
      `newest commit priority: ${historyEntries?.[0]?.Issue?.priority}`,
    );
    check(
      'bd history agrees the previous commit had priority 2',
      historyEntries?.[1]?.Issue?.priority === 2,
      `previous commit priority: ${historyEntries?.[1]?.Issue?.priority}`,
    );

    await closeDetail();

    // =================================================================
    // Test 4: server-side search only activates once the workspace is
    // genuinely truncated, and then finds a real result bd itself confirms
    // exists — see the module doc's "Why beadsDashboard.issueLimit is
    // pinned to 50" section for why this is real truncation, not a fake one.
    // =================================================================
    console.log(`› test 4: forcing real truncation with ${FILLER_COUNT} filler issues, then searching past it`);
    const fillerIds = [];
    for (let i = 0; i < FILLER_COUNT; i++) {
      const idx = String(i).padStart(3, '0');
      const title = `E2E filler run${runId}-idx-${idx}`;
      // eslint-disable-next-line no-await-in-loop -- bd has no bulk-create path this suite can rely on being stable; sequential keeps each id traceable to its title.
      const id = await bdCreate(scratchRoot, title);
      fillerIds.push({ id, title, idx });
    }

    await refreshDashboard();
    const truncatedBadge = inner.getByText('truncated', { exact: true });
    await truncatedBadge.first().waitFor({ timeout: 10_000 }).catch(() => {});
    check(
      'the header shows the "truncated" badge once the workspace exceeds beadsDashboard.issueLimit',
      (await truncatedBadge.count()) > 0,
      'no "truncated" badge appeared in the header',
    );

    // Which ids `bd list --all --limit ISSUE_LIMIT --json` actually loads is
    // bd's own sort order, not this script's to assume — so ask it directly,
    // then pick any filler NOT in that loaded set as the search target. The
    // module doc's arithmetic guarantees at least 5 such fillers exist.
    const loaded = await bdList(scratchRoot, ['--all', '--limit', String(ISSUE_LIMIT), '--json']);
    const loadedIds = new Set(loaded.map((issue) => issue.id));
    const hiddenFiller = fillerIds.find((filler) => !loadedIds.has(filler.id));
    if (!hiddenFiller) {
      throw new Error(
        `every filler landed inside the loaded window (loaded ${loaded.length} of ${fillerIds.length + 4} total) — the truncation arithmetic in the module doc no longer holds`,
      );
    }
    check(
      `a filler issue (${hiddenFiller.id}) is confirmed excluded from the loaded window`,
      true,
      `loaded ${loaded.length} issues via bd list --all --limit ${ISSUE_LIMIT}`,
    );

    await inner.locator('[role="tab"]:has-text("Board")').first().click();
    await window.waitForTimeout(500);
    const searchText = `idx-${hiddenFiller.idx}`;
    const filterInput = inner.locator('input[aria-label="Filter issues"]');
    await filterInput.waitFor();
    await filterInput.fill(searchText);

    const searchResultCard = inner.locator(
      `article[role="button"][aria-label^="${hiddenFiller.id}: "]:visible`,
    );
    await pollUntil(
      () => searchResultCard.count(),
      (count) => count > 0,
      (ms) => window.waitForTimeout(ms),
      20_000,
    );
    check(
      'a hidden-past-the-limit issue appears via server-side search once typed',
      (await searchResultCard.count()) > 0,
      `typed "${searchText}", looked for a card for ${hiddenFiller.id}`,
    );

    // Cross-check directly: bd's own search must independently confirm the
    // same issue is a real, findable match for this text.
    const { stdout: serverSearchRaw } = await execBd(scratchRoot, [
      'search',
      searchText,
      '--status',
      'all',
      '--json',
    ]);
    const serverSearchResults = JSON.parse(serverSearchRaw);
    check(
      'bd search itself confirms the same issue as a real match (not a client-side artifact)',
      Array.isArray(serverSearchResults) && serverSearchResults.some((issue) => issue.id === hiddenFiller.id),
      `bd search "${searchText}" --status all --json returned: ${JSON.stringify(serverSearchResults?.map((issue) => issue.id))}`,
    );

    await filterInput.fill('');
    await window.waitForTimeout(300);

    await window.screenshot({ path: join(artifactsDir, 'insight-health-final.png') });
    console.log(`› screenshot written to ${artifactsDir}`);
  } catch (error) {
    await app
      .windows()[0]
      ?.screenshot({ path: join(artifactsDir, 'insight-health-failure.png') })
      .catch(() => {});
    failures.push(`threw: ${error.message}`);
    console.error(error);
  } finally {
    await app.close().catch(() => {});
    // See editing-suite.spec.mjs's identical comment: a short settle delay
    // measurably reduces Windows EBUSY on the retry loop below, for the same
    // just-released Dolt file handle reason.
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
    console.error(`\n✘ Insight & health suite failed (${failures.length}):`);
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exit(1);
  }
  console.log('\n✔ Insight & health suite passed.');
}

await main();
