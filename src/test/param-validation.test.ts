import { describe, expect, it } from 'vitest';

import {
  narrowAddDependencyParams,
  narrowCreateParams,
  narrowDeferParams,
  narrowDependencyParams,
  narrowLabelParams,
  narrowReopenParams,
  narrowResolveGateParams,
  narrowUpdateTextParams,
  requireDepType,
  requireDueDate,
  requireTargetId,
  requireTextField,
} from '../extension/panel/param-validation';
import type { DepType, TextField } from '../shared/protocol';

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

describe('requireTextField (router param narrowing)', () => {
  it('accepts each of the five allowlisted fields', () => {
    const fields: TextField[] = ['title', 'description', 'design', 'acceptance', 'notes'];
    for (const field of fields) {
      expect(requireTextField(field, 'field')).toBe(field);
    }
  });

  it('rejects a value outside the allowlist and names the parameter in the error', () => {
    expect(() => requireTextField('assignee', 'field')).toThrow(/"field"/);
    expect(() => requireTextField('status', 'field')).toThrow(/"field"/);
  });

  it('rejects a non-string value, including undefined', () => {
    expect(() => requireTextField(undefined, 'field')).toThrow();
    expect(() => requireTextField(42, 'field')).toThrow();
  });
});

describe('requireDepType (router param narrowing)', () => {
  it('defaults to "blocks" when type is undefined, mirroring bd\'s own default', () => {
    expect(requireDepType(undefined, 'type')).toBe('blocks');
  });

  it('accepts each of the ten allowlisted dependency types', () => {
    const types: DepType[] = [
      'blocks',
      'tracks',
      'related',
      'parent-child',
      'discovered-from',
      'until',
      'caused-by',
      'validates',
      'relates-to',
      'supersedes',
    ];
    for (const type of types) {
      expect(requireDepType(type, 'type')).toBe(type);
    }
  });

  it('rejects a value outside the allowlist and names the parameter in the error', () => {
    expect(() => requireDepType('depends-on', 'type')).toThrow(/"type"/);
    expect(() => requireDepType('bogus', 'type')).toThrow(/"type"/);
  });

  it('rejects a non-string value other than undefined', () => {
    expect(() => requireDepType(42, 'type')).toThrow();
    expect(() => requireDepType(null, 'type')).toThrow();
  });
});

describe('narrowDependencyParams (router param narrowing)', () => {
  it('narrows a well-formed id/dependsOn pair', () => {
    expect(narrowDependencyParams({ id: 'bd-1', dependsOn: 'bd-2' })).toEqual({
      id: 'bd-1',
      dependsOn: 'bd-2',
    });
  });

  it('rejects a self-edge where id equals dependsOn', () => {
    expect(() => narrowDependencyParams({ id: 'bd-1', dependsOn: 'bd-1' })).toThrow(/"dependsOn"/);
  });

  it('rejects a missing or blank id', () => {
    expect(() => narrowDependencyParams({ dependsOn: 'bd-2' })).toThrow(/"id"/);
    expect(() => narrowDependencyParams({ id: '', dependsOn: 'bd-2' })).toThrow(/"id"/);
    expect(() => narrowDependencyParams({ id: '   ', dependsOn: 'bd-2' })).toThrow(/"id"/);
  });

  it('rejects a missing or blank dependsOn', () => {
    expect(() => narrowDependencyParams({ id: 'bd-1' })).toThrow(/"dependsOn"/);
    expect(() => narrowDependencyParams({ id: 'bd-1', dependsOn: '' })).toThrow(/"dependsOn"/);
    expect(() => narrowDependencyParams({ id: 'bd-1', dependsOn: '   ' })).toThrow(/"dependsOn"/);
  });
});

describe('narrowAddDependencyParams (router param narrowing)', () => {
  it('narrows a well-formed request and defaults type to "blocks"', () => {
    expect(narrowAddDependencyParams({ id: 'bd-1', dependsOn: 'bd-2' })).toEqual({
      id: 'bd-1',
      dependsOn: 'bd-2',
      type: 'blocks',
    });
  });

  it('narrows an explicit, allowlisted type', () => {
    expect(narrowAddDependencyParams({ id: 'bd-1', dependsOn: 'bd-2', type: 'tracks' })).toEqual({
      id: 'bd-1',
      dependsOn: 'bd-2',
      type: 'tracks',
    });
  });

  it('rejects a self-edge before type is even considered', () => {
    expect(() =>
      narrowAddDependencyParams({ id: 'bd-1', dependsOn: 'bd-1', type: 'blocks' }),
    ).toThrow(/"dependsOn"/);
  });

  it('rejects a type outside the allowlist', () => {
    expect(() =>
      narrowAddDependencyParams({ id: 'bd-1', dependsOn: 'bd-2', type: 'bogus' }),
    ).toThrow(/"type"/);
  });
});

describe('narrowUpdateTextParams (router param narrowing)', () => {
  it('narrows a well-formed request for each field', () => {
    expect(narrowUpdateTextParams({ id: 'bd-1', field: 'description', text: 'It polls too eagerly.' })).toEqual({
      id: 'bd-1',
      field: 'description',
      text: 'It polls too eagerly.',
    });
  });

  it('rejects an empty text for field "title"', () => {
    expect(() => narrowUpdateTextParams({ id: 'bd-1', field: 'title', text: '' })).toThrow(/"text"/);
  });

  it('rejects a whitespace-only text for field "title"', () => {
    expect(() => narrowUpdateTextParams({ id: 'bd-1', field: 'title', text: '   ' })).toThrow(/"text"/);
  });

  it('accepts an empty text for description, design, acceptance and notes — bd\'s documented "clear"', () => {
    for (const field of ['description', 'design', 'acceptance', 'notes'] as TextField[]) {
      expect(narrowUpdateTextParams({ id: 'bd-1', field, text: '' })).toEqual({ id: 'bd-1', field, text: '' });
    }
  });

  it('rejects a field outside the allowlist', () => {
    expect(() => narrowUpdateTextParams({ id: 'bd-1', field: 'assignee', text: 'x' })).toThrow(/"field"/);
  });

  it('rejects a missing or blank id', () => {
    expect(() => narrowUpdateTextParams({ field: 'title', text: 'ok' })).toThrow(/"id"/);
    expect(() => narrowUpdateTextParams({ id: '', field: 'title', text: 'ok' })).toThrow(/"id"/);
    expect(() => narrowUpdateTextParams({ id: '   ', field: 'title', text: 'ok' })).toThrow(/"id"/);
  });

  it('rejects a missing or non-string text', () => {
    expect(() => narrowUpdateTextParams({ id: 'bd-1', field: 'notes' })).toThrow(/"text"/);
    expect(() => narrowUpdateTextParams({ id: 'bd-1', field: 'notes', text: 42 })).toThrow(/"text"/);
  });
});

describe('narrowLabelParams (router param narrowing)', () => {
  it('narrows a well-formed id/label pair', () => {
    expect(narrowLabelParams({ id: 'bd-1', label: 'ui' })).toEqual({ id: 'bd-1', label: 'ui' });
  });

  it('trims the label', () => {
    expect(narrowLabelParams({ id: 'bd-1', label: '  ui  ' })).toEqual({ id: 'bd-1', label: 'ui' });
  });

  it('rejects a missing or blank id', () => {
    expect(() => narrowLabelParams({ label: 'ui' })).toThrow(/"id"/);
    expect(() => narrowLabelParams({ id: '', label: 'ui' })).toThrow(/"id"/);
    expect(() => narrowLabelParams({ id: '   ', label: 'ui' })).toThrow(/"id"/);
  });

  it('rejects a missing, blank, whitespace-only or non-string label', () => {
    expect(() => narrowLabelParams({ id: 'bd-1' })).toThrow(/"label"/);
    expect(() => narrowLabelParams({ id: 'bd-1', label: '' })).toThrow(/"label"/);
    expect(() => narrowLabelParams({ id: 'bd-1', label: '   ' })).toThrow(/"label"/);
    expect(() => narrowLabelParams({ id: 'bd-1', label: 42 })).toThrow(/"label"/);
  });
});

describe('narrowDeferParams (router param narrowing)', () => {
  it('narrows a well-formed id/until/reason request', () => {
    expect(narrowDeferParams({ id: 'bd-1', until: 'tomorrow', reason: 'waiting on API access' })).toEqual({
      id: 'bd-1',
      until: 'tomorrow',
      reason: 'waiting on API access',
    });
  });

  it('narrows to id only when until/reason are absent', () => {
    expect(narrowDeferParams({ id: 'bd-1' })).toEqual({ id: 'bd-1' });
  });

  it('accepts a free-form relative "until" expression — bd defer --until is not a YYYY-MM-DD date', () => {
    expect(narrowDeferParams({ id: 'bd-1', until: '+1h' })).toEqual({ id: 'bd-1', until: '+1h' });
    expect(narrowDeferParams({ id: 'bd-1', until: 'next monday' })).toEqual({
      id: 'bd-1',
      until: 'next monday',
    });
  });

  it('treats a blank until/reason as absent rather than an empty-string flag', () => {
    expect(narrowDeferParams({ id: 'bd-1', until: '   ', reason: '' })).toEqual({ id: 'bd-1' });
  });

  it('rejects a missing or blank id', () => {
    expect(() => narrowDeferParams({ until: 'tomorrow' })).toThrow(/"id"/);
    expect(() => narrowDeferParams({ id: '', until: 'tomorrow' })).toThrow(/"id"/);
    expect(() => narrowDeferParams({ id: '   ' })).toThrow(/"id"/);
  });

  it('rejects a non-string until/reason', () => {
    expect(() => narrowDeferParams({ id: 'bd-1', until: 42 })).toThrow(/"until"/);
    expect(() => narrowDeferParams({ id: 'bd-1', reason: 42 })).toThrow(/"reason"/);
  });
});

describe('narrowReopenParams (router param narrowing)', () => {
  it('narrows a well-formed id/reason request', () => {
    expect(narrowReopenParams({ id: 'bd-1', reason: 'regression found' })).toEqual({
      id: 'bd-1',
      reason: 'regression found',
    });
  });

  it('narrows to id only when reason is absent', () => {
    expect(narrowReopenParams({ id: 'bd-1' })).toEqual({ id: 'bd-1' });
  });

  it('treats a blank reason as absent rather than an empty-string flag', () => {
    expect(narrowReopenParams({ id: 'bd-1', reason: '   ' })).toEqual({ id: 'bd-1' });
  });

  it('rejects a missing or blank id', () => {
    expect(() => narrowReopenParams({ reason: 'x' })).toThrow(/"id"/);
    expect(() => narrowReopenParams({ id: '', reason: 'x' })).toThrow(/"id"/);
    expect(() => narrowReopenParams({ id: '   ' })).toThrow(/"id"/);
  });

  it('rejects a non-string reason', () => {
    expect(() => narrowReopenParams({ id: 'bd-1', reason: 42 })).toThrow(/"reason"/);
  });
});

describe('narrowResolveGateParams (router param narrowing)', () => {
  it('narrows a well-formed id/reason request', () => {
    expect(narrowResolveGateParams({ id: 'gate-1', reason: 'approved in review' })).toEqual({
      id: 'gate-1',
      reason: 'approved in review',
    });
  });

  it('narrows to id only when reason is absent', () => {
    expect(narrowResolveGateParams({ id: 'gate-1' })).toEqual({ id: 'gate-1' });
  });

  it('treats a blank reason as absent rather than an empty-string flag', () => {
    expect(narrowResolveGateParams({ id: 'gate-1', reason: '   ' })).toEqual({ id: 'gate-1' });
  });

  it('rejects a missing or blank id', () => {
    expect(() => narrowResolveGateParams({ reason: 'x' })).toThrow(/"id"/);
    expect(() => narrowResolveGateParams({ id: '', reason: 'x' })).toThrow(/"id"/);
    expect(() => narrowResolveGateParams({ id: '   ' })).toThrow(/"id"/);
  });

  it('rejects a non-string reason', () => {
    expect(() => narrowResolveGateParams({ id: 'gate-1', reason: 42 })).toThrow(/"reason"/);
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
