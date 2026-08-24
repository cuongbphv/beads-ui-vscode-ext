/**
 * Issue history timeline: derives "what changed, by whom" from `bd history`
 * snapshots.
 *
 * `bd history <id> --json` (verified against bd 1.2.2, no `--events` flag —
 * see the bead's design note) returns the *whole issue* as it stood at every
 * commit that touched it, newest commit first. Shipping that array to the
 * webview would mean shipping N full issue bodies (design/acceptance/notes
 * can each be pages long) just to answer "what changed" — so the diff runs
 * here, host-side, in a pure function with no `vscode` and no `react`.
 */
import type { Bead } from './types';

/**
 * The subset of a historical issue snapshot this module actually compares.
 * `Partial` because bd's own `Bead.status`/`title` are required on a *live*
 * issue, but a translated history row is built defensively from whatever the
 * raw JSON happened to carry — absence must not be a type error.
 */
export type HistoryIssueSnapshot = Partial<
  Pick<
    Bead,
    | 'status'
    | 'priority'
    | 'assignee'
    | 'title'
    | 'labels'
    | 'description'
    | 'design'
    | 'acceptance_criteria'
  >
>;

/** One row of `bd history`'s output, translated from bd's PascalCase field names. */
export interface HistorySnapshot {
  hash: string;
  /** `Committer` in bd's payload. */
  actor: string;
  /** `CommitDate` in bd's payload, an ISO-ish timestamp string. */
  at: string;
  issue: HistoryIssueSnapshot;
}

/**
 * What kind of change this event describes — the UI needs this to decide
 * *how* to render `from`/`to`, not just what field name they belong to.
 *
 * - `value`: a scalar field changed; `from`/`to` hold the old/new value (or
 *   are absent when the field went from/to unset).
 * - `label-added` / `label-removed`: one label entered or left the set. Only
 *   `to` (added) or `from` (removed) is set, never both.
 * - `text-changed`: a long-form field (description/design/acceptance
 *   criteria) changed. `from`/`to` are deliberately omitted — those fields
 *   can be pages long, and the point of diffing here is to *not* ship that.
 */
export type HistoryChangeKind = 'value' | 'label-added' | 'label-removed' | 'text-changed';

export interface HistoryEvent {
  /** Which issue field changed: 'status' | 'priority' | 'assignee' | 'title' | 'labels' | 'description' | 'design' | 'acceptance_criteria'. */
  field: string;
  kind: HistoryChangeKind;
  from?: string;
  to?: string;
  /** `Committer` of the commit that produced this change. */
  actor: string;
  /** `CommitDate` of the commit that produced this change. */
  at: string;
}

/** Scalar fields compared by simple inequality, one event per changed field. */
const VALUE_FIELDS: ReadonlyArray<keyof HistoryIssueSnapshot> = [
  'status',
  'priority',
  'assignee',
  'title',
];

/**
 * Long-form fields whose *content* is never diffed or shipped — only that
 * they changed at all. A field is compared by simple inequality; both values
 * can be huge, so neither is put on an event.
 */
const TEXT_FIELDS: ReadonlyArray<keyof HistoryIssueSnapshot> = ['description', 'design', 'acceptance_criteria'];

function stringify(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

/**
 * Diff two consecutive issue snapshots (newer vs. older) into zero or more
 * events, all attributed to the commit that produced `newer`.
 */
function diffPair(newer: HistorySnapshot, older: HistorySnapshot): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const { actor, at } = newer;

  for (const field of VALUE_FIELDS) {
    const from = older.issue[field] as string | number | undefined;
    const to = newer.issue[field] as string | number | undefined;
    if (from === to) continue;
    // `undefined` and `''` both mean "unset" for these fields; treat them as
    // equal so a round trip through bd's JSON (which may emit either) never
    // manufactures a phantom no-op event.
    if ((from ?? '') === (to ?? '')) continue;
    events.push({ field, kind: 'value', from: stringify(from), to: stringify(to), actor, at });
  }

  for (const field of TEXT_FIELDS) {
    const from = older.issue[field];
    const to = newer.issue[field];
    if ((from ?? '') === (to ?? '')) continue;
    events.push({ field, kind: 'text-changed', actor, at });
  }

  const beforeLabels = new Set(older.issue.labels ?? []);
  const afterLabels = new Set(newer.issue.labels ?? []);
  for (const label of afterLabels) {
    if (!beforeLabels.has(label)) events.push({ field: 'labels', kind: 'label-added', to: label, actor, at });
  }
  for (const label of beforeLabels) {
    if (!afterLabels.has(label)) events.push({ field: 'labels', kind: 'label-removed', from: label, actor, at });
  }

  return events;
}

/**
 * Turn a `bd history` window into a flat, chronological list of field-change
 * events.
 *
 * `snapshots` must be in the order bd emits them — newest commit first
 * (verified: `bd history <id> --json` on bd 1.2.2). Only *consecutive*
 * snapshots are compared, so the result is newest-change-first too, which
 * matches how the array came in and reads like a normal activity feed.
 *
 * The oldest snapshot in the window has nothing older to diff against, so it
 * never produces a synthetic "created" event — it only establishes the
 * baseline for the pair before it. This also means a single-snapshot window
 * (a brand-new issue, or `--limit 1`) is a no-op: zero events, no crash.
 *
 * A commit that changed nothing observable in the compared fields (bd can
 * record a commit that only touched, say, `updated_at`) produces zero events
 * for that pair rather than an empty placeholder row.
 */
export function diffHistory(snapshots: HistorySnapshot[]): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  for (let i = 0; i < snapshots.length - 1; i++) {
    events.push(...diffPair(snapshots[i], snapshots[i + 1]));
  }
  return events;
}
