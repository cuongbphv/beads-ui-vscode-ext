/**
 * Where the slow-suite budget is allowed to live.
 *
 * `bd-live.test.ts` spawns the real CLI and needs seconds; the other suites are
 * pure and must not. The obvious "fix" for a timeout flake is to raise
 * `testTimeout` in the shared config, which buys the bd suite its headroom by
 * removing the ceiling that would catch a unit test that quietly got slow.
 * These assertions keep the budget where the cost actually is.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const config = readFileSync(resolve('vitest.config.mts'), 'utf8');
const bdLive = readFileSync(resolve('src/test/bd-live.test.ts'), 'utf8');

describe('test timeouts', () => {
  it('leaves the shared timeout unset, at the vitest default', () => {
    expect(config).not.toMatch(/\btestTimeout\b/u);
    expect(config).not.toMatch(/\bhookTimeout\b/u);
  });

  it('gives the bd-spawning suite a timeout of its own', () => {
    // Both: a test's budget and the beforeAll that primes `queries.list` for it.
    expect(bdLive).toMatch(/vi\.setConfig\(/u);
    expect(bdLive).toMatch(/testTimeout:/u);
    expect(bdLive).toMatch(/hookTimeout:/u);
  });
});
