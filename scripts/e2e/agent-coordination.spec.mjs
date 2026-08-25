#!/usr/bin/env node
/**
 * End-to-end agent-coordination suite (Epic D coverage, bead 9e9.7).
 *
 *   npm run test:e2e:coordination
 *
 * Launches a real VS Code, with this extension loaded, against a **throwaway
 * `bd` project** (not this repo's real board) and drives the rendered webview
 * / native VS Code UI through: the read-only sync-status chip (header),
 * opt-in gate-opened toast notifications, and (narrowed — see below) the
 * claim-liveness lease badge. Every mutation and every read is cross-checked
 * against `bd` directly, the same discipline `editing-suite.spec.mjs` and
 * `run-webview-test.mjs` use.
 *
 * ── Why an isolated scratch project ──
 * Identical reasoning and mechanism to `editing-suite.spec.mjs`'s module doc
 * ("Why an isolated scratch project instead of this repo's real board"): a
 * fresh `mkdtemp` + `bd init --non-interactive --skip-hooks --skip-agents`
 * directory, opened as the VS Code workspace. `src/extension/workspace.ts`
 * resolves the beads workspace purely by `fs.stat`ing `<folder>/.beads`, so
 * this activates the extension exactly like a real project would, fully
 * isolated from this repo's own board.
 *
 * ── Why this file repeats run-webview-test.mjs's / editing-suite.spec.mjs's
 *    harness boilerplate ──
 * Per the epic's own recorded decision (beads-ui-vscode-ext-9e9's `design`
 * field): "E2E goes deep with one dedicated script file per epic to allow
 * safe parallel batching." Sibling spec files exist per epic; importing a
 * shared "harness" module would make every one of those agents edit the same
 * file — precisely the collision parallel batching avoids. So this file is
 * self-contained. The one thing still imported rather than copied is
 * `scripts/lib/clean-env.mjs`: not test logic, nobody editing their own
 * epic's spec ever needs to change it, and hand-copying its Windows/Electron
 * env-scrubbing fix imperfectly would be its own risk.
 *
 * ── Lease-badge coverage: NARROWED SCOPE (read before touching this test) ──
 * The bead's design asked to "seed one [claimed issue with a live heartbeat]
 * via `bd update --claim` in a scratch/throwaway issue" and assert the
 * lease/claim badge renders. `src/shared/lease.ts` and
 * `src/webview/components/lease-badge.tsx` (bead ayq.1) fully exist and are
 * wired into both `bead-card.tsx` and `fleet/worker-list.tsx` — this is not
 * a missing feature. What could not be produced, despite direct
 * investigation against the real installed `bd` CLI (not assumed from docs),
 * is the *data* those components render on: a `bd show`/`bd list --json`
 * payload with `lease_expires_at`/`heartbeat_at` actually populated.
 *
 * Live-verified findings (bd version 1.2.2, a `bd init --non-interactive`
 * scratch project — i.e. exactly this suite's own setup — reports
 * `Mode: direct` / `bd dolt status --json` reports `"mode":"embedded"`):
 *   - `bd update <id> --claim` (the exact command
 *     `src/extension/bd/mutations.ts`'s `claim()` runs) succeeds — assignee
 *     and status flip to in_progress/`<actor>` — but `bd show <id> --json`
 *     immediately after (including with `--long`, which the CLI's own
 *     `--help` describes as "all available fields … gate fields, etc.") never
 *     includes `lease_expires_at`, `heartbeat_at`, or `lease_granted_node`.
 *   - `bd ready --claim --json` (the CLI-documented atomic claim path used by
 *     autonomous workers) reproduces the exact same result: a real claim,
 *     with no lease fields ever surfacing through `bd show`/`bd list --json`
 *     afterwards.
 *   - No `bd update` flag sets these fields directly (checked `bd update
 *     --help` in full); no other read command (`bd list --json`, `bd query`,
 *     `bd status`, `bd info --json`) surfaces them either.
 *   - The Fleet tab's worker list (`worker-list.tsx`) renders the identical
 *     `LeaseBadge` off the identical `Bead` data — it is not a second, richer
 *     data source, so it cannot produce a different result.
 * Per this bead's own step 0 instructions ("If a described sub-feature …
 * turns out not to … do NOT invent/stub it — tell me exactly what you
 * found"), this suite does NOT fabricate lease timestamps or monkey-patch
 * `bd`'s output to force a `live`/`stale-heartbeat`/`expired` badge to
 * render. Test A below instead asserts the one lease-badge behaviour that
 * *is* honestly reachable through the real, installed `bd` CLI: a freshly
 * claimed issue's card renders no lease badge at all (the classifier's
 * `none` branch — see `lease-badge.tsx`'s own comment: "renders nothing on
 * the common no-lease issue"), confirming there is no false-positive badge
 * on a real, working claim. This is reported back to the orchestrator as a
 * scope-narrowing finding, not silently dropped — see the handoff notes.
 *
 * ── Sync-widget test design ──
 * `SyncStatusChip` / `useSyncStatus` never fetch on mount — only the
 * webview's own "Refresh from bd" button triggers `getSyncStatus` (see
 * `App.tsx`'s `onRefresh`, which piggybacks `syncStatus.refresh()` on the
 * same click as the beads refresh). This suite's scratch project is
 * `bd init`'d fresh, so `bd dolt status --json` reports embedded mode with no
 * server and no ahead/behind/last-sync fields — verified directly against
 * the same scratch project this suite drives, not assumed. The chip's "copy
 * suggested command" button is asserted two ways: (a) the OS clipboard
 * (read via Electron's own `clipboard` module through `app.evaluate`)
 * contains exactly `SUGGESTED_SYNC_COMMAND` afterwards, and (b) — the bead's
 * literal ask, "assert via a spy/log that those argv substrings never
 * appear" — `BdService.run()` logs every single argv it spawns to the
 * "Beads Dashboard" output channel (`this.log(\`bd ${args.join(' ')} …\`)`),
 * which VS Code persists to
 * `<user-data-dir>/logs/**\/exthost/output_logging_*\/*-Beads Dashboard.log`
 * (path pattern confirmed live for this exact harness before writing this
 * assertion). This suite reads that file after the whole run and asserts it
 * never contains the substrings "dolt push" or "dolt pull" — a real spy on
 * every `bd` invocation this session's extension host actually made, not a
 * mocked one.
 *
 * ── Notification test design ──
 * `beadsDashboard.notifications` (default `'off'`) is set to `'gates'` in
 * this run's own `User/settings.json` before VS Code ever launches — the
 * bead's own wording ("enable … in test settings") — rather than toggled at
 * runtime. `createBeadsNotifier` (`src/extension/notifications.ts`) is wired
 * host-side, independent of whether the dashboard webview is even open, and
 * fires off `store.onDidChange`; `beadsDashboard.refresh` calls
 * `store.refresh()` unconditionally (see `commands.ts`), so this suite
 * creates a real gate via `bd gate create --blocks <id>` directly (not
 * through the UI — the create path itself isn't what Epic D is testing here)
 * and then runs the `Beads: Refresh` palette command to force the toast
 * decision to evaluate. The resulting native VS Code notification toast (DOM
 * shape confirmed live before writing these selectors: a
 * `.notification-list-item-message` element containing the exact
 * `decideNotifications` message text, inside `.notifications-toasts`) is
 * asserted to appear exactly once, and to *stay* at exactly once after a
 * second `Beads: Refresh` with no new gate — the bead's literal
 * "not duplicated on a second poll tick" acceptance criterion, exercising
 * `decideNotifications`'s `alreadyNotified` de-dup for real.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, readdir, readFile, writeFile } from 'node:fs/promises';
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
 * `editing-suite.spec.mjs`'s `execBd`.
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

/** Recursively lists every file under `dir` (best-effort; missing dir → []). */
async function walkFiles(dir) {
  const out = [];
  async function recurse(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await recurse(full);
      else out.push(full);
    }
  }
  await recurse(dir);
  return out;
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
  const scratchRoot = await mkdtemp(join(tmpdir(), 'beads-ui-e2e-coordination-'));
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

  // Cross-checked directly against the same scratch project this suite
  // drives (not assumed from docs) — see the module doc's sync-widget note.
  const { stdout: doltStatusRaw } = await execBd(scratchRoot, ['dolt', 'status', '--json']);
  const doltStatus = JSON.parse(doltStatusRaw);
  console.log(`› scratch project's own \`bd dolt status --json\`: ${doltStatusRaw.trim()}`);

  console.log(`› resolving VS Code ${testVersion}`);
  const executablePath = await downloadAndUnzipVSCode(testVersion);

  const profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-coordination-profile-'));
  const theme = process.env.BEADS_TEST_THEME ?? 'Default Dark Modern';
  await mkdir(join(profileDir, 'User'), { recursive: true });
  await writeFile(
    join(profileDir, 'User', 'settings.json'),
    JSON.stringify(
      {
        'workbench.colorTheme': theme,
        'window.commandCenter': false,
        // Enabled in test settings up front, per the bead's own wording —
        // never toggled at runtime. Default is 'off'; see package.json.
        'beadsDashboard.notifications': 'gates',
      },
      null,
      2,
    ),
    'utf8',
  );
  const extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-coordination-exts-'));

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

  const createdIds = {};

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

    // Extension activation is automatic (`workspaceContains:.beads`), but the
    // command palette only lists commands once activation has actually run.
    await window.waitForTimeout(2000);

    await runPaletteCommand('Beads: Open Dashboard');
    const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');

    const header = inner.locator('text=/\\d+\\s+issues/');
    await header.first().waitFor();

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
      return card;
    }

    // =================================================================
    // Baseline: one explicit "Beads: Refresh" before either the gate or
    // the claim fixture below exist, so createBeadsNotifier's `prevSnapshot`
    // is unambiguously a zero-gate snapshot (activation's own automatic
    // refresh should already establish this, but this is the same
    // belt-and-suspenders discipline editing-suite.spec.mjs uses for every
    // state-dependent assertion).
    // =================================================================
    console.log('› baseline: refresh before creating anything');
    await refreshDashboard();

    // =================================================================
    // Test A: lease badge — NARROWED SCOPE, see the module doc's
    // "Lease-badge coverage" section for the full live-verified
    // investigation. Asserts the one honestly-reachable behaviour: a real
    // claim via the extension's own mutation command produces no
    // false-positive lease badge, because the installed `bd` CLI never
    // surfaces lease_expires_at/heartbeat_at through any read command this
    // suite could find.
    // =================================================================
    console.log('› test A (narrowed scope): claim a scratch issue, confirm no false-positive lease badge');
    const { stdout: leaseFixtureRaw } = await execBd(scratchRoot, ['create', 'E2E lease fixture issue', '--json']);
    const leaseFixtureId = JSON.parse(leaseFixtureRaw).id;
    createdIds.leaseFixture = leaseFixtureId;

    // The exact command `src/extension/bd/mutations.ts`'s `claim()` runs.
    await execBd(scratchRoot, ['update', leaseFixtureId, '--claim']);

    const afterClaim = await pollUntil(
      () => bdShow(scratchRoot, leaseFixtureId),
      (bead) => bead?.status === 'in_progress' && !!bead?.assignee,
      (ms) => window.waitForTimeout(ms),
      15_000,
    );
    check(
      'the scratch issue was actually claimed (bd show agrees: in_progress + assignee set)',
      afterClaim?.status === 'in_progress' && !!afterClaim?.assignee,
      `bd show status/assignee: ${afterClaim?.status} / ${afterClaim?.assignee}`,
    );
    check(
      '[scope note] bd show never surfaced lease_expires_at/heartbeat_at after the claim — '
        + 'live-verified against this bd install, see module doc "Lease-badge coverage"',
      afterClaim?.lease_expires_at === undefined && afterClaim?.heartbeat_at === undefined,
      `bd show lease fields: lease_expires_at=${afterClaim?.lease_expires_at}, heartbeat_at=${afterClaim?.heartbeat_at}`,
    );

    const leaseCard = await selectCard(leaseFixtureId);
    const leaseBadgeTexts = ['leased', 'stale heartbeat', 'lease expired'];
    let sawFalsePositiveBadge = false;
    for (const text of leaseBadgeTexts) {
      if ((await leaseCard.getByText(text, { exact: true }).count()) > 0) sawFalsePositiveBadge = true;
    }
    check(
      "a claimed issue with no measurable lease renders no lease badge (LeaseBadge's `none` branch — no false positive)",
      !sawFalsePositiveBadge,
      'expected none of "leased"/"stale heartbeat"/"lease expired" inside the card',
    );
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // =================================================================
    // Test B: sync-status chip (bead ayq.2) — read-only, embedded-mode shape
    // =================================================================
    console.log('› test B: sync-status chip renders the embedded-mode shape');
    await inner.locator('[role="tab"]:has-text("Overview")').first().click();
    await window.waitForTimeout(500);

    // Only the webview's own "Refresh from bd" button ever fetches sync
    // status (see App.tsx's onRefresh) — never a poll tick. Scoped by the
    // `title` attribute rather than accessible name: the button's visible
    // content is an sr-only "Refresh" span, so its computed accessible name
    // is "Refresh", not the "Refresh from bd" tooltip text.
    await inner.locator('button[title="Refresh from bd"]').click();
    await window.waitForTimeout(1000);

    const syncModeEl = inner.locator('[data-testid="sync-mode"]');
    await syncModeEl.waitFor();
    const syncModeText = (await syncModeEl.innerText()).trim();
    check(
      'sync chip reports the same mode bd dolt status --json reports',
      syncModeText === doltStatus.mode,
      `chip: "${syncModeText}", bd dolt status --json: "${doltStatus.mode}"`,
    );

    const hasAheadBehindInBd = 'ahead' in doltStatus || 'behind' in doltStatus;
    const aheadBehindEl = inner.locator('[data-testid="sync-ahead-behind"]');
    check(
      'ahead/behind render only when bd actually reports them (embedded mode: absent both sides)',
      hasAheadBehindInBd === ((await aheadBehindEl.count()) > 0),
      `bd reported ahead/behind: ${hasAheadBehindInBd}, chip rendered the testid: ${(await aheadBehindEl.count()) > 0}`,
    );

    // Copy-suggested-command button: never runs bd dolt push/pull, only
    // copies text to the OS clipboard via the copyText RPC.
    await inner.getByRole('button', { name: /Copy suggested sync command/i }).click();
    await window.waitForTimeout(500);
    const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText());
    check(
      'the copy button put the suggested command on the OS clipboard, verbatim',
      clipboardText === 'bd dolt pull',
      `clipboard read back: "${clipboardText}"`,
    );

    // =================================================================
    // Test C: opt-in gate-opened toast notification, no duplicate on a
    // second refresh with no new gate (bead ayq.3 / this bead's own
    // acceptance criteria).
    // =================================================================
    console.log('› test C: a gate opening toasts once, never twice');
    const { stdout: gateTargetRaw } = await execBd(scratchRoot, ['create', 'E2E gate target issue', '--json']);
    const gateTargetId = JSON.parse(gateTargetRaw).id;
    createdIds.gateTarget = gateTargetId;

    const { stdout: gateCreateRaw } = await execBd(scratchRoot, [
      'gate',
      'create',
      '--blocks',
      gateTargetId,
      '--reason',
      'e2e coordination test gate',
      '--json',
    ]);
    const gateId = JSON.parse(gateCreateRaw).id;
    createdIds.gate = gateId;
    check(
      'the fixture gate is a human gate (the only kind that ever toasts — see humanGates in shared/model.ts)',
      JSON.parse(gateCreateRaw).await_type === 'human',
      `bd gate create --json await_type: ${JSON.parse(gateCreateRaw).await_type}`,
    );

    // The toast is a *native* VS Code notification (vscode.window.showInformationMessage),
    // not an in-webview one — it lives in the top-level window, outside `inner`.
    // DOM shape confirmed live before writing this selector (see module doc).
    const gateToastMessage = window.locator('.notification-list-item-message', {
      hasText: '1 gate needs you.',
    });

    check('no gate-opened toast exists yet (sanity, before the refresh that should trigger one)', (await gateToastMessage.count()) === 0);

    await refreshDashboard();
    await window.waitForTimeout(1500);

    await gateToastMessage.first().waitFor({ timeout: 10_000 }).catch(() => {});
    const countAfterFirstRefresh = await gateToastMessage.count();
    check(
      'refreshing after a human gate opens shows exactly one "1 gate needs you." toast',
      countAfterFirstRefresh === 1,
      `found ${countAfterFirstRefresh} matching toast message(s)`,
    );

    await refreshDashboard();
    await window.waitForTimeout(1500);
    const countAfterSecondRefresh = await gateToastMessage.count();
    check(
      'a second refresh with no new gate does not add a duplicate toast (alreadyNotified de-dup)',
      countAfterSecondRefresh === countAfterFirstRefresh,
      `count after 1st refresh: ${countAfterFirstRefresh}, after 2nd: ${countAfterSecondRefresh}`,
    );

    // Resolve the gate — real cleanup of the mutation this test made, on top
    // of the whole scratch project being deleted below.
    await execBd(scratchRoot, ['gate', 'resolve', gateId, '--reason', 'e2e coordination cleanup']);
    const gateAfterResolve = await bdShow(scratchRoot, gateId);
    check(
      'the fixture gate was resolved (closed) before this run ends',
      gateAfterResolve?.status !== undefined && gateAfterResolve.status !== 'open',
      `bd show status: ${gateAfterResolve?.status}`,
    );

    await window.screenshot({ path: join(artifactsDir, 'agent-coordination-final.png') });
    console.log(`› screenshot written to ${artifactsDir}`);
  } catch (error) {
    await app
      .windows()[0]
      ?.screenshot({ path: join(artifactsDir, 'agent-coordination-failure.png') })
      .catch(() => {});
    failures.push(`threw: ${error.message}`);
    console.error(error);
  } finally {
    await app.close().catch(() => {});
    // See editing-suite.spec.mjs's identical note: a short settle delay
    // measurably reduces EBUSY from a just-released Dolt file handle on
    // Windows before the retry loop below even starts.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // =================================================================
    // Cross-cutting: nothing this suite did ever actually invoked
    // `bd dolt push`/`bd dolt pull`. Real spy: BdService logs every argv it
    // spawns to the "Beads Dashboard" output channel, which VS Code
    // persists to disk — read only now, after the extension host has fully
    // shut down and flushed, not while it was still running (output-channel
    // log files are not guaranteed flushed to disk on every line). Path
    // pattern confirmed live for this exact harness before writing this
    // assertion (see module doc's sync-widget note).
    // =================================================================
    console.log('› cross-check: bd dolt push/pull never appeared in any argv this session spawned');
    const logFiles = (await walkFiles(join(profileDir, 'logs'))).filter((f) => /beads dashboard/i.test(f));
    check(
      'found the "Beads Dashboard" output-channel log file on disk',
      logFiles.length > 0,
      `searched under ${join(profileDir, 'logs')}`,
    );
    let sawPushOrPull = false;
    let combinedLog = '';
    for (const file of logFiles) {
      const content = await readFile(file, 'utf8').catch(() => '');
      combinedLog += content;
      if (/dolt (push|pull)/i.test(content)) sawPushOrPull = true;
    }
    check(
      'no bd invocation this session made ever included "dolt push" or "dolt pull"',
      !sawPushOrPull,
      sawPushOrPull ? `matched in: ${combinedLog.slice(0, 500)}` : '',
    );

    const rmOptions = { recursive: true, force: true, maxRetries: 15, retryDelay: 500 };
    await rm(profileDir, rmOptions).catch(() => {});
    await rm(extensionsDir, rmOptions).catch(() => {});
    // Deletes every scratch issue this suite created/claimed (createdIds),
    // satisfying "any scratch issue this spec claims/creates … is
    // released/deleted before the run ends" — the whole throwaway project
    // disappears, so there is nothing left to release individually.
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
    console.error(`\n✘ Agent-coordination suite failed (${failures.length}):`);
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exit(1);
  }
  console.log('\n✔ Agent-coordination suite passed.');
}

await main();
