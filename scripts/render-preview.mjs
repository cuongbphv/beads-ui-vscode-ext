/**
 * Render the dashboard outside VS Code, at whatever width you ask for.
 *
 * The Electron test can only screenshot the window it gets, which on a small
 * display is always the narrow layout. This harness loads the *same* built
 * bundle in plain Chromium with a stubbed `acquireVsCodeApi`, answering RPC
 * calls from live `bd --json` output. It is a reviewing tool: it proves the
 * charts, the Gantt and the board render at each breakpoint, and it produces
 * the screenshots to look at.
 *
 *   node scripts/render-preview.mjs [--width 1440] [--tab overview|roadmap|board]
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { chromium } from 'playwright';

import { cleanEnv } from './lib/clean-env.mjs';

const run = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactsDir = join(repoRoot, 'dist', 'test-artifacts');

/** Widths worth checking: a docked panel, a half editor, and a full window. */
const WIDTHS = [420, 900, 1440];
const TABS = ['overview', 'roadmap', 'board'];

async function bd(args) {
  const { stdout } = await run('bd', [...args, '--json'], {
    cwd: repoRoot,
    shell: process.platform === 'win32',
    maxBuffer: 16 * 1024 * 1024,
    env: cleanEnv({ BD_JSON_ENVELOPE: '0' }),
  });
  const parsed = JSON.parse(stdout);
  // Same defensive unwrap BdService does, in case the user's shell exports it.
  return parsed && typeof parsed === 'object' && 'schema_version' in parsed && 'data' in parsed
    ? parsed.data
    : parsed;
}

/**
 * bd reports its vocabulary as `{built_in_statuses, custom_statuses}` rather
 * than a bare array — the same flattening queries.ts does.
 */
function flatten(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  return keys.flatMap((key) => (Array.isArray(payload[key]) ? payload[key] : []));
}

/** The snapshot the host would have sent, built from real bd output. */
async function snapshot() {
  const [context, statuses, types, stats, beads, ready, blocked] = await Promise.all([
    bd(['context']),
    bd(['statuses']),
    bd(['types']),
    bd(['stats']),
    bd(['list', '--all', '-n', '500']),
    bd(['ready']),
    bd(['blocked']),
  ]);

  return {
    context,
    vocabulary: {
      statuses: flatten(statuses, 'built_in_statuses', 'statuses', 'custom_statuses'),
      types: flatten(types, 'built_in_types', 'types', 'custom_types'),
    },
    stats: stats.summary ?? stats,
    beads,
    readyIds: flatten(ready, 'issues', 'ready').map((bead) => bead.id),
    blockedIds: flatten(blocked, 'issues', 'blocked').map((bead) => bead.id),
    truncated: false,
    fetchedAt: new Date().toISOString(),
  };
}

function pageHtml(data, tab) {
  // The bundle calls acquireVsCodeApi() at import time, so the stub has to be
  // installed before the script tag — hence an inline script, not a module.
  return `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="./webview.css"></head>
<body><div id="root"></div>
<script>
const SNAPSHOT = ${JSON.stringify(data).replace(/</g, '\\u003c')};
const STATE = { tab: ${JSON.stringify(tab)}, query: { includeClosed: false } };

function reply(id, data) {
  window.postMessage({ kind: 'response', id, ok: true, data }, '*');
}

window.acquireVsCodeApi = () => ({
  postMessage(message) {
    // The webview announces itself and waits to be pushed a snapshot — the same
    // handshake DashboardPanel performs.
    if (message.kind === 'ready') {
      return window.postMessage({ kind: 'event', name: 'issuesChanged', snapshot: SNAPSHOT }, '*');
    }
    if (message.kind !== 'request') return;
    const { id, method, params } = message;
    if (method === 'getSnapshot') return reply(id, SNAPSHOT);
    if (method === 'showBead') {
      const bead = SNAPSHOT.beads.find((candidate) => candidate.id === params.id) ?? null;
      return reply(id, { bead, comments: [] });
    }
    if (method === 'listChildren') {
      return reply(id, SNAPSHOT.beads.filter((bead) => bead.parent === params.parentId));
    }
    if (method === 'listBeads') return reply(id, SNAPSHOT.beads);
    // Mutations are not exercised here; acknowledge so the UI does not toast.
    return reply(id, { ok: true });
  },
  getState: () => STATE,
  setState() {},
});
</script>
<script src="./webview.js"></script>
</body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const widthArg = args.indexOf('--width');
  const tabArg = args.indexOf('--tab');
  const widths = widthArg === -1 ? WIDTHS : args[widthArg + 1].split(',').map(Number);
  const tabs = tabArg === -1 ? TABS : [args[tabArg + 1]];
  const stressArg = args.indexOf('--stress');

  await mkdir(artifactsDir, { recursive: true });

  console.log('› reading bd');
  const data = await snapshot();

  // `--stress 2000` clones the real issues up to a target count, so the large
  // -workspace criterion is measured rather than assumed. Ids stay unique and
  // parents keep pointing at real epics.
  if (stressArg !== -1) {
    const target = Number(args[stressArg + 1] ?? 2000);
    const original = data.beads.slice();
    for (let copy = 1; data.beads.length < target; copy += 1) {
      for (const bead of original) {
        if (data.beads.length >= target) break;
        data.beads.push({ ...bead, id: `${bead.id}-x${copy}`, title: `${bead.title} (${copy})` });
      }
    }
    data.stats = { ...data.stats, total_issues: data.beads.length };
  }

  console.log(`› ${data.beads.length} issues, ${data.vocabulary.statuses.length} statuses`);

  const browser = await chromium.launch();
  let failures = 0;

  try {
    for (const tab of tabs) {
      const htmlPath = join(repoRoot, 'dist', `preview-${tab}.html`);
      await writeFile(htmlPath, pageHtml(data, tab), 'utf8');

      for (const width of widths) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          colorScheme: 'dark',
        });

        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
          if (args.includes('--verbose')) console.log(`    [${message.type()}] ${message.text()}`);
        });

        const started = Date.now();
        await page.goto(pathToFileURL(htmlPath).href);
        await page.locator('[role="tablist"]').waitFor({ timeout: 30_000 });
        // Wait for real content, not just the shell: the header only reports an
        // issue count once a snapshot has arrived.
        await page
          .locator('text=/\\d+ issues/')
          .first()
          .waitFor({ timeout: 60_000 });
        const paintedIn = Date.now() - started;
        // Recharts measures its container before drawing; give it a frame.
        await page.waitForTimeout(1200);

        const shot = join(artifactsDir, `preview-${tab}-${width}.png`);
        await page.screenshot({ path: shot, fullPage: true });

        // A page that scrolls sideways has broken its container queries.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );

        const label = `${tab} @ ${width}px`;
        if (errors.length > 0) {
          failures += 1;
          console.log(`  ✘ ${label} — ${errors[0]}`);
        } else if (overflow) {
          failures += 1;
          console.log(`  ✘ ${label} — the page scrolls horizontally`);
        } else {
          console.log(`  ✔ ${label} — first paint ${paintedIn}ms`);
        }

        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`› screenshots in ${artifactsDir}`);
  if (failures > 0) {
    console.error(`✘ ${failures} preview(s) failed.`);
    process.exitCode = 1;
  }
}

await main();
