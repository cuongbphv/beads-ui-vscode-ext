/**
 * The compact "why blocked" hint behind Overview's Blocked-list rows —
 * depth-1 only, never the full transitive chain (bead 72m.6).
 */
import { describe, expect, it, vi } from 'vitest';

import * as blockerChainModule from '../shared/blocker-chain';
import { directBlockerHint } from '../webview/lib/blocked-hint';
import { StatusIndex } from '../shared/model';
import type { Bead, BeadDependency } from '../shared/types';

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'closed', category: 'done' },
]);

function blocksEdge(to: string): BeadDependency {
  return { id: to, dependency_type: 'blocks' };
}

function bead(id: string, title: string, blockers: string[] = [], status = 'open'): Bead {
  return {
    id,
    title,
    status,
    priority: 2,
    issue_type: 'task',
    dependencies: blockers.map(blocksEdge),
  };
}

describe('directBlockerHint', () => {
  it('shows the direct blocker title when there is exactly one', () => {
    const a = bead('a', 'Ship the release', ['b']);
    const b = bead('b', 'Fix the flaky test');

    const hint = directBlockerHint(a, [a, b], index);

    expect(hint).toEqual({ title: 'Fix the flaky test', extra: 0 });
  });

  it('shows the first direct blocker title plus a count when there is more than one', () => {
    const a = bead('a', 'Ship the release', ['b', 'c', 'd']);
    const b = bead('b', 'Fix the flaky test');
    const c = bead('c', 'Update the schema');
    const d = bead('d', 'Rotate the API key');

    const hint = directBlockerHint(a, [a, b, c, d], index);

    expect(hint).toEqual({ title: 'Fix the flaky test', extra: 2 });
  });

  it('shows no hint when there is no open direct blocker (e.g. a stale poll tick)', () => {
    // "b" is the only recorded blocker and it is already closed — the row
    // still exists this tick, but the chain is empty.
    const a = bead('a', 'Ship the release', ['b']);
    const b = bead('b', 'Fix the flaky test', [], 'closed');

    const hint = directBlockerHint(a, [a, b], index);

    expect(hint).toBeUndefined();
  });

  it('shows no hint for a bead with no blocks edges at all', () => {
    const a = bead('a', 'Ship the release');

    const hint = directBlockerHint(a, [a], index);

    expect(hint).toBeUndefined();
  });

  it('falls back to the blocker id when its bead is not loaded', () => {
    const a = bead('a', 'Ship the release', ['ghost']);

    const hint = directBlockerHint(a, [a], index);

    expect(hint).toEqual({ title: 'ghost', extra: 0 });
  });

  it('only ever walks depth 1, never the full multi-hop chain builder', () => {
    // A deep chain: a <- b <- c <- d <- e. If this ever called the default,
    // unbounded walk, `c`/`d`/`e` would show up in the result.
    const a = bead('a', 'Ship the release', ['b']);
    const b = bead('b', 'Fix the flaky test', ['c']);
    const c = bead('c', 'Update the schema', ['d']);
    const d = bead('d', 'Rotate the API key', ['e']);
    const e = bead('e', 'Provision the box');
    const beads = [a, b, c, d, e];

    const spy = vi.spyOn(blockerChainModule, 'buildBlockerChain');

    const hint = directBlockerHint(a, beads, index);

    expect(hint).toEqual({ title: 'Fix the flaky test', extra: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(a, beads, index, { maxDepth: 1 });

    spy.mockRestore();
  });

  it('reuses a precomputed chain instead of calling the chain builder again', () => {
    const a = bead('a', 'Ship the release', ['b', 'c']);
    const b = bead('b', 'Fix the flaky test');
    const c = bead('c', 'Update the schema');
    const beads = [a, b, c];

    const precomputed = blockerChainModule.buildBlockerChain(a, beads, index);
    const spy = vi.spyOn(blockerChainModule, 'buildBlockerChain');

    const hint = directBlockerHint(a, beads, index, precomputed);

    expect(hint).toEqual({ title: 'Fix the flaky test', extra: 1 });
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
