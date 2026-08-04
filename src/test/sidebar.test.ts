/**
 * The sidebar's three sections, and the identity they hang on.
 *
 * "Needs You" is only useful if it answers with the same name `bd` would stamp
 * on a write, so the precedence chain is pinned here rather than left to the
 * one place it is assembled.
 */
import { describe, expect, it } from 'vitest';

import { isSameActor, normalizeActor, resolveActor } from '../shared/actor';
import { StatusIndex, buildSidebarSections } from '../shared/model';
import type { Bead, StatusDef } from '../shared/types';

const STATUSES: StatusDef[] = [
  { name: 'open', category: 'active' },
  { name: 'in_progress', category: 'wip' },
  { name: 'closed', category: 'done' },
];

const index = new StatusIndex(STATUSES);

function bead(id: string, overrides: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Issue ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  };
}

describe('resolveActor', () => {
  it('follows bd’s precedence: setting > BEADS_ACTOR > BD_ACTOR > git > OS', () => {
    const all = {
      setting: 'From Setting',
      beadsActorEnv: 'From BEADS_ACTOR',
      bdActorEnv: 'From BD_ACTOR',
      gitUserName: 'From Git',
      osUser: 'From OS',
    };
    expect(resolveActor(all)).toBe('From Setting');
    expect(resolveActor({ ...all, setting: undefined })).toBe('From BEADS_ACTOR');
    expect(resolveActor({ ...all, setting: '', beadsActorEnv: '' })).toBe('From BD_ACTOR');
    expect(resolveActor({ gitUserName: 'From Git', osUser: 'From OS' })).toBe('From Git');
    expect(resolveActor({ osUser: 'From OS' })).toBe('From OS');
  });

  it('treats blank and bd’s "unknown" placeholder as nobody', () => {
    expect(resolveActor({})).toBeUndefined();
    expect(resolveActor({ setting: '   ', gitUserName: 'unknown' })).toBeUndefined();
    expect(normalizeActor('  Unknown  ')).toBeUndefined();
    expect(normalizeActor('  Cuong Bui  ')).toBe('Cuong Bui');
  });

  it('matches the same human written two ways, and never matches nobody', () => {
    expect(isSameActor('Cuong Bui', 'cuong bui')).toBe(true);
    expect(isSameActor(' Cuong Bui ', 'Cuong Bui')).toBe(true);
    expect(isSameActor('Cuong Bui', 'Someone Else')).toBe(false);
    // Two unowned issues are not "the same owner".
    expect(isSameActor(undefined, undefined)).toBe(false);
    expect(isSameActor('unknown', 'unknown')).toBe(false);
  });
});

describe('buildSidebarSections', () => {
  const beads: Bead[] = [
    bead('e1', { issue_type: 'epic', title: 'Epic one' }),
    bead('m1', { issue_type: 'milestone', title: 'Milestone one' }),
    bead('t1', { parent: 'e1', assignee: 'Cuong Bui' }),
    bead('t2', { parent: 'e1', assignee: 'cuong bui', status: 'in_progress' }),
    bead('t3', { parent: 'e1', assignee: 'Someone Else' }),
    bead('t4', { parent: 'e1' }),
    bead('b1', { issue_type: 'bug' }),
    bead('done1', { status: 'closed', assignee: 'Cuong Bui' }),
    bead('done2', { status: 'closed' }),
  ];

  const sections = buildSidebarSections(beads, index, {
    me: 'Cuong Bui',
    showClosed: true,
    readyIds: ['t2', 'b1'],
  });

  it('puts the issues you are the PIC of in "mine", however the name was typed', () => {
    expect(sections.mine.map((b) => b.id)).toEqual(['t2', 't1']); // ready first
  });

  it('keeps finished work out of "mine" even when closed issues are shown', () => {
    expect(sections.mine.map((b) => b.id)).not.toContain('done1');
  });

  it('needs an identity — without one the section is empty, not wrong', () => {
    const anonymous = buildSidebarSections(beads, index, { showClosed: true });
    expect(anonymous.mine).toEqual([]);
    // The other two sections still work.
    expect(anonymous.unassigned.length).toBeGreaterThan(0);
  });

  it('lists open, ownerless, non-plan issues in "unassigned"', () => {
    expect(sections.unassigned.map((b) => b.id)).toEqual(['b1', 't4']);
  });

  it('never files an epic or a milestone as unassigned work', () => {
    // They carry no work themselves, so "nobody is on it" is not a finding.
    const ids = sections.unassigned.map((b) => b.id);
    expect(ids).not.toContain('e1');
    expect(ids).not.toContain('m1');
  });

  it('covers every issue in the plan section, so nothing falls out of the tree', () => {
    const seen = new Set<string>();
    for (const group of sections.plan) {
      seen.add(group.epic.id);
      for (const child of group.children) seen.add(child.id);
    }
    for (const original of beads) expect(seen.has(original.id), original.id).toBe(true);
  });

  it('honours showClosed in the plan section only', () => {
    const open = buildSidebarSections(beads, index, { me: 'Cuong Bui', showClosed: false });
    const planned = open.plan.flatMap((group) => [group.epic.id, ...group.children.map((c) => c.id)]);
    expect(planned).not.toContain('done1');
    expect(planned).not.toContain('done2');
  });

  it('reports an epic’s progress from all of its children', () => {
    const withClosedChild = buildSidebarSections(
      [bead('e2', { issue_type: 'epic' }), bead('c1', { parent: 'e2', status: 'closed' }), bead('c2', { parent: 'e2' })],
      index,
      { showClosed: true },
    );
    const epic = withClosedChild.plan.find((group) => group.epic.id === 'e2');
    expect(epic?.doneCount).toBe(1);
    expect(epic?.totalCount).toBe(2);
  });
});
