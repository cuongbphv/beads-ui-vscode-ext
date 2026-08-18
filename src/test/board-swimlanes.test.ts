import { describe, expect, it } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead, StatusDef } from '../shared/types';
import {
  TAXONOMY_LANES,
  UNLABELED,
  buildSwimlanes,
  laneDropId,
  laneOf,
  parseLaneDropId,
  type Lane,
} from '../webview/lib/board-swimlanes';

const STATUSES: StatusDef[] = [
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'done', category: 'done' },
];

function index(): StatusIndex {
  return new StatusIndex(STATUSES);
}

function bead(id: string, labels?: string[], status = 'open'): Bead {
  return { id, title: id, status, priority: 2, issue_type: 'task', labels };
}

describe('laneOf', () => {
  it('falls back to unlabeled when no taxonomy label is present', () => {
    expect(laneOf(bead('b-1'))).toBe(UNLABELED);
    expect(laneOf(bead('b-2', ['some-other-label']))).toBe(UNLABELED);
  });

  it('resolves a single taxonomy label to its lane', () => {
    expect(laneOf(bead('b-1', ['auto-ok']))).toBe('auto-ok');
    expect(laneOf(bead('b-2', ['auto-partial']))).toBe('auto-partial');
    expect(laneOf(bead('b-3', ['needs-human']))).toBe('needs-human');
  });

  it('is conservative: needs-human beats auto-partial and auto-ok', () => {
    expect(laneOf(bead('b-1', ['auto-ok', 'needs-human']))).toBe('needs-human');
    expect(laneOf(bead('b-2', ['needs-human', 'auto-partial']))).toBe('needs-human');
  });

  it('is conservative: auto-partial beats auto-ok', () => {
    expect(laneOf(bead('b-1', ['auto-ok', 'auto-partial']))).toBe('auto-partial');
  });
});

describe('buildSwimlanes', () => {
  it('always emits the three taxonomy lanes, in fixed order, even when empty', () => {
    const lanes = buildSwimlanes([], index());
    expect(lanes.map((lane) => lane.lane)).toEqual([...TAXONOMY_LANES]);
    expect(lanes.every((lane) => lane.warning === false)).toBe(true);
  });

  it('only emits the unlabeled lane when it has beads, and flags it as a warning', () => {
    const withUnlabeled = buildSwimlanes([bead('b-1')], index());
    expect(withUnlabeled.map((lane) => lane.lane)).toEqual([...TAXONOMY_LANES, UNLABELED]);
    expect(withUnlabeled.at(-1)?.warning).toBe(true);

    const withoutUnlabeled = buildSwimlanes([bead('b-1', ['auto-ok'])], index());
    expect(withoutUnlabeled.map((lane) => lane.lane)).toEqual([...TAXONOMY_LANES]);
  });

  it('places a bead with multiple labels in exactly one lane, the conservative one', () => {
    const lanes = buildSwimlanes([bead('b-1', ['auto-ok', 'needs-human'])], index());
    const counts = lanes.map((lane) => lane.columns.reduce((sum, c) => sum + c.beads.length, 0));
    expect(counts).toEqual([0, 0, 1]); // auto-ok, auto-partial, needs-human
  });

  it('runs buildColumns per lane so each lane still groups by status category', () => {
    const lanes = buildSwimlanes(
      [bead('b-1', ['auto-ok'], 'open'), bead('b-2', ['auto-ok'], 'done')],
      index(),
    );
    const autoOk = lanes.find((lane) => lane.lane === 'auto-ok');
    expect(autoOk?.columns.find((c) => c.category === 'active')?.beads.map((b) => b.id)).toEqual([
      'b-1',
    ]);
    expect(autoOk?.columns.find((c) => c.category === 'done')?.beads.map((b) => b.id)).toEqual([
      'b-2',
    ]);
  });
});

describe('laneDropId / parseLaneDropId', () => {
  it('round-trips lane and category through the composite id', () => {
    const lanes: Lane[] = [...TAXONOMY_LANES, UNLABELED];
    for (const lane of lanes) {
      for (const category of ['active', 'wip', 'done', 'frozen', 'unspecified'] as const) {
        const id = laneDropId(lane, category);
        expect(parseLaneDropId(id)).toEqual({ lane, category });
      }
    }
  });

  it('returns undefined for a bare category id (no separator) — the flat-board path', () => {
    expect(parseLaneDropId('active')).toBeUndefined();
  });
});
