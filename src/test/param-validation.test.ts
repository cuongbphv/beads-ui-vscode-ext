import { describe, expect, it } from 'vitest';

import { requireDueDate, requireTargetId } from '../extension/panel/param-validation';

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
