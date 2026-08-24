import { describe, expect, it } from 'vitest';

import { narrowCreateParams, requireDueDate, requireTargetId } from '../extension/panel/param-validation';

describe('requireDueDate (router param narrowing)', () => {
  it('accepts a well-formed YYYY-MM-DD date', () => {
    expect(requireDueDate('2026-09-01', 'date')).toBe('2026-09-01');
  });

  it('accepts an empty string, since that is how bd clears a due date', () => {
    expect(requireDueDate('', 'date')).toBe('');
  });

  it('rejects a malformed date and names the parameter in the error', () => {
    expect(() => requireDueDate('not-a-date', 'date')).toThrow(/"date"/);
  });

  it('rejects a value that is merely date-like but not YYYY-MM-DD', () => {
    expect(() => requireDueDate('2026/09/01', 'date')).toThrow();
    expect(() => requireDueDate('09-01-2026', 'date')).toThrow();
  });

  it('rejects a non-string value, including undefined', () => {
    expect(() => requireDueDate(undefined, 'date')).toThrow();
    expect(() => requireDueDate(12345, 'date')).toThrow();
  });
});

describe('requireTargetId (router param narrowing)', () => {
  it('accepts an agent target id', () => {
    expect(requireTargetId('agent:worker-1', 'targetId')).toBe('agent:worker-1');
  });

  it('accepts a session target id', () => {
    expect(requireTargetId('session:abc123', 'targetId')).toBe('session:abc123');
  });

  it('rejects a targetId containing a space', () => {
    expect(() => requireTargetId('agent: worker 1', 'targetId')).toThrow(/"targetId"/);
  });

  it('rejects a targetId containing a path separator or traversal segment', () => {
    expect(() => requireTargetId('../../etc/passwd', 'targetId')).toThrow();
    expect(() => requireTargetId('agent/../x', 'targetId')).toThrow();
  });

  it('rejects an empty string and a non-string value', () => {
    expect(() => requireTargetId('', 'targetId')).toThrow();
    expect(() => requireTargetId(undefined, 'targetId')).toThrow();
    expect(() => requireTargetId(123, 'targetId')).toThrow();
  });
});

describe('narrowCreateParams (router param narrowing)', () => {
  it('narrows a fully-populated request into the exact mutation input', () => {
    expect(
      narrowCreateParams({
        title: '  Fix the flaky poll  ',
        type: 'bug',
        priority: '1',
        parent: 'bd-epic-1',
        labels: ['ui', ' backend '],
        due: '2026-09-01',
        estimate: 90,
        description: 'It polls too eagerly.',
        design: 'Debounce it.',
        acceptance: 'No duplicate polls.',
        status: 'in_progress',
      }),
    ).toEqual({
      title: 'Fix the flaky poll',
      type: 'bug',
      priority: '1',
      parent: 'bd-epic-1',
      labels: ['ui', 'backend'],
      due: '2026-09-01',
      estimate: 90,
      description: 'It polls too eagerly.',
      design: 'Debounce it.',
      acceptance: 'No duplicate polls.',
      status: 'in_progress',
    });
  });

  it('accepts a title-only request and ignores unknown fields', () => {
    expect(narrowCreateParams({ title: 'Just a title', bogus: 'ignored', assignee: 'ana' })).toEqual({
      title: 'Just a title',
    });
  });

  it('rejects a missing, empty, whitespace-only or non-string title', () => {
    expect(() => narrowCreateParams({})).toThrow(/"title"/);
    expect(() => narrowCreateParams({ title: '' })).toThrow(/"title"/);
    expect(() => narrowCreateParams({ title: '   ' })).toThrow(/"title"/);
    expect(() => narrowCreateParams({ title: 42 })).toThrow(/"title"/);
  });

  it('rejects a malformed due date, reusing the setDue narrowing', () => {
    expect(() => narrowCreateParams({ title: 't', due: 'next tuesday' })).toThrow(/"due"/);
    expect(() => narrowCreateParams({ title: 't', due: '2026/09/01' })).toThrow(/"due"/);
    expect(() => narrowCreateParams({ title: 't', due: 20260901 })).toThrow(/"due"/);
  });

  it('drops an empty due string — clearing a date on a brand-new issue is a no-op', () => {
    expect(narrowCreateParams({ title: 't', due: '' })).toEqual({ title: 't' });
  });

  it('rejects a zero, negative, non-finite or non-numeric estimate', () => {
    expect(() => narrowCreateParams({ title: 't', estimate: 0 })).toThrow(/"estimate"/);
    expect(() => narrowCreateParams({ title: 't', estimate: -30 })).toThrow(/"estimate"/);
    expect(() => narrowCreateParams({ title: 't', estimate: Infinity })).toThrow(/"estimate"/);
    expect(() => narrowCreateParams({ title: 't', estimate: NaN })).toThrow(/"estimate"/);
    expect(() => narrowCreateParams({ title: 't', estimate: '90' })).toThrow(/"estimate"/);
  });

  it('rejects non-array labels and arrays holding non-strings', () => {
    expect(() => narrowCreateParams({ title: 't', labels: 'ui,backend' })).toThrow(/"labels"/);
    expect(() => narrowCreateParams({ title: 't', labels: ['ui', 7] })).toThrow(/"labels"/);
  });

  it('drops blank label entries and treats an all-blank list as absent', () => {
    expect(narrowCreateParams({ title: 't', labels: ['ui', '', '  '] })).toEqual({
      title: 't',
      labels: ['ui'],
    });
    expect(narrowCreateParams({ title: 't', labels: [] })).toEqual({ title: 't' });
  });

  it('rejects a non-string optional field but treats a blank one as absent', () => {
    expect(() => narrowCreateParams({ title: 't', type: 3 })).toThrow(/"type"/);
    expect(() => narrowCreateParams({ title: 't', status: false })).toThrow(/"status"/);
    expect(narrowCreateParams({ title: 't', type: '', status: '  ' })).toEqual({ title: 't' });
  });

  it('passes vocabulary values through untouched — the bd CLI is the authority', () => {
    // A project-defined type/status must not be rejected by a hardcoded list.
    expect(narrowCreateParams({ title: 't', type: 'spike', status: 'in_review' })).toEqual({
      title: 't',
      type: 'spike',
      status: 'in_review',
    });
  });
});
