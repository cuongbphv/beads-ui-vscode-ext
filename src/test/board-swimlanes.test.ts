import { describe, expect, it } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead, StatusDef } from '../shared/types';
import {
  TAXONOMY_LANES,
  UNLABELED,
  buildSwimlanes,
  laneDropId,
  laneOf,
  narrowDropId,
  parseDropId,
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

function planBead(id: string, issueType: 'epic' | 'milestone', labels?: string[]): Bead {
  return { id, title: id, status: 'open', priority: 2, issue_type: issueType, labels };
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

  it('keeps unlabeled plan-type beads (epic, milestone) out of the unlabeled warning lane', () => {
    const lanes = buildSwimlanes([planBead('e-1', 'epic'), planBead('m-1', 'milestone')], index());
    expect(lanes.map((lane) => lane.lane)).toEqual([...TAXONOMY_LANES]);
  });

  it('does not let plan-type beads inflate the unlabeled lane a real task earned', () => {
    const lanes = buildSwimlanes([bead('b-1'), planBead('e-1', 'epic')], index());
    const unlabeled = lanes.find((lane) => lane.lane === UNLABELED);
    expect(unlabeled?.columns.flatMap((c) => c.beads.map((b) => b.id))).toEqual(['b-1']);
  });

  it('still places an explicitly labeled epic in its taxonomy lane', () => {
    const lanes = buildSwimlanes([planBead('e-1', 'epic', ['needs-human'])], index());
    const needsHuman = lanes.find((lane) => lane.lane === 'needs-human');
    expect(needsHuman?.columns.flatMap((c) => c.beads.map((b) => b.id))).toEqual(['e-1']);
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

describe('board droppable ids', () => {
  it('round-trips lane and category through the composite id', () => {
    const lanes: Lane[] = [...TAXONOMY_LANES, UNLABELED];
    for (const lane of lanes) {
      for (const category of ['active', 'wip', 'done', 'frozen', 'unspecified'] as const) {
        expect(parseDropId(laneDropId(lane, category))).toEqual({
          narrow: false,
          lane,
          category,
        });
      }
    }
  });

  it('reads a bare category id — the flat wide board’s own shape — as a lane-less target', () => {
    expect(parseDropId('active')).toEqual({ narrow: false, category: 'active' });
  });

  it('marks the narrow layout’s copy of a column without losing its category', () => {
    expect(parseDropId(narrowDropId('active'))).toEqual({ narrow: true, category: 'active' });
  });

  it('marks the narrow layout’s copy of a lane column without losing lane or category', () => {
    expect(parseDropId(narrowDropId(laneDropId('needs-human', 'wip')))).toEqual({
      narrow: true,
      lane: 'needs-human',
      category: 'wip',
    });
  });

  it('gives the narrow and the wide copy of one column two different ids', () => {
    expect(narrowDropId('active')).not.toBe('active');
    expect(narrowDropId(laneDropId('auto-ok', 'wip'))).not.toBe(laneDropId('auto-ok', 'wip'));
  });

  it('never lets a real lane name be mistaken for the narrow marker', () => {
    // `parseDropId` strips the narrow marker before it looks for a lane, so a
    // lane actually called `narrow` would be read as the marker instead.
    const lanes: string[] = [...TAXONOMY_LANES, UNLABELED];
    expect(lanes).not.toContain('narrow');
  });
});
