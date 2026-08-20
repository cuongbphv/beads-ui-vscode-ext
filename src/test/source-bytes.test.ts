/**
 * A raw NUL byte lived inside `src/extension/bd/BdService.ts` for months and
 * nothing in the repo noticed: `npm run lint` and `npm run typecheck` both stay
 * at rc=0, git reclassifies the file as binary so `git diff` and `git blame`
 * degrade to "Bin 0 -> N bytes", and plain `grep` returns nothing at all with
 * rc=1 — a silent false negative rather than an error. The byte is now written
 * as the escape `\u0000` (see `jsonShared` in BdService), and this file is the
 * thing that keeps it that way.
 *
 * Scope is an ALLOWLIST of text-ish extensions over the files git actually
 * tracks. A new PNG, GIF, font or `.vsix` is invisible to this test by
 * construction, so nobody ever has to "fix" a red build by deleting an asset;
 * the only maintenance is adding an extension when the repo starts carrying a
 * new *text* format, and forgetting to do that narrows coverage instead of
 * breaking the build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Extensions whose bytes are meant to be human-readable text. */
const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.sh',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

/** Text files the repo carries without an extension, or with a dotted name. */
const TEXT_BASENAMES = new Set([
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.vscodeignore',
  'LICENSE',
]);

/** Directories a fallback walk must never descend into. */
const SKIP_DIRS = new Set([
  '.beads',
  '.dolt',
  '.git',
  '.vscode-test',
  '.worktrees',
  'coverage',
  'dist',
  'node_modules',
]);

function isTextish(repoPath: string): boolean {
  const name = repoPath.slice(repoPath.lastIndexOf('/') + 1);
  if (TEXT_BASENAMES.has(name)) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** Paths git tracks, repo-relative and slash-separated, or null if git cannot answer. */
function trackedFiles(): string[] | null {
  try {
    const stdout = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const paths = stdout.split('\0').filter((line) => line !== '');
    return paths.length > 0 ? paths : null;
  } catch {
    // No git on PATH, or this is a plain directory rather than a checkout.
    return null;
  }
}

/**
 * Fallback for the no-git case. Deliberately not a skip: a suite that quietly
 * stops looking is the exact failure mode this file exists to prevent.
 */
function walkedFiles(): string[] {
  const found: string[] = [];
  const visit = (absDir: string, prefix: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(join(absDir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        found.push(`${prefix}${entry.name}`);
      }
    }
  };
  visit(repoRoot, '');
  return found;
}

const source = trackedFiles();
const files = (source ?? walkedFiles())
  .filter(isTextish)
  // `git ls-files` still lists a tracked file that has been deleted on disk.
  .filter((repoPath) => {
    const abs = join(repoRoot, ...repoPath.split('/'));
    return existsSync(abs) && statSync(abs).isFile();
  });

/** Byte offset of the first NUL, plus the 1-based line it lands on. */
function findNul(bytes: Buffer): { offset: number; line: number } | null {
  const offset = bytes.indexOf(0);
  if (offset < 0) return null;
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (bytes[i] === 0x0a) line += 1;
  }
  return { offset, line };
}

describe('source bytes', () => {
  it('enumerates the text sources it is meant to guard', () => {
    // A broken enumeration would make the NUL assertion below vacuously green.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('src/extension/bd/BdService.ts');
    expect(files.some((f) => f.endsWith('.png'))).toBe(false);
    if (source === null) {
      // Surfaced on purpose: the walk sees untracked files git would hide.
      console.warn('source-bytes: git unavailable, fell back to a directory walk');
    }
  });

  it('spots a NUL byte when there is one', () => {
    expect(findNul(Buffer.from('ok\nno\u0000pe\n', 'utf8'))).toEqual({ offset: 5, line: 2 });
    expect(findNul(Buffer.from('all clear\n', 'utf8'))).toBeNull();
  });

  it('finds no raw NUL byte in any of them', () => {
    const offenders = files.flatMap((repoPath) => {
      const hit = findNul(readFileSync(join(repoRoot, ...repoPath.split('/'))));
      return hit === null
        ? []
        : [`${repoPath}: byte offset ${hit.offset}, line ${hit.line}`];
    });

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            'Raw NUL (0x00) bytes in tracked text sources:',
            ...offenders.map((o) => `  ${o}`),
            '',
            'Git reclassifies such a file as binary, so `git diff` and `git blame`',
            'degrade to "Bin N bytes" and plain `grep` returns nothing with rc=1',
            'instead of an error. Delete the byte, or — if the value really is a',
            'NUL — write it as the escape \\u0000, the way BdService.ts:211 does.',
          ].join('\n'),
    ).toEqual([]);
  });
});
