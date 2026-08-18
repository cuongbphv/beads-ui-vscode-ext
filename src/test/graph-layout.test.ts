import { describe, expect, it } from 'vitest';

import type { Bead } from '../shared/types';
import { buildGraphLayout, COL_W } from '../webview/lib/graph-layout';

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return {
    title: partial.id,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...partial,
  };
}

/** `B` depends_on `A` with kind `blocks` — bd's own reading is "A blocks B". */
function blocks(dependsOnId: string) {
  return { depends_on_id: dependsOnId, type: 'blocks' };
}

function parentChild(parentId: string) {
  return { depends_on_id: parentId, type: 'parent-child' };
}

describe('buildGraphLayout', () => {
  it('lays out a chain A->B->C by longest-path layer', () => {
    const beads: Bead[] = [
      bead({ id: 'a' }),
      bead({ id: 'b', dependencies: [blocks('a')] }),
      bead({ id: 'c', dependencies: [blocks('b')] }),
    ];

    const layout = buildGraphLayout(beads);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));

    expect(byId.get('a')?.x).toBe(0);
    expect(byId.get('b')?.x).toBe(COL_W);
    expect(byId.get('c')?.x).toBe(2 * COL_W);
  });

  it('dedupes a diamond so the shared sink appears once at the deepest layer', () => {
    const beads: Bead[] = [
      bead({ id: 'a' }),
      bead({ id: 'b', dependencies: [blocks('a')] }),
      bead({ id: 'c', dependencies: [blocks('a')] }),
      bead({ id: 'd', dependencies: [blocks('b'), blocks('c')] }),
    ];

    const layout = buildGraphLayout(beads);
    const dNodes = layout.nodes.filter((n) => n.id === 'd');
    expect(dNodes).toHaveLength(1);
    expect(dNodes[0].x).toBe(2 * COL_W);
    // Both edges into d are kept (not collapsed away).
    const intoD = layout.edges.filter((e) => e.to === 'd');
    expect(intoD).toHaveLength(2);
  });

  it('renders a cyclic dependency without hanging or crashing', () => {
    const beads: Bead[] = [
      bead({ id: 'a', dependencies: [blocks('b')] }),
      bead({ id: 'b', dependencies: [blocks('a')] }),
    ];

    const layout = buildGraphLayout(beads);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(2);
    // Every node landed at a finite, non-negative coordinate.
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
    }
  });

  it('drops an edge whose target is not in the visible bead set, without a ghost node', () => {
    const beads: Bead[] = [bead({ id: 'a', dependencies: [blocks('zzz')] })];

    const layout = buildGraphLayout(beads);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });

  it('only renders beads that have at least one valid edge', () => {
    const beads: Bead[] = [
      bead({ id: 'a' }),
      bead({ id: 'b', dependencies: [blocks('a')] }),
      bead({ id: 'lonely' }),
    ];

    const layout = buildGraphLayout(beads);
    const ids = layout.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('is deterministic across repeated calls on the same input', () => {
    const beads: Bead[] = [
      bead({ id: 'a' }),
      bead({ id: 'b', dependencies: [blocks('a')] }),
      bead({ id: 'c', dependencies: [blocks('a')] }),
    ];

    const first = buildGraphLayout(beads);
    const second = buildGraphLayout(beads);
    expect(second).toEqual(first);
  });

  it('breaks order ties by id when nothing else distinguishes two siblings', () => {
    const beads: Bead[] = [
      bead({ id: 'a' }),
      bead({ id: 'zed', dependencies: [blocks('a')] }),
      bead({ id: 'alpha', dependencies: [blocks('a')] }),
    ];

    const layout = buildGraphLayout(beads);
    const layer1 = layout.nodes.filter((n) => n.x === COL_W).sort((x, y) => x.y - y.y);
    expect(layer1.map((n) => n.id)).toEqual(['alpha', 'zed']);
  });

  it('reads the resolved edge shape (id / dependency_type) the same as the raw edge shape', () => {
    const beads: Bead[] = [
      bead({ id: 'a' }),
      bead({ id: 'b', dependencies: [{ id: 'a', dependency_type: 'blocks' }] }),
    ];

    const layout = buildGraphLayout(beads);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get('b')?.x).toBe(COL_W);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ from: 'a', to: 'b', kind: 'blocks' });
  });

  it('renders parent-child edges alongside blocks edges', () => {
    const beads: Bead[] = [
      bead({ id: 'epic', issue_type: 'epic' }),
      bead({ id: 'task', dependencies: [parentChild('epic')] }),
    ];

    const layout = buildGraphLayout(beads);
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['epic', 'task']);
    expect(layout.edges[0]).toMatchObject({ from: 'epic', to: 'task', kind: 'parent-child' });
  });

  it('drops related/discovered-from edges for v1 and does not surface beads that only carry them', () => {
    const beads: Bead[] = [
      bead({ id: 'a' }),
      bead({ id: 'b', dependencies: [{ depends_on_id: 'a', type: 'related' }] }),
    ];

    const layout = buildGraphLayout(beads);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });

  it('produces an empty layout for an empty bead list', () => {
    const layout = buildGraphLayout([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});
