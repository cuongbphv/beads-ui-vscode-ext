import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('.vscodeignore', () => {
  it('excludes local agent and review workspaces from the shipped VSIX', () => {
    const patterns = new Set(
      readFileSync(resolve('.vscodeignore'), 'utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
    );

    expect(patterns).toContain('.cursor/**');
    expect(patterns).toContain('.superpowers/**');
  });
});
