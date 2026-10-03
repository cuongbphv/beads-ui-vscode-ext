/** Run the opt-in Beads 1.3.1 qualification with verified Linux binaries. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const releases = [
  {
    name: 'bd',
    url: 'https://github.com/gastownhall/beads/releases/download/v1.3.1/beads_1.3.1_linux_amd64.tar.gz',
    sha256: '3219443a9734b89b93fb16ee8d65844759fa1b3cd3cf139c606b7353cfb0715c',
  },
  {
    name: 'dolt',
    url: 'https://github.com/dolthub/dolt/releases/download/v2.4.0/dolt-linux-amd64.tar.gz',
    sha256: 'cd08696de8d185aa194c930f62cdf4a3599084534e589fbcb0d2207d1bc37370',
  },
];

function findBinary(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(full, name);
      if (found) return found;
    } else if (entry.isFile() && entry.name === name) {
      return full;
    }
  }
  return undefined;
}

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('This qualification runner requires Linux x64');
}

const root = mkdtempSync(path.join(tmpdir(), 'beads-compat-ci-'));
try {
  const binaries = new Map();
  for (const release of releases) {
    const archive = path.join(root, `${release.name}.tar.gz`);
    const unpacked = path.join(root, release.name);
    execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '3', '--output', archive, release.url], { timeout: 180_000 });
    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
    if (actual !== release.sha256) {
      throw new Error(`${release.name} SHA-256 mismatch: expected ${release.sha256}, got ${actual}`);
    }
    execFileSync('mkdir', ['-p', unpacked]);
    execFileSync('tar', ['-xzf', archive, '-C', unpacked], { timeout: 60_000 });
    const binary = findBinary(unpacked, release.name);
    if (!binary) throw new Error(`${release.name} binary missing from verified archive`);
    chmodSync(binary, 0o755);
    binaries.set(release.name, binary);
  }

  const env = { ...process.env, BEADS_COMPAT_BD: binaries.get('bd') };
  delete env.BEADS_DIR;
  env.PATH = `${path.dirname(binaries.get('dolt'))}${path.delimiter}${env.PATH ?? ''}`;
  console.log(execFileSync(binaries.get('bd'), ['version'], { env, encoding: 'utf8', timeout: 10_000 }).trim());
  console.log(execFileSync(binaries.get('dolt'), ['version'], { env, encoding: 'utf8', timeout: 10_000 }).trim());
  execFileSync('npm', ['test', '--', '--run', 'src/test/bd-events-live.test.ts'], {
    env,
    stdio: 'inherit',
    timeout: 12 * 60_000,
  });
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
}
