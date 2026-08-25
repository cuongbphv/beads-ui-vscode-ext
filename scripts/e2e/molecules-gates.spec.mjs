#!/usr/bin/env node
/**
 * End-to-end Molecules + Gates suite (Epic B coverage, bead 9e9.5).
 *
 *   npm run test:e2e:molecules
 *
 * Launches a real VS Code, with this extension loaded, against a **throwaway
 * `bd` project** (mkdtemp + `bd init`, never this repo's real board — see
 * `editing-suite.spec.mjs`'s module doc for why) and drives the Molecules
 * tab through: a molecule card's progress/ETA/current-step/stale badge, the
 * gates section, the wisp strip's TTL countdown actually ticking down, a
 * molecule's expanded step list showing all 5 visually distinct step
 * states (done/current/ready/pending/gated), and resolving a human gate
 * from its card.
 *
 * ── Fixture design ──
 * Two formulas are distilled+poured in the scratch project:
 *   - "fixdemo" (5 steps: Step Done/Current/Ready/Pending/Gated) — the main
 *     molecule used for the card-progress, step-list and gate-resolve tests.
 *     "Step Pending" is templated with a `blocks` dependency on "Step Ready"
 *     so it comes back genuinely `pending` (not ready) after pouring; "Step
 *     Done"/"Step Current" get their real status set on the *poured* copies
 *     (status is per-issue state, not template structure); "Step Gated" gets
 *     a real `bd gate create --type human` attached to the poured copy after
 *     pouring (gates are never part of `mol show --parallel`'s own graph —
 *     see `shared/mol.ts`'s `MolStepGate` doc — so they can only be created
 *     against a real, already-poured step, not templated).
 *   - "staledemo" (1 step) — poured, then its one step is closed while the
 *     root stays open. `bd mol stale --help` documents staleness as purely
 *     "all children closed, root still open" with no time threshold, so this
 *     is deterministic — no need to fake elapsed time.
 *   - "wispdemo" (1 step) — instantiated as a wisp (`bd mol wisp`, not
 *     `pour`) purely for the wisp strip / TTL test, kept separate from
 *     fixdemo so the strip has exactly one predictable chip.
 *
 * ── Root cause this spec guards against (bead 9e9.5's RE-MEASURE note) ──
 * `useMolDetail` (and, identically, `useMolecules`) used to coalesce
 * concurrent fetches with a `useRef` flag but gate state updates with a
 * plain closure `live` flag scoped to one `useEffect` invocation. Under
 * React StrictMode's dev-mode double-invoke-on-mount, the first (aborted)
 * invocation's in-flight call would hold the *shared* ref's flag `true`
 * while its own `live` went `false` on cleanup; the second (real, live)
 * invocation's own fetch would then see "already in flight" and no-op
 * forever, since the abandoned call's `.then`/`.finally` drop the result
 * (correctly, given their own `live` is `false`) without anything left to
 * ever call `setLoading(false)` for the live instance — `bd` itself was
 * never slow or hung; the extension host completed every call in under 2s
 * (confirmed live via the "Beads Dashboard" output channel while
 * diagnosing this), but the webview's own hook state simply never moved
 * past "loading". Fixed by scoping the coalescing flag to each effect
 * instance (a plain closure variable) instead of a ref shared across
 * StrictMode's simulated remount. Test 4 below (the step list) is the
 * direct regression guard for this; test 1 (card progress, which reads
 * `useMolecules`) is a secondary guard for the identical bug there.
 *
 * ── Why this file repeats run-webview-test.mjs's harness boilerplate ──
 * Per the epic's own recorded decision (see `editing-suite.spec.mjs`'s
 * identical note): one dedicated script file per epic, self-contained, so
 * parallel agents never collide on a shared harness module.
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

const LAUNCH_TIMEOUT = 180_000;
const UI_TIMEOUT = 90_000;
const POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 400;
/** The wisp TTL countdown only re-renders text at minute granularity above
 * 1 minute remaining (`formatDurationMs`) — worst case a full minute must
 * elapse to observe the displayed text actually change. */
const TTL_POLL_TIMEOUT_MS = 75_000;
const TTL_POLL_INTERVAL_MS = 2_000;

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

async function pollUntil(read, predicate, waitFn, timeoutMs = POLL_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await waitFn(intervalMs);
    value = await read();
  }
  return value;
}

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

async function bdJson(cwd, args) {
  const { stdout } = await execBd(cwd, [...args, '--json']);
  return JSON.parse(stdout);
}

async function bdShow(cwd, id) {
  const parsed = await bdJson(cwd, ['show', id]);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function bdListAllCount(cwd) {
  const list = await bdJson(cwd, ['list', '--all']);
  return Array.isArray(list) ? list.length : 0;
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

  console.log('› recording the real shared board issue count (must be unchanged at the end)');
  const realBoardCountBefore = await bdListAllCount(repoRoot);

  console.log('› creating an isolated scratch bd project');
  const scratchRoot = await mkdtemp(join(tmpdir(), 'beads-ui-e2e-molecules-'));
  await execBd(scratchRoot, ['init', '--non-interactive', '--skip-hooks', '--skip-agents']);

  /** Creates an epic + N task children (parent-child), returns { epicId, stepIds (in title order) }. */
  async function createEpicWithSteps(epicTitle, stepTitles) {
    const epic = await bdJson(scratchRoot, ['create', epicTitle, '--type', 'epic']);
    const stepIds = [];
    for (const title of stepTitles) {
      const step = await bdJson(scratchRoot, ['create', title, '--type', 'task']);
      await execBd(scratchRoot, ['dep', 'add', step.id, epic.id, '--type', 'parent-child']);
      stepIds.push(step.id);
    }
    return { epicId: epic.id, stepIds };
  }

  console.log('› seeding "fixdemo": epic + 5 steps (done/current/ready/pending/gated)');
  const fixdemoTitles = ['Step Done', 'Step Current', 'Step Ready', 'Step Pending', 'Step Gated'];
  const { epicId: fixdemoEpicId, stepIds: fixdemoTemplateSteps } = await createEpicWithSteps('Fix Demo', fixdemoTitles);
  const [tplDone, tplCurrent, tplReady, tplPending] = fixdemoTemplateSteps;
  // "Step Pending" blocks on "Step Ready" so the templated DAG carries a real
  // dependency through distill/pour (verified live while diagnosing this bead:
  // `mol distill` captures inter-step `blocks` edges, not just parent-child).
  await execBd(scratchRoot, ['dep', 'add', tplPending, tplReady, '--type', 'blocks']);
  await execBd(scratchRoot, ['mol', 'distill', fixdemoEpicId, 'fixdemo']);
  const fixdemoPour = await bdJson(scratchRoot, ['mol', 'pour', 'fixdemo']);
  const fixdemoRootId = fixdemoPour.new_epic_id;
  const idFor = (slug) => fixdemoPour.id_mapping[`fixdemo.${slug}`];
  const stepDoneId = idFor('step-done');
  const stepCurrentId = idFor('step-current');
  const stepReadyId = idFor('step-ready');
  const stepPendingId = idFor('step-pending');
  const stepGatedId = idFor('step-gated');
  check(
    'fixdemo pour produced all 5 step ids',
    [stepDoneId, stepCurrentId, stepReadyId, stepPendingId, stepGatedId].every(Boolean),
    JSON.stringify(fixdemoPour.id_mapping),
  );

  // Status is per-issue state, not template structure — set it on the poured
  // copies directly.
  await execBd(scratchRoot, ['close', stepDoneId]);
  await execBd(scratchRoot, ['update', stepCurrentId, '--claim']);
  // The gate is real runtime state, never templated (see module doc).
  const gate = await bdJson(scratchRoot, [
    'gate',
    'create',
    '--type',
    'human',
    '--blocks',
    stepGatedId,
    '--reason',
    'Needs a human sign-off (e2e fixture)',
  ]);
  const gateId = gate.id;
  check('gate created against Step Gated', typeof gateId === 'string' && gateId.length > 0, JSON.stringify(gate));

  console.log('› seeding "staledemo": epic + 1 step, closed, root reopened (all children complete, root still open)');
  const { epicId: staleEpicId, stepIds: staleTemplateSteps } = await createEpicWithSteps('Stale Demo', ['Only step']);
  await execBd(scratchRoot, ['mol', 'distill', staleEpicId, 'staledemo']);
  const stalePour = await bdJson(scratchRoot, ['mol', 'pour', 'staledemo']);
  const staleRootId = stalePour.new_epic_id;
  const staleStepId = stalePour.id_mapping['staledemo.only-step'];
  check('staledemo pour produced its one step id', typeof staleStepId === 'string' && staleStepId.length > 0);
  // Closing the *last* open child auto-closes the root too (bd 1.2.2, verified
  // live while writing this fixture: `bd show` on the root came back with
  // `"close_reason": "all steps complete"` immediately after the plain `bd
  // close` above — no flag suppresses this cascade). Reopen just the root so
  // it goes back to "all children closed, root still open" without touching
  // the child's own closed status, and so the root reappears in `bd list
  // --flat --type molecule` (a closed root drops out of that list, which is
  // what made the card disappear entirely before this fix, not just miss its
  // stale badge).
  await execBd(scratchRoot, ['close', staleStepId]);
  await execBd(scratchRoot, ['reopen', staleRootId]);
  const staleRootAfterReopen = await bdShow(scratchRoot, staleRootId);
  check(
    'staledemo root is open with its only child closed (the exact bd mol stale precondition)',
    staleRootAfterReopen?.status === 'open',
    JSON.stringify(staleRootAfterReopen),
  );
  // [Verified live, 2026-08-25, bd 1.2.2] `bd mol stale --json` never flags
  // this root even though it meets every documented precondition
  // ("all children closed, root still open") — `shared/mol.ts`'s own doc
  // comment on `molStaleIds` already records this: bd 1.2.2's stale detector
  // only ever considers `issue_type: "epic"` roots, never `issue_type:
  // "molecule"` roots (what `bd mol pour`/`bd mol wisp` always produce, and
  // the only type the Molecules tab's own `bd list --type molecule` ever
  // shows). So a molecule-type root — the only kind that can ever appear as
  // a card here — can never be bd-flagged as stale on this bd version,
  // confirmed independently while writing this fixture (not assumed from the
  // comment alone: `bd mol stale --json` was run by hand against exactly
  // this reopened root and returned `stale_molecules: null`). The card's
  // `stale` badge is real, tested code (`MoleculeCard` renders it whenever
  // `item.stale` is true — see its own component), but this bd version can
  // never supply that input for anything the Molecules tab lists; asserting
  // it would-be-true here would be asserting an unverifiable claim, which
  // the badge's *absence* below is not.
  const staleReport = await bdJson(scratchRoot, ['mol', 'stale']);
  check(
    '[Unverified as UI-reachable on bd 1.2.2] bd mol stale cannot flag a molecule-type root — see comment above',
    (staleReport?.stale_molecules ?? null) === null,
    JSON.stringify(staleReport),
  );
  void staleTemplateSteps;

  console.log('› seeding "wispdemo": epic + 1 step, instantiated as a wisp');
  const { epicId: wispEpicId } = await createEpicWithSteps('Wisp Demo', ['Wisp step']);
  await execBd(scratchRoot, ['mol', 'distill', wispEpicId, 'wispdemo']);
  const wispPour = await bdJson(scratchRoot, ['mol', 'wisp', 'wispdemo']);
  const wispRootId = wispPour.new_epic_id;
  check('wispdemo wisp produced a root id', typeof wispRootId === 'string' && wispRootId.length > 0, JSON.stringify(wispPour));

  console.log(`› resolving VS Code ${testVersion}`);
  const executablePath = await downloadAndUnzipVSCode(testVersion);

  const profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-molecules-profile-'));
  const theme = process.env.BEADS_TEST_THEME ?? 'Default Dark Modern';
  await mkdir(join(profileDir, 'User'), { recursive: true });
  await writeFile(
    join(profileDir, 'User', 'settings.json'),
    JSON.stringify({ 'workbench.colorTheme': theme, 'window.commandCenter': false }, null, 2),
    'utf8',
  );
  const extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-molecules-exts-'));

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

    await runPaletteCommand('Beads: Open Dashboard');
    const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');
    await inner.locator('text=/\\d+\\s+issues/').first().waitFor();
    console.log('› dashboard open');

    async function refreshDashboard() {
      await runPaletteCommand('Beads: Refresh');
      await window.waitForTimeout(1000);
    }

    await refreshDashboard();
    await inner.locator('[role="tab"]:has-text("Molecules")').first().click();
    await window.waitForTimeout(500);
    console.log('› Molecules tab open');

    // =================================================================
    // Test 1: molecule card — progress, ETA, current step, stale badge
    // =================================================================
    console.log('› test 1: molecule card progress/ETA/current-step/stale badge');
    const fixdemoCard = inner.locator(`article[role="button"][aria-label^="${fixdemoRootId}: "]`).first();
    await fixdemoCard.waitFor();

    const progressText = await fixdemoCard.locator('text=/\\d+\\/\\d+ steps/').first().innerText();
    check('fixdemo card shows 1/5 steps done', /^1\/5 steps/.test(progressText), `read "${progressText}"`);

    const etaVisible = await fixdemoCard.locator('text=/~.+ left/').first().isVisible().catch(() => false);
    check('fixdemo card shows an ETA estimate', etaVisible);

    const currentStepVisible = await fixdemoCard
      .locator('text=/Current:\\s*Step Current/')
      .first()
      .isVisible()
      .catch(() => false);
    check('fixdemo card shows the current step title', currentStepVisible);

    const staleCard = inner.locator(`article[role="button"][aria-label^="${staleRootId}: "]`).first();
    await staleCard.waitFor();
    // Not asserting the badge *does* render: see the fixture-setup comment
    // above — bd 1.2.2's `mol stale` detector never flags a molecule-type
    // root, so this bd version can never feed `MoleculeCard` a `true` here
    // for anything the Molecules tab lists. Asserting its absence is still
    // real coverage: the card renders correctly for a 100%-complete
    // molecule without spuriously showing a stale badge it has no basis for.
    // Matched on the badge's own `title` attribute (`molecule-card.tsx`:
    // "Flagged by bd mol stale — complete but still open"), not a loose text
    // regex — a naive `text=/stale/i` false-positives on this card's own
    // title paragraph, since a poured root's title is the formula name
    // ("staledemo"), which itself contains the substring "stale".
    const staleBadgeVisible = await staleCard
      .locator('[title*="Flagged by bd mol stale"]')
      .first()
      .isVisible()
      .catch(() => false);
    check('staledemo card renders (100% done) without a spurious stale badge', !staleBadgeVisible);

    // =================================================================
    // Test 2: gates section shows the open human gate on Step Gated
    // =================================================================
    console.log('› test 2: gates section');
    const gatesSection = inner.locator('section[aria-label^="Gates ("]').first();
    await gatesSection.waitFor();
    const gateCard = gatesSection.locator(`article[aria-label^="${gateId}: "]`).first();
    await gateCard.waitFor();
    check('the open gate on Step Gated renders in the gates section', await gateCard.isVisible());
    const gateAwaitVisible = await gateCard.locator('text=/Waiting on a person/').first().isVisible().catch(() => false);
    check('the gate card describes what it is waiting on', gateAwaitVisible);

    // =================================================================
    // Test 3: wisp strip renders wispdemo and its TTL countdown ticks down
    // =================================================================
    console.log('› test 3: wisp strip TTL countdown');
    const wispStrip = inner.locator('section[aria-label^="Wisps ("]').first();
    await wispStrip.waitFor();
    const wispChip = wispStrip.locator(`article[aria-label^="${wispRootId}: "]`).first();
    await wispChip.waitFor();

    const readTtlText = () => wispChip.locator('text=/left$/').first().innerText().catch(() => '');
    const initialTtlText = await readTtlText();
    check('wisp chip shows an initial TTL countdown', initialTtlText.length > 0, `read "${initialTtlText}"`);

    console.log(`› waiting up to ${TTL_POLL_TIMEOUT_MS / 1000}s for the countdown text to tick down`);
    const laterTtlText = await pollUntil(
      readTtlText,
      (text) => text.length > 0 && text !== initialTtlText,
      (ms) => window.waitForTimeout(ms),
      TTL_POLL_TIMEOUT_MS,
      TTL_POLL_INTERVAL_MS,
    );
    check(
      'wisp chip TTL countdown text updates over real time',
      laterTtlText !== initialTtlText,
      `"${initialTtlText}" -> "${laterTtlText}"`,
    );

    // =================================================================
    // Test 4: molecule detail step list — all 5 states render distinctly
    // =================================================================
    console.log('› test 4: molecule detail step list (5 step states)');
    await fixdemoCard.click();
    // `MoleculeDetail`'s section aria-label reads `${root.title} steps` — and
    // `bd mol pour` sets a poured root's *title* to the formula name
    // ("fixdemo"), not the source epic's original title ("Fix Demo");
    // verified live while diagnosing this bead (the output-channel screenshot
    // showed "fixdemo — steps" as the section header for exactly this
    // fixture shape).
    const detailSection = inner.locator(`section[aria-label="fixdemo steps"]`).first();
    await detailSection.waitFor();

    async function stepRow(stepId) {
      const row = detailSection.locator(`article[aria-label^="${stepId}: "]`).first();
      await row.waitFor({ timeout: UI_TIMEOUT });
      return row;
    }

    const doneRow = await stepRow(stepDoneId);
    check('Step Done renders the Done badge', await doneRow.locator('text="Done"').first().isVisible());

    const currentRow = await stepRow(stepCurrentId);
    check('Step Current renders the In progress badge', await currentRow.locator('text="In progress"').first().isVisible());

    const readyRow = await stepRow(stepReadyId);
    check('Step Ready renders the Ready badge', await readyRow.locator('text="Ready"').first().isVisible());

    const pendingRow = await stepRow(stepPendingId);
    check('Step Pending renders the Pending badge', await pendingRow.locator('text="Pending"').first().isVisible());

    const gatedRow = await stepRow(stepGatedId);
    const gatedBadgeVisible = await gatedRow.locator('text=/^gate: human/').first().isVisible().catch(() => false);
    check('Step Gated renders a gate badge (5th, visually distinct state)', gatedBadgeVisible);

    const allStepArticles = await detailSection.locator('article').count();
    check('exactly 5 step rows render', allStepArticles === 5, `found ${allStepArticles}`);

    // =================================================================
    // Test 5: resolve the human gate from its card
    // =================================================================
    console.log('› test 5: resolve the human gate');
    await gateCard.getByRole('button', { name: 'Resolve' }).click();
    await gateCard.waitFor({ state: 'detached', timeout: UI_TIMEOUT });

    const gateAfterResolve = await pollUntil(
      () => bdShow(scratchRoot, gateId),
      (issue) => issue?.status === 'closed',
      (ms) => window.waitForTimeout(ms),
    );
    check(
      'the gate is actually closed (bd show agrees)',
      gateAfterResolve?.status === 'closed',
      `bd show read status "${gateAfterResolve?.status}"`,
    );

    const gatesSectionStillThere = await inner
      .locator('section[aria-label^="Gates ("]')
      .first()
      .isVisible()
      .catch(() => false);
    check('the gates section has no gates left (or is gone)', !gatesSectionStillThere);

    await window.screenshot({ path: join(artifactsDir, 'molecules-gates-final.png') });
    console.log(`› screenshot written to ${artifactsDir}`);
  } catch (error) {
    await app
      .windows()[0]
      ?.screenshot({ path: join(artifactsDir, 'molecules-gates-failure.png') })
      .catch(() => {});
    failures.push(`threw: ${error.message}`);
    console.error(error);
  } finally {
    await app.close().catch(() => {});
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

    const realBoardCountAfter = await bdListAllCount(repoRoot);
    check(
      'the real shared project board was never touched',
      realBoardCountAfter === realBoardCountBefore,
      `issue count before=${realBoardCountBefore} after=${realBoardCountAfter}`,
    );
  }

  if (failures.length) {
    console.error(`\n✘ Molecules + Gates suite failed (${failures.length}):`);
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exit(1);
  }
  console.log('\n✔ Molecules + Gates suite passed.');
}

await main();
