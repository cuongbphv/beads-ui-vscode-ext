#!/usr/bin/env node
/**
 * Downloads a real VS Code, launches it with this extension loaded, and runs
 * the activation smoke test against this repo's own beads database.
 *
 *   npm run test:electron
 *
 * Separate from `npm test` on purpose: it needs a ~150 MB download on first run
 * and a display, neither of which belongs in the unit-test loop.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runTests } from '@vscode/test-electron';

import { scrubProcessEnv } from './lib/clean-env.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Read before scrubbing — the scrub removes every VSCODE_* variable, this one
// included.
const testVersion = process.env.VSCODE_TEST_VERSION ?? '1.105.0';

// Must happen before runTests: it launches the editor with our own environment.
const scrubbed = scrubProcessEnv();
if (scrubbed.length) {
  console.log(`cleared inherited editor env: ${scrubbed.join(', ')}`);
}

const build = spawnSync('node', ['esbuild.mjs', '--tests'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) process.exit(build.status ?? 1);

// A throwaway profile: without it the copy installed by `npm run install:local`
// shares this extension's id and the development copy never loads.
const sandbox = join(repoRoot, '.vscode-test', 'profile');

try {
  await runTests({
    // Test against the minimum version `engines.vscode` promises, not the
    // latest — that is the version the manifest claims to support.
    version: testVersion,
    extensionDevelopmentPath: repoRoot,
    extensionTestsPath: join(repoRoot, 'dist', 'test', 'suite.js'),
    // The repo itself is the fixture: it has .beads and real issues, so the
    // test covers the actual bd round trip rather than a mock.
    // Passed as --folder-uri rather than a bare path so the argument can never
    // be mistaken for anything but a folder to open.
    launchArgs: [
      `--folder-uri=${pathToFileURL(repoRoot).href}`,
      '--user-data-dir',
      join(sandbox, 'user-data'),
      '--extensions-dir',
      join(sandbox, 'extensions'),
      '--disable-gpu',
    ],
  });
  console.log('\n✔ Electron smoke test passed.');
} catch (error) {
  console.error('\n✘ Electron smoke test failed.');
  console.error(error);
  process.exit(1);
}
