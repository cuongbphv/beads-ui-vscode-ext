import { describe, expect, it } from 'vitest';

import { DAY, type Span } from '../shared/schedule';
import type { Bead } from '../shared/types';
import { barTitle, previewSpan } from '../webview/lib/gantt-bar-layout';

/**
 * `gantt-bar.tsx` is a `.tsx` module. The root tsconfig (which `npm run
 * typecheck` also runs) has no `--jsx` and no DOM lib, and `vitest.config.mts`
 * only picks up `src/test/**\/*.test.ts` — so a `.tsx` file can never be
 * statically imported here, and there is no honest way to import it
 * dynamically either (an untyped, non-literal `import()` would check nothing
 * about the real component's prop shape). `barTitle` and `previewSpan` are
 * therefore pure, DOM-free logic extracted to `../webview/lib/gantt-bar-layout`
 * — the same split `gantt-axis.tsx` uses for `gantt-axis-layout.ts` — so they
 * can be exercised directly instead. `gantt-bar.tsx` itself is left as JSX and
 * pointer wiring only, covered by the Playwright `test:webview` end-to-end
 * check rather than a unit test, the same as `gantt-axis.tsx`'s `GanttAxis`
 * and `GanttGrid`.
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
