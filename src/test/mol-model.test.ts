import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  normalizeStepStatus,
  stepStateOf,
  toMolDetail,
  toMolProgress,
  toMolWisp,
  toStaleIds,
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
