#!/usr/bin/env node
/**
 * Build → package → install, in one command.
 *
 *   npm run install:local
 *
 * Leaves a .vsix in the repo root and installs it into your editor. After it
 * finishes, reload the window (Ctrl+Shift+P → "Developer: Reload Window") and
 * the new build is live — no F5, no Extension Development Host.
 *
 * Options:
 *   --skip-build   package what is already in dist/
 *   --skip-install just produce the .vsix
 *   --cli <name>   editor CLI to install into (default: auto-detect)
 *
 * The editor CLI can also come from $VSCODE_CLI, which is what you want for
 * VSCode Insiders, Cursor, Windsurf and other forks.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const vsixName = `${pkg.name}-${pkg.version}.vsix`;

/** npm and vsce are .cmd shims on Windows, so these have to go through a shell. */
function run(command, args, label) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`\n✘ ${label} failed (exit ${result.status ?? 'signal'}).`);
    process.exit(result.status ?? 1);
  }
}

/** First editor CLI that answers `--version`. */
function detectEditorCli() {
  const explicit = valueOf('--cli') ?? process.env.VSCODE_CLI;
  if (explicit) return explicit;

  for (const candidate of ['code', 'code-insiders', 'cursor', 'windsurf', 'codium']) {
    try {
      execFileSync(candidate, ['--version'], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
      });
      return candidate;
    } catch {
      // Not installed, or not on PATH — try the next one.
    }
  }
  return undefined;
}

// Stale .vsix files are the classic "why is my change not showing up" trap.
for (const file of readdirSync(repoRoot).filter((name) => name.endsWith('.vsix'))) {
  unlinkSync(join(repoRoot, file));
}

if (!has('--skip-build')) {
  run('npm', ['run', 'build:prod'], 'Building extension + webview bundles');
}

run('npx', ['vsce', 'package', '--no-dependencies', '--out', vsixName], `Packaging ${vsixName}`);

if (has('--skip-install')) {
  console.log(`\n✔ ${vsixName} is ready. Install it with:\n    code --install-extension ${vsixName}`);
  process.exit(0);
}

const cli = detectEditorCli();
if (!cli) {
  console.error(
    `\n✘ No editor CLI found on PATH.\n` +
      `  ${vsixName} was built successfully — install it by hand:\n` +
      `    Command Palette → "Extensions: Install from VSIX…"\n` +
      `  Or add the CLI to PATH (VSCode: Command Palette → "Shell Command: Install 'code' command in PATH")\n` +
      `  and re-run, or pass one explicitly:  npm run install:local -- --cli cursor`,
  );
  process.exit(1);
}

run(cli, ['--install-extension', vsixName, '--force'], `Installing into "${cli}"`);

console.log(
  `\n✔ ${pkg.displayName ?? pkg.name} ${pkg.version} installed into "${cli}".\n` +
    `  Reload the window to pick it up:  Ctrl+Shift+P → "Developer: Reload Window"\n` +
    `  Then open the Beads icon in the Activity Bar.`,
);
