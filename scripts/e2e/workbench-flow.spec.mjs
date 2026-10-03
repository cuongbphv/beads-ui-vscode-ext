#!/usr/bin/env node
/** Ready → Claim → human gate, cross-checked against an isolated Beads project. */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron } from 'playwright';
import { cleanEnv, scrubProcessEnv } from '../lib/clean-env.mjs';

const testVersion = process.env.VSCODE_TEST_VERSION ?? '1.105.0';
scrubProcessEnv();

const exec = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const actor = 'workbench-e2e';
const bdEnv = { ...process.env, BD_JSON_ENVELOPE: '0', BEADS_ACTOR: actor };
delete bdEnv.BEADS_DIR;

async function bd(cwd, args) {
  const options = { cwd, env: bdEnv, encoding: 'utf8', windowsHide: true, timeout: 30_000 };
  try {
    return await exec('bd', args, options);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return exec('bd', args, { ...options, shell: true });
  }
}

async function bdJson(cwd, args) {
  const { stdout } = await bd(cwd, [...args, '--json']);
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : parsed.issues ?? parsed;
}

async function show(cwd, id) {
  const result = await bdJson(cwd, ['show', id]);
  return Array.isArray(result) ? result[0] : result;
}

async function readyIds(cwd) {
  const rows = await bdJson(cwd, ['ready']);
  return new Set(rows.map((row) => row.id));
}

async function main() {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'beads-ui-e2e-workbench-'));
  const profileDir = await mkdtemp(join(tmpdir(), 'beads-ui-e2e-profile-'));
  const extensionsDir = await mkdtemp(join(tmpdir(), 'beads-ui-e2e-extensions-'));
  let app;
  try {
    await exec('npm', ['run', 'build'], { cwd: repoRoot, timeout: 120_000 });
    await bd(scratchRoot, ['init', '--non-interactive', '--skip-hooks', '--skip-agents', '--prefix', 'flow']);
    // The Molecules view fetches project gates when at least one molecule
    // root exists, so provide the smallest real formula/pour fixture.
    const epic = await bdJson(scratchRoot, ['create', 'Review flow', '--type', 'epic']);
    const step = await bdJson(scratchRoot, ['create', 'Review step', '--type', 'task']);
    await bd(scratchRoot, ['dep', 'add', step.id, epic.id, '--type', 'parent-child']);
    await bd(scratchRoot, ['mol', 'distill', epic.id, 'reviewflow']);
    await bd(scratchRoot, ['mol', 'pour', 'reviewflow']);
    const readyIssue = await bdJson(scratchRoot, ['create', 'Claim this ready issue']);
    const gatedIssue = await bdJson(scratchRoot, ['create', 'Work after approval']);
    const gate = await bdJson(scratchRoot, [
      'gate', 'create', '--blocks', gatedIssue.id, '--reason', 'Approve workbench E2E',
    ]);
    if (gate.await_type !== 'human') throw new Error(`Expected a human gate, got ${gate.await_type}`);
    if (!(await readyIds(scratchRoot)).has(readyIssue.id)) throw new Error('Fixture issue is not ready');
    if ((await readyIds(scratchRoot)).has(gatedIssue.id)) throw new Error('Gated fixture is unexpectedly ready');

    await mkdir(join(profileDir, 'User'), { recursive: true });
    await writeFile(join(profileDir, 'User', 'settings.json'), JSON.stringify({
      'beadsDashboard.assignee': actor,
      'workbench.colorTheme': process.env.BEADS_TEST_THEME ?? 'Default Dark Modern',
      'window.commandCenter': false,
    }));
    const executablePath = await downloadAndUnzipVSCode(testVersion);
    app = await _electron.launch({
      executablePath,
      timeout: 180_000,
      args: [
        `--extensionDevelopmentPath=${repoRoot}`,
        `--user-data-dir=${profileDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--disable-workspace-trust', '--disable-gpu', '--no-sandbox',
        '--skip-welcome', '--skip-release-notes', '--disable-updates', scratchRoot,
      ],
      env: cleanEnv({ BD_JSON_ENVELOPE: '0', BEADS_ACTOR: actor, BEADS_DIR: join(scratchRoot, '.beads') }),
    });
    const window = await app.firstWindow({ timeout: 180_000 });
    window.setDefaultTimeout(90_000);
    await window.locator('.monaco-workbench').waitFor();

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    async function palette(label) {
      await window.keyboard.press(`${mod}+Shift+P`);
      const input = window.locator('.quick-input-box input');
      await input.waitFor();
      await input.fill(`>${label}`);
      await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
      await window.keyboard.press('Enter');
    }

    await palette('Beads: Open Dashboard');
    const inner = window.frameLocator('iframe.webview').frameLocator('#active-frame');
    const readySection = inner.locator('section[aria-label="Ready to start"]');
    await readySection.getByRole('button', { name: `Claim ${readyIssue.id}` }).waitFor();
    if (await readySection.getByRole('button', { name: `Claim ${gatedIssue.id}` }).count()) {
      throw new Error('Gated issue was offered as Ready');
    }

    await readySection.getByRole('button', { name: `Claim ${readyIssue.id}` }).click();
    await window.waitForTimeout(800);
    const claimed = await show(scratchRoot, readyIssue.id);
    if (claimed.assignee !== actor || claimed.status !== 'in_progress') {
      throw new Error(`Claim did not land: ${JSON.stringify({ assignee: claimed.assignee, status: claimed.status })}`);
    }
    await readySection.getByRole('button', { name: `Claim ${readyIssue.id}` }).waitFor({ state: 'detached' });

    await inner.getByRole('tab', { name: 'Molecules' }).click();
    const gateCard = inner.locator(`article[aria-label^="${gate.id}:"]`);
    await gateCard.getByRole('button', { name: 'Resolve' }).waitFor();
    await gateCard.getByRole('button', { name: 'Resolve' }).click();
    await gateCard.waitFor({ state: 'detached' });
    const resolved = await show(scratchRoot, gate.id);
    if (resolved.status === 'open') throw new Error('Human gate remained open after UI resolution');
    if (!(await readyIds(scratchRoot)).has(gatedIssue.id)) throw new Error('Gate target did not become ready');

    await inner.getByRole('tab', { name: 'Overview' }).click();
    await readySection.getByRole('button', { name: `Claim ${gatedIssue.id}` }).waitFor();
    console.log('✔ Ready → Claim → human gate → newly ready target matched bd throughout');
  } finally {
    try {
      if (app) await app.close();
    } finally {
      await Promise.all([
        rm(scratchRoot, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 }),
        rm(profileDir, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 }),
        rm(extensionsDir, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 }),
      ]);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
