/**
 * Pure display logic for a single Gantt task bar.
 *
 * `gantt-bar.tsx` renders the bar and its resize handle, but the decisions
 * underneath — the tooltip text, and which span (the real one, or the one a
 * live drag is previewing) gets drawn — are ordinary computation with no
 * business needing a DOM to test. Extracted here, the same way
 * `gantt-axis.tsx`'s placement math lives in `gantt-axis-layout.ts`, so the
 * logic is exercised directly and the component is left with nothing but
 * JSX and pointer wiring.
 */
import { formatDuration, type Span } from '../../shared/schedule';
import { shortDate } from './utils';

const KIND_TEXT: Record<Span['kind'], string> = {
  actual: 'closed',
  due: 'due',
  estimated: 'estimated end',
  nominal: 'no dates — nominal bar',
};

/** The bar's tooltip and accessible name: id, title, dates, and whatever else applies. */
export function barTitle(span: Span): string {
  const parts = [
    `${span.bead.id}: ${span.bead.title}`,
    `${shortDate(span.start)} → ${shortDate(span.end)} (${KIND_TEXT[span.kind]})`,
  ];
  if (span.bead.assignee) parts.push(`PIC ${span.bead.assignee}`);
  if (span.bead.estimated_minutes) parts.push(`est ${formatDuration(span.bead.estimated_minutes)}`);
  if (span.overdue) parts.push('OVERDUE');
  if (span.deferred) parts.push('deferred');
  return parts.join(' · ');
}

/**
 * The span to actually draw and report: the real one, or — while a drag is
 * live — the same span with its end swapped for the in-progress preview.
 * `preview` of `undefined` means no drag is in flight.
 */
export function previewSpan(span: Span, preview: number | undefined): Span {
  return preview === undefined ? span : { ...span, end: preview };
}

/**
 * Whether the bar should offer its reschedule handle at all.
 *
 * A closed issue's end is `closed_at`, which bd will not accept as `--due` or
 * `--estimate`, so it is never editable. And a handle must not render when
 * there is no live `onCommit` to receive the result — that would let a user
 * drag, watch a preview, release, and have it silently discard with nothing
 * written and no feedback.
 */
export function isEditable(span: Span, hasCommitHandler: boolean): boolean {
  return span.kind !== 'actual' && hasCommitHandler;
}
