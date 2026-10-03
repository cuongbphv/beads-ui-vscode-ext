#!/usr/bin/env node
/** Real VS Code Fleet flow using synthetic rollouts under an isolated CODEX_HOME. */
import { execFile } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron } from 'playwright';

import { cleanEnv, scrubProcessEnv } from '../lib/clean-env.mjs';

const version = process.env.VSCODE_TEST_VERSION ?? '1.105.0';
scrubProcessEnv();
const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scratch = await mkdtemp(join(tmpdir(), 'beads-fleet-codex-'));
const workspace = join(scratch, 'workspace');
const codexHome = join(scratch, 'codex-home');
const profile = join(scratch, 'profile');
const extensions = join(scratch, 'extensions');
const parentId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const codexLine = (payload) => JSON.stringify({ type: 'response_item', payload }) + '\n';
let app;

try {
  await mkdir(workspace, { recursive: true });
  await mkdir(join(profile, 'User'), { recursive: true });
  await mkdir(extensions, { recursive: true });
  await writeFile(join(profile, 'User', 'settings.json'), JSON.stringify({ 'window.commandCenter': false }));
  await run('bd', ['init', '--non-interactive', '--skip-hooks', '--skip-agents', '--prefix', 'e2e'], {
    cwd: workspace, env: cleanEnv({ BD_JSON_ENVELOPE: '0' }),
  });
  await run('git', ['init'], { cwd: workspace });
  await writeFile(join(workspace, 'fixture.txt'), 'Fleet E2E\n');
  await run('git', ['add', '.'], { cwd: workspace });
  await run('git', ['-c', 'user.name=Fleet Test', '-c', 'user.email=fleet@example.invalid', 'commit', '-m', 'fixture'], { cwd: workspace });
  const worktree = join(scratch, 'wt-e2e-abc');
  await run('git', ['worktree', 'add', '-b', 'work/e2e-abc', worktree], { cwd: workspace });

  const rollouts = join(codexHome, 'sessions', '2026', '10', '03');
  await mkdir(rollouts, { recursive: true });
  const parentFile = join(rollouts, `rollout-2026-10-03T10-00-00-${parentId}.jsonl`);
  const childFile = join(rollouts, `rollout-2026-10-03T10-00-01-${childId}.jsonl`);
  await writeFile(parentFile,
    JSON.stringify({ type: 'session_meta', payload: { id: parentId, cwd: workspace, source: 'vscode' } }) + '\n'
    + codexLine({ type: 'function_call', name: 'spawn_agent', arguments: JSON.stringify({ task_name: 'e2e_abc', message: `Implement bead e2e-abc in worktree ${worktree}.` }) }));
  await writeFile(childFile,
    JSON.stringify({ type: 'session_meta', payload: { id: childId, cwd: worktree, parent_thread_id: parentId, agent_path: '/root/e2e_abc' } }) + '\n'
    + codexLine({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic older history' }] })
    + Array.from({ length: 70 }, (_, index) => JSON.stringify({ type: 'event_msg', payload: { index, padding: 'x'.repeat(4096) } }) + '\n').join('')
    + codexLine({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic backfill' }] }));

  await run('npm', ['run', 'build'], { cwd: repoRoot, shell: process.platform === 'win32' });
  const executablePath = await downloadAndUnzipVSCode(version);
  app = await _electron.launch({
    executablePath, timeout: 180_000,
    args: [
      `--extensionDevelopmentPath=${repoRoot}`, `--user-data-dir=${profile}`,
      `--extensions-dir=${extensions}`, '--disable-workspace-trust', '--disable-gpu',
      '--no-sandbox', '--skip-welcome', '--skip-release-notes', '--disable-updates', workspace,
    ],
    env: cleanEnv({ CODEX_HOME: codexHome, BD_JSON_ENVELOPE: '0' }),
  });
  const window = await app.firstWindow({ timeout: 180_000 });
  window.setDefaultTimeout(90_000);
  await window.locator('.monaco-workbench').waitFor();
  await window.waitForTimeout(2000);
  await window.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+P`);
  const palette = window.locator('.quick-input-box input');
  await palette.waitFor();
  await palette.fill('>Beads: Open Dashboard');
  await window.locator('.quick-input-list .monaco-list-row').first().waitFor();
  await window.keyboard.press('Enter');
  const webview = window.frameLocator('iframe.webview').frameLocator('#active-frame');
  await webview.locator('[role="tab"]:has-text("Fleet")').first().click();
  const worker = webview.locator(`li[role="button"][aria-label^="Codex worker ${childId}"]`);
  await worker.waitFor({ state: 'visible' });
  const header = webview.locator(`header[role="button"][aria-label^="Codex orchestrator session ${parentId}"]`);
  await header.waitFor({ state: 'visible' });
  if (await webview.locator('section[aria-label="Unassociated worktrees"]').count()) {
    throw new Error('Matched Codex worktree appeared in unassociated list');
  }
  await worker.click();
  const transcript = webview.locator(`aside[aria-label="Transcript for Codex worker ${childId}"]`);
  await transcript.waitFor({ state: 'visible' });
  await transcript.getByText('Synthetic backfill').waitFor();
  if (await transcript.getByText('Synthetic backfill').count() !== 1) {
    throw new Error('Codex backfill rendered more than once');
  }
  if (await transcript.getByText('Synthetic older history').count()) {
    throw new Error('Older Codex history appeared inside the bounded initial backfill');
  }
  await transcript.getByRole('button', { name: 'Load older events' }).click();
  await transcript.getByText('Synthetic older history').waitFor();
  const search = transcript.getByRole('searchbox', { name: 'Search loaded transcript' });
  await search.fill('Synthetic older history');
  await transcript.getByText('1 matches in loaded events').waitFor();
  await transcript.getByRole('button', { name: 'Latest' }).click();
  if (await search.inputValue()) throw new Error('Latest did not clear transcript search');
  await appendFile(childFile, codexLine({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic append' }] }));
  await transcript.getByText('Synthetic append').first().waitFor();
  await window.waitForTimeout(1600); // covers another discovery and tail poll tick
  if (await transcript.getByText('Synthetic append').count() !== 1) {
    throw new Error('Codex transcript append rendered more than once');
  }
  console.log('Fleet Codex E2E passed: discovery, labels, worktree link, transcript history/search/latest and append');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
