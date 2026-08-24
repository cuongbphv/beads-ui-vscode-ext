/**
 * Blocker-chain analysis: the pure DFS behind the detail pane's "Why blocked"
 * section. Everything here runs against an in-memory bead list — no bd, no RPC.
 */
import { describe, expect, it } from 'vitest';

import { buildBlockerChain } from '../shared/blocker-chain';
import { StatusIndex } from '../shared/model';
import type { Bead, BeadDependency } from '../shared/types';

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'shipped', category: 'done' },
]);

function blocksEdge(from: string, to: string): BeadDependency {
  return { issue_id: from, depends_on_id: to, type: 'blocks' };
}

function bead(id: string, blockers: string[] = [], status = 'open'): Bead {
  return {
    id,
    title: `Title of ${id}`,
    status,
    priority: 2,
    issue_type: 'task',
    dependencies: blockers.map((blocker) => blocksEdge(id, blocker)),
  };
}

describe('buildBlockerChain', () => {
  it('returns an empty chain for a bead with no blocks edges', () => {
    const a = bead('a');
    const chain = buildBlockerChain(a, [a], index);

    expect(chain.nodes).toEqual([]);
    expect(chain.hasCycle).toBe(false);
  });

  it('walks a linear chain in preorder with increasing depth', () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['c']);
    const c = bead('c');
    const chain = buildBlockerChain(a, [a, b, c], index);

    expect(chain.nodes.map((node) => [node.id, node.depth])).toEqual([
      ['b', 1],
      ['c', 2],
    ]);
    expect(chain.nodes.every((node) => !node.cycle)).toBe(true);
    expect(chain.hasCycle).toBe(false);
  });

  it('shows a diamond blocker under each parent without flagging a cycle', () => {
    // a ← b, a ← c, b ← d, c ← d: d blocks a through two paths.
    const a = bead('a', ['b', 'c']);
    const b = bead('b', ['d']);
    const c = bead('c', ['d']);
    const d = bead('d');
    const chain = buildBlockerChain(a, [a, b, c, d], index);

    expect(chain.nodes.map((node) => [node.id, node.depth])).toEqual([
      ['b', 1],
      ['d', 2],
      ['c', 1],
      ['d', 2],
    ]);
    expect(chain.hasCycle).toBe(false);
  });

  it('flags a cycle instead of recursing forever', () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['a']);
    const chain = buildBlockerChain(a, [a, b], index);

    expect(chain.nodes.map((node) => [node.id, node.depth, node.cycle])).toEqual([
      ['b', 1, false],
      ['a', 2, true],
    ]);
    expect(chain.hasCycle).toBe(true);
  });

  it('flags a self-cycle (a bead recorded as blocking itself)', () => {
    const a = bead('a', ['a']);
    const chain = buildBlockerChain(a, [a], index);

    expect(chain.nodes.map((node) => [node.id, node.cycle])).toEqual([['a', true]]);
    expect(chain.hasCycle).toBe(true);
  });

  it('excludes closed blockers, by status category rather than status name', () => {
    // "shipped" is a custom done-category status: only the vocabulary knows that.
    const a = bead('a', ['b', 'c']);
    const b = bead('b', [], 'shipped');
    const c = bead('c', ['d'], 'in_progress');
    const d = bead('d', [], 'shipped');
    const chain = buildBlockerChain(a, [a, b, c, d], index);

    expect(chain.nodes.map((node) => node.id)).toEqual(['c']);
  });

  it('tolerates blocker ids missing from the loaded collection', () => {
    const a = bead('a', ['ghost']);
    const chain = buildBlockerChain(a, [a], index);

    expect(chain.nodes).toHaveLength(1);
    expect(chain.nodes[0].id).toBe('ghost');
    expect(chain.nodes[0].bead).toBeUndefined();
    expect(chain.nodes[0].depth).toBe(1);
    expect(chain.hasCycle).toBe(false);
  });

  it('ignores duplicate blocks edges to the same blocker', () => {
    const a = bead('a', ['b', 'b']);
    const b = bead('b');
    const chain = buildBlockerChain(a, [a, b], index);

    expect(chain.nodes.map((node) => node.id)).toEqual(['b']);
  });

  it('reads resolved-form edges (dependency_type/id) the same as raw edges', () => {
    const a: Bead = {
      id: 'a',
      title: 'Title of a',
      status: 'open',
      priority: 2,
      issue_type: 'task',
      dependencies: [{ id: 'b', dependency_type: 'blocks' }],
    };
    const b = bead('b');
    const chain = buildBlockerChain(a, [a, b], index);

    expect(chain.nodes.map((node) => node.id)).toEqual(['b']);
  });

  it('stops expanding below maxDepth but keeps the boundary row visible', () => {
    const a = bead('a', ['b']);
    const b = bead('b', ['c']);
    const c = bead('c', ['d']);
    const d = bead('d');
    const chain = buildBlockerChain(a, [a, b, c, d], index, { maxDepth: 2 });

    expect(chain.nodes.map((node) => [node.id, node.depth, node.truncated])).toEqual([
      ['b', 1, false],
      ['c', 2, true],
    ]);
  });
});
