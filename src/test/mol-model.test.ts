import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Bead } from '../shared/types';

import {
  estimateEtaMs,
  formatGateAwait,
  gatesByStepId,
  normalizeStepStatus,
  stepStateOf,
  toMolDetail,
  toMolProgress,
  toMolWisp,
  toStaleIds,
  withGateBadges,
  type MolProgress,
  type MolStep,
} from '../shared/mol';

/**
 * Runs the `mol.ts` read model's types/translation logic over the REAL bd
 * 1.2.2 captures in `src/test/fixtures/mol/` (bead beads-ui-vscode-ext-8eo.1)
 * — the same fixtures `mol-fixtures.test.ts` pins the raw JSON shapes of.
 * This file asserts on what `mol.ts` *does* with those shapes, not just that
 * they parse.
 */

const dir = fileURLToPath(new URL('./fixtures/mol/', import.meta.url));

function load(name: string): unknown {
  return JSON.parse(readFileSync(`${dir}${name}`, 'utf8')) as unknown;
}

describe('toMolProgress', () => {
  it('parses mol-progress.json without crashing and keeps the real counters', () => {
    const progress = toMolProgress(load('mol-progress.json'));

    expect(progress).toEqual({
      molecule_id: 'bd-mol-fixtures-scratch-mol-yh9',
      molecule_title: 'fixdemo',
      total: 4,
      completed: 1,
      in_progress: 1,
      percent: 25,
      current_step_id: 'bd-mol-fixtures-scratch-mol-25d',
      schema_version: 1,
    });
  });

  it('degrades to zero/undefined instead of throwing on a payload with nothing recognisable', () => {
    expect(toMolProgress({})).toEqual({
      molecule_id: '',
      molecule_title: '',
      total: 0,
      completed: 0,
      in_progress: 0,
      percent: 0,
      current_step_id: undefined,
      schema_version: undefined,
    });
    expect(() => toMolProgress(null)).not.toThrow();
    expect(() => toMolProgress(undefined)).not.toThrow();
    expect(() => toMolProgress('not an object')).not.toThrow();
  });
});

describe('toMolDetail', () => {
  it('parses mol-show-parallel.json into root + 4 non-root steps, each derived status matching bd\'s own mol current', () => {
    const detail = toMolDetail(load('mol-show-parallel.json'));
    // mol-current.json is bd's own derived state for this exact molecule —
    // cross-checking against it proves stepStateOf reproduces bd's own
    // answer from mol show --parallel's raw issue status + is_ready alone.
    const current = load('mol-current.json') as Array<{
      steps: Array<{ issue: { id: string }; status: string; is_current: boolean }>;
    }>;
    const expectedById = new Map(
      current[0].steps.map((s) => [s.issue.id, { status: s.status, is_current: s.is_current }]),
    );

    expect(detail.root.id).toBe('bd-mol-fixtures-scratch-mol-yh9');
    expect(detail.parallelAvailable).toBe(true);
    expect(detail.progress).toBeNull();
    expect(detail.steps).toHaveLength(4);
    expect(detail.steps.some((s) => s.issue.id === detail.root.id)).toBe(false);

    for (const step of detail.steps) {
      const expected = expectedById.get(step.issue.id);
      expect(expected, step.issue.id).toBeDefined();
      expect(step.status, step.issue.id).toBe(expected?.status);
      expect(step.is_current, step.issue.id).toBe(expected?.is_current);
    }
  });

  it('degrades to an empty, non-parallel detail instead of throwing on an unparseable payload', () => {
    expect(() => toMolDetail(null)).not.toThrow();
    expect(() => toMolDetail(undefined)).not.toThrow();
    expect(() => toMolDetail({})).not.toThrow();

    const detail = toMolDetail({});
    expect(detail.steps).toEqual([]);
    expect(detail.parallelAvailable).toBe(false);
    expect(detail.progress).toBeNull();
  });

  it('carries the real parallel_group name for every step the fixture actually put in "group-1"', () => {
    const detail = toMolDetail(load('mol-show-parallel.json'));

    expect(detail.parallelAvailable).toBe(true);
    // mol-show-parallel.json's parallel_groups.group-1 lists the root plus
    // hqf/25d/7ps — NOT w0q, whose own parallel_group is "" (see the
    // dedicated ungrouped-step test below).
    const grouped = detail.steps.filter((s) => s.issue.id !== 'bd-mol-fixtures-scratch-mol-w0q');
    expect(grouped).toHaveLength(3);
    for (const step of grouped) {
      expect(step.parallelGroup, step.issue.id).toBe('group-1');
    }
    // Every step out of toMolDetail alone (no gates batch merged yet) has no gate.
    expect(detail.steps.every((s) => s.gate === undefined)).toBe(true);
  });

  it('leaves parallelGroup undefined for every step when the parallel block is unparseable', () => {
    const detail = toMolDetail({ root: { id: 'r' }, issues: [{ id: 'r' }, { id: 's1', status: 'open' }] });

    expect(detail.parallelAvailable).toBe(false);
    expect(detail.steps.every((s) => s.parallelGroup === undefined)).toBe(true);
  });

  it('leaves an explicitly ungrouped step (parallel_group: "") without a parallelGroup even when parallel data is available', () => {
    // bd-mol-fixtures-scratch-mol-w0q in the real fixture has parallel_group: ""
    // (it depends on siblings still open, so it never joined group-1).
    const detail = toMolDetail(load('mol-show-parallel.json'));
    const ungrouped = detail.steps.find((s) => s.issue.id === 'bd-mol-fixtures-scratch-mol-w0q');

    expect(ungrouped).toBeDefined();
    expect(ungrouped?.parallelGroup).toBeUndefined();
  });
});

describe('gatesByStepId', () => {
  it('badges each step with its own open gate from a batched bd show payload, keeping await_id/timeout only where bd emits them', () => {
    const gates = gatesByStepId(load('show-steps-with-gates.json'));

    expect(gates.get('bd-mol-fixtures-scratch-mol-w0q')).toEqual({
      gateId: 'bd-mol-fixtures-scratch-wb6',
      awaitType: 'human',
      awaitId: undefined,
      timeout: undefined,
    });
    expect(gates.get('bd-mol-fixtures-scratch-mol-hqf')).toEqual({
      gateId: 'bd-mol-fixtures-scratch-qpb',
      awaitType: 'timer',
      awaitId: undefined,
      timeout: 7_200_000_000_000,
    });
  });

  it('never badges a step whose only gate dependency is resolved (status: closed)', () => {
    const gates = gatesByStepId(load('show-steps-with-gates.json'));

    // bd-mol-fixtures-scratch-mol-25d's only dependency is the resolved gh:pr gate.
    expect(gates.has('bd-mol-fixtures-scratch-mol-25d')).toBe(false);
  });

  it('never badges a step with no gate dependency at all', () => {
    const gates = gatesByStepId(load('show-steps-with-gates.json'));

    expect(gates.has('bd-mol-fixtures-scratch-mol-7ps')).toBe(false);
  });

  it('degrades to an empty map instead of throwing on an unparseable payload', () => {
    expect(gatesByStepId(null)).toEqual(new Map());
    expect(gatesByStepId(undefined)).toEqual(new Map());
    expect(gatesByStepId({})).toEqual(new Map());
    expect(gatesByStepId([{}, { id: 'x' }, { id: 'y', dependencies: 'not-an-array' }])).toEqual(new Map());
  });
});

describe('withGateBadges', () => {
  function step(id: string): MolStep {
    return {
      issue: { id, title: id, status: 'open', priority: 2, issue_type: 'task' },
      status: 'ready',
      is_current: false,
    };
  }

  it('attaches a gate only to the steps present in the map, leaving the rest untouched', () => {
    const gate = { gateId: 'g1', awaitType: 'human' as const };
    const steps = [step('a'), step('b')];
    const result = withGateBadges(steps, new Map([['a', gate]]));

    expect(result[0].gate).toEqual(gate);
    expect(result[1].gate).toBeUndefined();
    // The untouched step is the same reference bd already trusted — no
    // needless copy of a step with nothing to change.
    expect(result[1]).toBe(steps[1]);
  });

  it('returns the same steps, unmodified, when the gate map is empty', () => {
    const steps = [step('a')];
    expect(withGateBadges(steps, new Map())).toEqual(steps);
  });
});

describe('toMolWisp', () => {
  it('parses every row of wisp-list.json, keeping "type" and never inventing "wisp_type"', () => {
    const raw = load('wisp-list.json') as { wisps: unknown[] };
    const wisps = raw.wisps.map(toMolWisp);

    expect(wisps).toHaveLength(5);
    const root = wisps.find((w) => w.type === 'molecule');
    expect(root?.id).toBe('bd-mol-fixtures-scratch-wisp-0o9');
    for (const w of wisps) {
      expect(typeof w.id).toBe('string');
      expect(typeof w.status).toBe('string');
      expect('wisp_type' in w).toBe(false);
    }
  });

  it('degrades to empty strings instead of throwing on a row missing every field', () => {
    expect(() => toMolWisp({})).not.toThrow();
    expect(toMolWisp({})).toEqual({
      id: '',
      title: '',
      status: '',
      priority: 0,
      type: '',
      created_at: undefined,
      updated_at: undefined,
    });
  });
});

describe('toStaleIds', () => {
  it('parses the populated mol-stale.json fixture', () => {
    expect(toStaleIds(load('mol-stale.json'))).toEqual(['bd-mol-fixtures-scratch-jhl']);
  });

  it('treats a null stale_molecules — bd\'s real empty shape — the same as none, never throwing', () => {
    expect(toStaleIds({ stale_molecules: null })).toEqual([]);
    expect(() => toStaleIds({ stale_molecules: null })).not.toThrow();
  });

  it('degrades to [] instead of throwing on a totally unparseable payload', () => {
    expect(toStaleIds(null)).toEqual([]);
    expect(toStaleIds(undefined)).toEqual([]);
    expect(toStaleIds([])).toEqual([]);
  });
});

describe('stepStateOf', () => {
  it('maps a closed issue to done regardless of the ready/current flags', () => {
    expect(stepStateOf('closed', true, true)).toBe('done');
    expect(stepStateOf('closed', false, false)).toBe('done');
  });

  it('maps in_progress, or an explicit isCurrent flag, to current', () => {
    expect(stepStateOf('in_progress', false, false)).toBe('current');
    expect(stepStateOf('open', false, true)).toBe('current');
  });

  it('maps a ready open step to ready, and a non-ready one to pending', () => {
    expect(stepStateOf('open', true, false)).toBe('ready');
    expect(stepStateOf('open', false, false)).toBe('pending');
  });

  it('degrades an unrecognised raw status to pending rather than throwing — no invented "blocked" state', () => {
    expect(stepStateOf('some-future-status', false, false)).toBe('pending');
    expect(stepStateOf(undefined, false, false)).toBe('pending');
  });
});

describe('estimateEtaMs', () => {
  const NOW = Date.parse('2026-08-24T18:00:00.000Z');

  function root(overrides: Partial<Bead> = {}): Bead {
    return {
      id: 'bd-mol-fixtures-scratch-mol-yh9',
      title: 'fixdemo',
      status: 'open',
      priority: 2,
      issue_type: 'molecule',
      ...overrides,
    };
  }

  function progress(overrides: Partial<MolProgress> = {}): MolProgress {
    return { molecule_id: 'mol-1', molecule_title: 'mol', total: 4, completed: 1, in_progress: 1, percent: 25, ...overrides };
  }

  it('projects the observed completion rate across the remaining steps', () => {
    // Started 1h ago, 1 of 4 steps done -> rate = 1/hour -> 3 remain -> ~3h.
    const started = new Date(NOW - 3_600_000).toISOString();
    const ms = estimateEtaMs(root({ started_at: started }), progress({ completed: 1, total: 4 }), NOW);
    expect(ms).toBeCloseTo(3 * 3_600_000, -2);
  });

  it('falls back to created_at when started_at is absent', () => {
    const created = new Date(NOW - 3_600_000).toISOString();
    const ms = estimateEtaMs(root({ started_at: undefined, created_at: created }), progress(), NOW);
    expect(ms).toBeCloseTo(3 * 3_600_000, -2);
  });

  it('returns undefined when nothing has completed yet — no rate to project', () => {
    const started = new Date(NOW - 3_600_000).toISOString();
    expect(estimateEtaMs(root({ started_at: started }), progress({ completed: 0 }), NOW)).toBeUndefined();
  });

  it('returns undefined once every step is done — nothing left to project', () => {
    const started = new Date(NOW - 3_600_000).toISOString();
    expect(
      estimateEtaMs(root({ started_at: started }), progress({ completed: 4, total: 4 }), NOW),
    ).toBeUndefined();
  });

  it('returns undefined when there is no parseable start time at all', () => {
    expect(
      estimateEtaMs(root({ started_at: undefined, created_at: undefined }), progress(), NOW),
    ).toBeUndefined();
  });

  it('never throws on a start time in the future (clock skew / bad data)', () => {
    const started = new Date(NOW + 3_600_000).toISOString();
    expect(() => estimateEtaMs(root({ started_at: started }), progress(), NOW)).not.toThrow();
    expect(estimateEtaMs(root({ started_at: started }), progress(), NOW)).toBeUndefined();
  });
});

describe('formatGateAwait', () => {
  it('describes a human gate without fabricating an await_id/timeout it never carries', () => {
    expect(formatGateAwait({ await_type: 'human' })).toBe('Waiting on a person');
  });

  it('formats a timer gate\'s nanosecond timeout as a short duration, never the raw number', () => {
    // 7_200_000_000_000ns = 2h, the exact value in fixtures/mol/gate-list.json.
    expect(formatGateAwait({ await_type: 'timer', timeout: 7_200_000_000_000 })).toBe('Timer · 2h 0m');
    expect(formatGateAwait({ await_type: 'timer' })).toBe('Timer');
  });

  it('surfaces await_id for gh:pr/gh:run/bead gates, falling back to a bare label when absent', () => {
    expect(formatGateAwait({ await_type: 'gh:pr', await_id: '42' })).toBe('GitHub PR #42');
    expect(formatGateAwait({ await_type: 'gh:pr' })).toBe('GitHub PR');
    expect(formatGateAwait({ await_type: 'gh:run', await_id: '9' })).toBe('GitHub run 9');
    expect(formatGateAwait({ await_type: 'gh:run' })).toBe('GitHub run');
    expect(formatGateAwait({ await_type: 'bead', await_id: 'rig:bd-9' })).toBe('Bead rig:bd-9');
    expect(formatGateAwait({ await_type: 'bead' })).toBe('Bead');
  });
});

describe('normalizeStepStatus', () => {
  it('passes through every status observed on bd 1.2.2 (mol-current.json)', () => {
    const current = load('mol-current.json') as Array<{ steps: Array<{ status: string }> }>;
    for (const step of current[0].steps) {
      expect(normalizeStepStatus(step.status)).toBe(step.status);
    }
  });

  it('degrades an unrecognised value — including the never-observed "blocked" — to pending', () => {
    expect(normalizeStepStatus('blocked')).toBe('pending');
    expect(normalizeStepStatus('anything-else')).toBe('pending');
    expect(normalizeStepStatus(null)).toBe('pending');
    expect(normalizeStepStatus(42)).toBe('pending');
  });
});
