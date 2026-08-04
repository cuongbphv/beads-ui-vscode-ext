#!/usr/bin/env node
/**
 * Record the README demo: a scripted ~25 second session in a real editor,
 * converted to a GIF.
 *
 *   npm run gif                      # seed the demo workspace, then record
 *   node scripts/record-demo.mjs --workspace <dir> --id-prefix harbor-
 *
 * The sequence is the pitch, in order:
 *   sidebar → dashboard → Roadmap → Board → drag a card → detail pane →
 *   an agent files and closes work in a terminal while the board updates itself
 *
 * That last beat is the whole reason this extension exists, and it is the one
 * thing a static screenshot cannot show. It is real: the script shells out to
 * `bd` in the demo workspace exactly as an agent would, and nothing in the
 * editor is touched afterwards — what you see is the live refresh landing.
 *
 * Needs ffmpeg on PATH for the GIF conversion; without it the .webm is left in
 * place and the path is printed.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron } from 'playwright';

import { cleanEnv, scrubProcessEnv } from './lib/clean-env.mjs';
import { defaultDemoDir, DEMO_ID_PREFIX } from './lib/demo-workspace.mjs';

const testVersion = process.env.VSCODE_TEST_VERSION ?? '1.105.0';
scrubProcessEnv();

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'docs', 'screenshots');

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const workspace = resolve(flag('--workspace') ?? defaultDemoDir());
const idPrefix = flag('--id-prefix') ?? DEMO_ID_PREFIX;
const keepVideo = argv.includes('--keep-video');

/**
 * Record at a width the dashboard is comfortable in, export narrower.
 *
 * These are two different constraints and conflating them broke the take:
 * recording at 1000px pushed the board into its narrow container-query layout
 * and the In Progress column was no longer a drop target on screen. File size is
 * set by the *exported* pixels, so the sensible split is to record the layout we
 * want people to see and let ffmpeg scale it down.
 */
const SIZE = { width: 1120, height: 700 };
const GIF_WIDTH = 900;
const FPS = 10;
/**
 * A flat editor UI needs nowhere near 256 colours, and every one it does not use
 * is size the reader waits for. 128 with a coarse Bayer pattern holds the theme's
 * greys without banding, at roughly two thirds the bytes.
 */
const GIF_COLORS = 128;
const LAUNCH_TIMEOUT = 180_000;

/** Beats of the sequence, so the pacing is in one place and readable. */
const HOLD = { short: 800, read: 1500, settle: 2200 };

function bd(args) {
  return execFileSync('bd', ['-C', workspace, ...args], {
    encoding: 'utf8',
    env: { ...process.env, BD_JSON_ENVELOPE: '0', BD_NON_INTERACTIVE: '1' },
  });
}

async function runCommand(window, title) {
  await window.keyboard.press('Control+Shift+P');
  await window.locator('.quick-input-widget').waitFor({ state: 'visible' });
  await window.locator('.quick-input-box input').fill(`>${title}`);
  await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
  await window.waitForTimeout(600); // let the viewer read the command
  await window.keyboard.press('Enter');
  await window.locator('.quick-input-widget').waitFor({ state: 'hidden' }).catch(() => {});
}

/**
 * Drag a card the way a hand does.
 *
 * `dragTo` sends three events; dnd-kit's PointerSensor arms on 4px of travel and
 * then follows the pointer, so a jump from A to B lands nothing. The steps also
 * make the drag legible at 12 fps.
 */
async function dragCard(window, from, to) {
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error('drag source or target is not on screen');

  const start = { x: source.x + source.width / 2, y: source.y + 24 };
  const end = { x: target.x + target.width / 2, y: target.y + 90 };

  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  for (let step = 1; step <= 24; step += 1) {
    await window.mouse.move(
      start.x + ((end.x - start.x) * step) / 24,
      start.y + ((end.y - start.y) * step) / 24,
    );
    await window.waitForTimeout(24);
  }
  await window.waitForTimeout(400); // hold over the target before letting go
  await window.mouse.up();
}

if (!existsSync(join(workspace, '.beads'))) {
  console.error(`${workspace} is not a beads workspace — run: npm run demo:seed`);
  process.exit(1);
}

const videoDir = await mkdtemp(join(tmpdir(), 'beads-ui-video-'));
await mkdir(outDir, { recursive: true });

const app = await (async () => {
  console.log(`› resolving VS Code ${testVersion}`);
  const executablePath = await downloadAndUnzipVSCode(testVersion);
  const profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-profile-'));
  const extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-exts-'));
  console.log(`› recording ${workspace}`);
  const launched = await _electron.launch({
    executablePath,
    timeout: LAUNCH_TIMEOUT,
    recordVideo: { dir: videoDir, size: SIZE },
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
  launched.recordingStartedAt = Date.now();
  launched.cleanup = async () => {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await rm(extensionsDir, { recursive: true, force: true }).catch(() => {});
  };
  return launched;
})();

let filed;
/**
 * Seconds of editor boot to cut off the front — window chrome painting, the
 * disabled-extensions toast, and the palette command that closes the chat pane.
 * Setup, not demo, and at 11 fps it is a third of the file.
 */
let trimFrom = 0;

try {
  const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT });
  window.setDefaultTimeout(90_000);
  await window.locator('.monaco-workbench').waitFor({ state: 'visible' });
  await window.setViewportSize(SIZE).catch(() => {});

  await window
    .locator('.notifications-toasts .codicon-notifications-clear')
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});
  await runCommand(window, 'View: Close Secondary Side Bar').catch(() => {});
  await window.waitForTimeout(HOLD.short);

  // ── 1. The sidebar: Needs You, then the plan ──────────────────────────────
  const beadsActivity = window.locator('.activitybar .action-item[aria-label*="Beads" i]').first();
  await beadsActivity.waitFor({ state: 'visible' });
  // Everything before this point is the editor booting; the demo starts here.
  trimFrom = Math.max(0, (Date.now() - app.recordingStartedAt) / 1000 - 0.4);
  await beadsActivity.click();
  await window.locator('.pane-body .monaco-list-row').first().waitFor();
  await window.waitForTimeout(HOLD.settle);

  // ── 2. Open the dashboard ─────────────────────────────────────────────────
  await runCommand(window, 'Beads: Open Dashboard');
  const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');
  await inner.locator('text=/\\d+\\s+issues/').first().waitFor();
  await window.waitForTimeout(HOLD.settle);

  // ── 3. Roadmap ────────────────────────────────────────────────────────────
  await inner.locator('[role="tab"]:has-text("Roadmap")').first().click();
  await window.waitForTimeout(HOLD.settle);

  // ── 4. Board, and a card dragged into In Progress ─────────────────────────
  await inner.locator('[role="tab"]:has-text("Board")').first().click();
  await window.waitForTimeout(HOLD.read);

  const card = inner.locator('article[role="button"]:visible').first();
  await card.waitFor();
  const wipColumn = inner.locator('section:has-text("In Progress")').first();
  await dragCard(window, card, wipColumn);
  await window.waitForTimeout(HOLD.settle);

  // ── 5. The detail pane ────────────────────────────────────────────────────
  await inner.locator(`article[role="button"]:visible`).nth(1).click();
  await window.waitForTimeout(HOLD.settle);
  await window.keyboard.press('Escape');
  await window.waitForTimeout(HOLD.short);

  // ── 6. The point of the whole thing: an agent works, the board follows ────
  // Nothing is clicked from here on. What moves, moves on its own.
  filed = bd([
    'create',
    'Agent: retry failed deploys with backoff',
    '--type',
    'feature',
    '-p',
    '1',
    '--assignee',
    'claude-code',
    '--labels',
    'platform',
    '--silent',
  ]).trim();
  console.log(`  ▸ filed ${filed} from outside the editor`);
  await window.waitForTimeout(HOLD.settle + HOLD.read);

  bd(['update', filed, '--status', 'in_progress']);
  await window.waitForTimeout(HOLD.settle + HOLD.read);

  console.log(`› done recording (trimming ${trimFrom.toFixed(1)}s of boot off the front)`);
} catch (error) {
  console.error('\n✘ recording failed');
  console.error(error);
  process.exitCode = 1;
} finally {
  // The video is only flushed on close.
  await app.close().catch(() => {});
  await app.cleanup();
}

if (process.exitCode) process.exit(process.exitCode);

const [recorded] = (await readdir(videoDir)).filter((name) => name.endsWith('.webm'));
if (!recorded) {
  console.error(`no video was written to ${videoDir}`);
  process.exit(1);
}
const webmPath = join(videoDir, recorded);

const gifPath = join(outDir, 'demo.gif');
const palettePath = join(videoDir, 'palette.png');

/**
 * Two passes: build a palette from the whole clip, then map onto it. One pass
 * with the default 256-colour web palette turns the editor's greys into bands.
 */
function ffmpeg(args) {
  return new Promise((resolveRun, rejectRun) => {
    execFile('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], (error) =>
      error ? rejectRun(error) : resolveRun(),
    );
  });
}

try {
  const scale = `fps=${FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
  const seek = trimFrom > 0 ? ['-ss', trimFrom.toFixed(2)] : [];
  await ffmpeg([
    ...seek,
    '-i',
    webmPath,
    '-vf',
    `${scale},palettegen=stats_mode=diff:max_colors=${GIF_COLORS}`,
    palettePath,
  ]);
  await ffmpeg([
    ...seek,
    '-i',
    webmPath,
    '-i',
    palettePath,
    '-lavfi',
    `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    gifPath,
  ]);
  console.log(`\n✔ ${gifPath}`);
} catch (error) {
  const fallback = join(outDir, 'demo.webm');
  await rename(webmPath, fallback).catch(() => {});
  console.error(`\nffmpeg unavailable or failed (${error.message}).`);
  console.error(`The raw recording is at ${fallback} — convert it by hand.`);
  process.exitCode = 1;
}

if (keepVideo) {
  await rename(webmPath, join(outDir, 'demo.webm')).catch(() => {});
} else {
  await rm(videoDir, { recursive: true, force: true }).catch(() => {});
}

// The recording filed real issues in the demo workspace; leave it as it was so
// the next `npm run capture:demo` is not photographing this script's leftovers.
if (filed) {
  console.log(`› re-seed before the next capture: npm run demo:seed`);
}
