import { describe, expect, it } from 'vitest';

import { DAY, type Span } from '../shared/schedule';
import type { Bead } from '../shared/types';
import { barTitle, isEditable, previewSpan } from '../webview/lib/gantt-bar-layout';

/**
 * The bar's pure display decisions.
 *
 * This file is a `.ts` suite compiled by the root tsconfig, which has no
 * `--jsx` and no DOM lib, so `gantt-bar.tsx` cannot be imported here. That is
 * the reason `barTitle`, `previewSpan` and `isEditable` live in
 * `../webview/lib/gantt-bar-layout` — the same split `gantt-axis.tsx` uses for
 * `gantt-axis-layout.ts`. The component's own behaviour (the drag, the
 * keyboard edit, the capture handling) is exercised against the real thing in
 * `gantt-bar-interaction.test.tsx`, which the webview tsconfig owns.
 */
const NOW = Date.parse('2026-08-04T12:00:00Z');

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return { title: partial.id, status: 'open', priority: 2, issue_type: 'task', ...partial };
}

function span(partial: Partial<Span> & { bead: Bead }): Span {
  return {
    start: NOW,
    end: NOW + DAY,
    kind: 'nominal',
    overdue: false,
    deferred: false,
    ...partial,
  };
}

describe('barTitle', () => {
  it('always includes the id, title, and date range with the kind label', () => {
    const s = span({ bead: bead({ id: 'a', title: 'Do the thing' }), kind: 'nominal' });
    expect(barTitle(s)).toBe('a: Do the thing · Aug 4 → Aug 5 (no dates — nominal bar)');
  });

  it('labels each span kind distinctly', () => {
    expect(barTitle(span({ bead: bead({ id: 'a' }), kind: 'actual' }))).toContain('(closed)');
    expect(barTitle(span({ bead: bead({ id: 'a' }), kind: 'due' }))).toContain('(due)');
    expect(barTitle(span({ bead: bead({ id: 'a' }), kind: 'estimated' }))).toContain('(estimated end)');
  });

  it('appends assignee, estimate, overdue and deferred only when present', () => {
    const bare = span({ bead: bead({ id: 'a' }) });
    expect(barTitle(bare)).not.toMatch(/PIC|est |OVERDUE|deferred/);

    const full = span({
      bead: bead({ id: 'a', assignee: 'cuong', estimated_minutes: 90 }),
      overdue: true,
      deferred: true,
    });
    const title = barTitle(full);
    expect(title).toContain('PIC cuong');
    expect(title).toContain('est 1h 30m');
    expect(title).toContain('OVERDUE');
    expect(title).toContain('deferred');
  });
});

describe('previewSpan', () => {
  it('returns the span unchanged when no drag is in flight', () => {
    const s = span({ bead: bead({ id: 'a' }), end: NOW + 3 * DAY });
    expect(previewSpan(s, undefined)).toBe(s);
  });

  it('reports the preview value as the end, leaving everything else untouched', () => {
    const s = span({ bead: bead({ id: 'a' }), start: NOW, end: NOW + DAY });
    const previewEnd = NOW + 5 * DAY;

    expect(previewSpan(s, previewEnd)).toEqual({ ...s, end: previewEnd });
  });

  it('does not mutate the original span', () => {
    const s = span({ bead: bead({ id: 'a' }), end: NOW + DAY });
    previewSpan(s, NOW + 9 * DAY);
    expect(s.end).toBe(NOW + DAY);
  });
});

describe('isEditable', () => {
  it('is false for a closed span even when a commit handler is wired', () => {
    expect(isEditable(span({ bead: bead({ id: 'a' }), kind: 'actual' }), true)).toBe(false);
  });

  it('is false when no commit handler is wired, regardless of kind', () => {
    // Pins the fix for the drag-and-discard trap: a host that has no real
    // `onCommit` yet must not offer a handle whose release silently discards.
    expect(isEditable(span({ bead: bead({ id: 'a' }), kind: 'due' }), false)).toBe(false);
    expect(isEditable(span({ bead: bead({ id: 'a' }), kind: 'nominal' }), false)).toBe(false);
  });

  it('is true only for an open span with a commit handler wired', () => {
    expect(isEditable(span({ bead: bead({ id: 'a' }), kind: 'due' }), true)).toBe(true);
    expect(isEditable(span({ bead: bead({ id: 'a' }), kind: 'estimated' }), true)).toBe(true);
    expect(isEditable(span({ bead: bead({ id: 'a' }), kind: 'nominal' }), true)).toBe(true);
  });
});
