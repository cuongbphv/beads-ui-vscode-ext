import { describe, expect, it } from 'vitest';

import { isSuffixMatch, normalizeToken, resolveBeadBySuffix } from '../shared/bead-id-match';

describe('normalizeToken', () => {
  it('lowercases and strips dots and underscores', () => {
    expect(normalizeToken('19R.1')).toBe('19r1');
    expect(normalizeToken('beads_UI_vscode_ext')).toBe('beadsuivscodeext');
  });

  it('leaves a token with no separators or uppercase unchanged apart from case-folding', () => {
    expect(normalizeToken('abc123')).toBe('abc123');
  });
});

describe('isSuffixMatch', () => {
  it('matches when the normalized candidate equals the normalized target (exact case)', () => {
    expect(isSuffixMatch('19r.1', '19r.1')).toBe(true);
  });

  it('matches a short normalized candidate against the tail of a longer target', () => {
    expect(isSuffixMatch('19r1', 'beads-ui-vscode-ext-19r.1')).toBe(true);
  });

  it('does not match a candidate that is a prefix rather than a suffix', () => {
    expect(isSuffixMatch('beads', 'beads-ui-vscode-ext-7pi')).toBe(false);
  });

  it('does not match unrelated strings', () => {
    expect(isSuffixMatch('19r1', 'beads-ui-vscode-ext-7pi')).toBe(false);
  });

  it('returns false rather than throwing on empty input', () => {
    expect(() => isSuffixMatch('', '')).not.toThrow();
    expect(isSuffixMatch('', '')).toBe(false);
    expect(isSuffixMatch('19r1', '')).toBe(false);
    expect(isSuffixMatch('', '19r.1')).toBe(false);
  });
});

describe('resolveBeadBySuffix', () => {
  it('short-circuits on an exact full-id key hit without scanning for suffix matches', () => {
    const beadsById = new Map([
      ['beads-ui-vscode-ext-19r.1', { label: 'exact' }],
      // A decoy whose suffix would also match, to prove the exact hit wins
      // without even considering it.
      ['other-19r.1', { label: 'decoy' }],
    ]);

    expect(resolveBeadBySuffix('beads-ui-vscode-ext-19r.1', beadsById)).toEqual({ label: 'exact' });
  });

  it('resolves a short id to the single bead whose full id it suffix-matches', () => {
    const beadsById = new Map([['beads-ui-vscode-ext-19r.1', { label: 'the-one' }]]);

    expect(resolveBeadBySuffix('19r.1', beadsById)).toEqual({ label: 'the-one' });
  });

  it('refuses to guess when a short id suffix-matches two beads with different prefixes', () => {
    const beadsById = new Map([
      ['proj-a-19r.1', { label: 'a' }],
      ['proj-b-19r.1', { label: 'b' }],
    ]);

    expect(resolveBeadBySuffix('19r.1', beadsById)).toBeUndefined();
  });

  it('resolves to undefined for an id matching nothing in the map', () => {
    const beadsById = new Map([['beads-ui-vscode-ext-19r.1', { label: 'irrelevant' }]]);

    expect(resolveBeadBySuffix('proj-unknown', beadsById)).toBeUndefined();
  });

  it('resolves to undefined against an empty map', () => {
    expect(resolveBeadBySuffix('anything', new Map())).toBeUndefined();
  });
});
