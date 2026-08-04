import { describe, expect, it } from 'vitest';

import type { Bead } from '../shared/types';
import {
  applyFlips,
  indexByVeloxId,
  markFor,
  parseRoadmap,
  planExport,
  planImport,
  shortTitle,
  veloxIdOf,
} from '../shared/velox';

/** A roadmap in the exact shape Velox's own template produces. */
const ROADMAP = `# Milestone M004 — Settings, Scale, QA & Packaging

**Estimate:** 5-7 hours

Legend: \`[x]\` = Done | \`[~]\` = Partial | \`[ ]\` = Missing/Not started

## Slice S4A: extension-host (Backend)

| Task | Endpoint / Feature | Source Reference | Status | Notes |
|------|-------------------|-----------------|--------|-------|
| T401 | Settings contribution | package.json | [x] | |
| T403 | Multi-root handling | src/extension/extension.ts | [ ] | |

## Slice S4B: polish-and-release (Frontend)

| Task | Page / Component | Source Reference | Type | Status | Notes |
|------|-----------------|-----------------|------|--------|-------|
| T402 | Large-list handling: honour issueLimit, add Load more | src/webview/views/BoardView.tsx | ui | [~] | started |
| T407 | Accessibility pass | src/webview/ | ui | [ ] | |

**Priority order:** T401 → T403
`;

function bead(partial: Partial<Bead> & Pick<Bead, 'id' | 'title'>): Bead {
  return {
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...partial,
  };
}

const categoryOf = (target: Bead): string =>
  target.status === 'closed' ? 'done' : target.status === 'in_progress' ? 'wip' : 'active';

describe('parseRoadmap', () => {
  const roadmap = parseRoadmap(ROADMAP, 'M004-ROADMAP.md');

  it('finds every task row across both tables', () => {
    expect(roadmap.tasks.map((task) => task.id)).toEqual(['T401', 'T403', 'T402', 'T407']);
  });

  it('carries the milestone and slice headings down to each row', () => {
    expect(roadmap.milestone).toBe('M004 — Settings, Scale, QA & Packaging');
    expect(roadmap.tasks[0].slice).toBe('S4A: extension-host (Backend)');
    expect(roadmap.tasks[2].slice).toBe('S4B: polish-and-release (Frontend)');
  });

  it('resolves cells by header, not by position', () => {
    // The second table has an extra Type column before Status.
    const t402 = roadmap.tasks.find((task) => task.id === 'T402');
    expect(t402?.mark).toBe('[~]');
    expect(t402?.kind).toBe('ui');
    expect(t402?.notes).toBe('started');
  });

  it('ignores prose tables and non-task rows', () => {
    const noise = parseRoadmap(
      ['| Item | Status |', '|---|---|', '| something | [x] |'].join('\n'),
      'x.md',
    );
    expect(noise.tasks).toEqual([]);
  });

  it('records the line each row is on', () => {
    const lines = ROADMAP.split('\n');
    for (const task of roadmap.tasks) {
      expect(lines[task.line]).toContain(task.id);
    }
  });
});

describe('veloxIdOf', () => {
  it('prefers external_ref over the title convention', () => {
    expect(veloxIdOf(bead({ id: 'x', title: 'T999 — wrong', external_ref: 'velox:T401' }))).toBe(
      'T401',
    );
  });

  it('falls back to a leading task id in the title', () => {
    expect(veloxIdOf(bead({ id: 'x', title: 'T402 — Large-list handling' }))).toBe('T402');
  });

  it('returns nothing for an unrelated issue', () => {
    expect(veloxIdOf(bead({ id: 'x', title: 'Fix the donut' }))).toBeUndefined();
    expect(veloxIdOf(bead({ id: 'x', title: 'Ticket T401 mentioned mid-sentence' }))).toBeUndefined();
  });

  it('keeps the first bead when two claim the same task', () => {
    const map = indexByVeloxId([
      bead({ id: 'first', title: 'T401 — one' }),
      bead({ id: 'second', title: 'T401 — duplicate' }),
    ]);
    expect(map.get('T401')?.id).toBe('first');
  });
});

describe('markFor', () => {
  it('maps by category, so custom statuses work', () => {
    expect(markFor('done')).toBe('[x]');
    expect(markFor('wip')).toBe('[~]');
    expect(markFor('active')).toBe('[ ]');
    expect(markFor('frozen')).toBe('[ ]');
  });
});

describe('planExport', () => {
  const roadmap = parseRoadmap(ROADMAP, 'M004-ROADMAP.md');

  it('returns only rows whose mark would change', () => {
    const plan = planExport(
      roadmap,
      [
        bead({ id: 'b1', title: 'T401 — Settings', status: 'closed' }), // already [x]
        bead({ id: 'b2', title: 'T403 — Multi-root', status: 'closed' }), // [ ] → [x]
        bead({ id: 'b3', title: 'T402 — Large-list', status: 'in_progress' }), // already [~]
      ],
      categoryOf,
    );

    expect(plan.flips.map((flip) => flip.task.id)).toEqual(['T403']);
    expect(plan.flips[0]).toMatchObject({ from: '[ ]', to: '[x]' });
    expect(plan.unmatched.map((task) => task.id)).toEqual(['T407']);
  });
});

describe('applyFlips', () => {
  const roadmap = parseRoadmap(ROADMAP, 'M004-ROADMAP.md');
  const beads = [bead({ id: 'b2', title: 'T403 — Multi-root', status: 'closed' })];
  const plan = planExport(roadmap, beads, categoryOf);

  it('rewrites only the status cell of the flipped row', () => {
    const next = applyFlips(ROADMAP, plan.flips);
    const lines = next.split('\n');

    expect(lines[plan.flips[0].task.line]).toContain('[x]');
    expect(lines[plan.flips[0].task.line]).toContain('src/extension/extension.ts');
    // Every other row is untouched, byte for byte.
    const before = ROADMAP.split('\n');
    for (let line = 0; line < before.length; line += 1) {
      if (line !== plan.flips[0].task.line) expect(lines[line]).toBe(before[line]);
    }
  });

  it('appends a note when the table has a Notes column', () => {
    const next = applyFlips(ROADMAP, plan.flips, 'synced');
    expect(next.split('\n')[plan.flips[0].task.line]).toContain('synced');
  });

  it('refuses to write a row that changed under it', () => {
    // Someone else already ticked T403 while the preview was open.
    const moved = ROADMAP.replace('| T403 | Multi-root handling | src/extension/extension.ts | [ ] |', '| T403 | Multi-root handling | src/extension/extension.ts | [x] |');
    expect(applyFlips(moved, plan.flips)).toBe(moved);
  });

  it('preserves CRLF line endings', () => {
    const crlf = ROADMAP.replace(/\n/g, '\r\n');
    const parsed = parseRoadmap(crlf, 'x.md');
    const crlfPlan = planExport(parsed, beads, categoryOf);
    expect(applyFlips(crlf, crlfPlan.flips)).toContain('\r\n');
  });
});

describe('planImport', () => {
  const roadmap = parseRoadmap(ROADMAP, 'M004-ROADMAP.md');

  it('splits rows into tracked and missing', () => {
    const plan = planImport(roadmap, [bead({ id: 'b1', title: 'T401 — Settings' })]);
    expect(plan.existing.map((item) => item.task.id)).toEqual(['T401']);
    expect(plan.create.map((item) => item.task.id)).toEqual(['T403', 'T402', 'T407']);
  });

  it('labels each draft with its milestone and slice', () => {
    const plan = planImport(roadmap, []);
    const t402 = plan.create.find((item) => item.task.id === 'T402');
    expect(t402?.labels).toEqual(['roadmap', 'm004', 's4b']);
    expect(t402?.description).toContain('Milestone: M004');
    expect(t402?.description).toContain('M004-ROADMAP.md');
  });

  it('never assigns P0 from a milestone number', () => {
    for (const item of planImport(roadmap, []).create) {
      expect(item.priority).toBeGreaterThan(0);
      expect(item.priority).toBeLessThanOrEqual(3);
    }
  });
});

describe('shortTitle', () => {
  it('cuts a feature paragraph at the first clause', () => {
    expect(shortTitle('Large-list handling: honour issueLimit, add Load more')).toBe(
      'Large-list handling',
    );
  });

  it('never cuts mid-word', () => {
    const long = `${'word '.repeat(40)}`.trim();
    const title = shortTitle(long);
    expect(title.length).toBeLessThanOrEqual(73);
    expect(title.replace('…', '').trim().endsWith('word')).toBe(true);
  });
});
