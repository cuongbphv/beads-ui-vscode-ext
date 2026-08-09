/**
 * Turning beads into timeline bars.
 *
 * beads has no explicit "start/end" pair, so a bar has to be inferred from the
 * fields it does have: `started_at`, `created_at`, `due_at`, `closed_at` and
 * `estimated_minutes`. The rules live here — framework-free and tested — so the
 * Gantt cannot quietly disagree with the detail pane about when something runs.
 */
import type { Bead, EpicGroup } from './types';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Where a bar's end came from. The UI renders inferred ends differently. */
export type SpanKind =
  /** Closed: the bar ends when the work actually ended. */
  | 'actual'
  /** Open with a due date: the bar ends at the deadline. */
  | 'due'
  /** Open with an estimate but no due date: the end is start + estimate. */
  | 'estimated'
  /** Neither: a nominal one-day bar so the issue is still visible. */
  | 'nominal';

export interface Span {
  bead: Bead;
  start: number;
  end: number;
  kind: SpanKind;
  /** Past its due date and not finished. */
  overdue: boolean;
  /** Hidden from `bd ready` until `defer_until`. */
  deferred: boolean;
}

function time(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Compute one issue's bar.
 *
 * `now` is injected rather than read from the clock so the result is testable
 * and so every bar in one render agrees on what "today" means.
 */
export function spanOf(bead: Bead, isDone: boolean, now: number): Span {
  const start = time(bead.started_at) ?? time(bead.created_at) ?? now;
  const due = time(bead.due_at);
  const closed = time(bead.closed_at);
  const estimate = bead.estimated_minutes ? bead.estimated_minutes * MINUTE : undefined;

  let end: number;
  let kind: SpanKind;
  if (closed !== undefined) {
    end = closed;
    kind = 'actual';
  } else if (due !== undefined) {
    end = due;
    kind = 'due';
  } else if (estimate !== undefined) {
    end = start + estimate;
    kind = 'estimated';
  } else {
    end = start + DAY;
    kind = 'nominal';
  }

  // A closed-before-created row, or a due date in the past, would otherwise
  // render as a zero-width or backwards bar.
  if (end < start) end = start;

  return {
    bead,
    start,
    end: Math.max(end, start + HOUR),
    kind,
    overdue: due !== undefined && !isDone && due < now,
    deferred: (time(bead.defer_until) ?? 0) > now,
  };
}

export interface EpicSpan {
  group: EpicGroup;
  /** The epic's own bar. */
  own: Span;
  /** The children's bars, in the group's order. */
  children: Span[];
  /** The epic's bar widened to cover every child — what the timeline draws. */
  start: number;
  end: number;
  /** Any child past its due date. */
  hasOverdue: boolean;
}

/**
 * An epic's bar spans its children, because an epic rarely carries dates of its
 * own — the work does. An epic with no children keeps its own span.
 */
export function epicSpan(
  group: EpicGroup,
  isDone: (bead: Bead) => boolean,
  now: number,
): EpicSpan {
  const own = spanOf(group.epic, isDone(group.epic), now);
  const children = group.children.map((child) => spanOf(child, isDone(child), now));

  const start = children.length > 0 ? Math.min(...children.map((s) => s.start)) : own.start;
  const end = children.length > 0 ? Math.max(...children.map((s) => s.end)) : own.end;

  return {
    group,
    own,
    children,
    start,
    end,
    hasOverdue: children.some((child) => child.overdue) || own.overdue,
  };
}

export interface Timeline {
  epics: EpicSpan[];
  /** Window covered by the chart, padded away from the first and last bar. */
  start: number;
  end: number;
  now: number;
  /** Evenly spaced gridlines with a label appropriate to the window's length. */
  ticks: Array<{ at: number; label: string; major: boolean }>;
}

/** Pad the window so the first and last bars are not flush against the edges. */
function pad(start: number, end: number): [number, number] {
  const span = Math.max(end - start, DAY);
  const margin = Math.max(span * 0.04, HOUR * 6);
  return [start - margin, end + margin];
}

/**
 * Narrower than this and a tick label collides with its neighbour. Sized to a
 * `text-[10px]` date label like "Aug 4" (~33px), centred on its gridline via
 * `-translate-x-1/2` — and, deliberately, low enough that the `day` zoom
 * (48px per day) still clears the bar and selects day ticks rather than
 * falling through to weekly ones.
 */
const MIN_TICK_PX = 44;

/**
 * The density assumed when nobody has measured the track yet — one window
 * across a typical editor pane. Only the first frame uses it.
 */
const FALLBACK_TRACK_PX = 900;

function hourTicks(start: number, end: number): Timeline['ticks'] {
  const ticks: Timeline['ticks'] = [];
  // Anchored to local midnight, not to the epoch: a 6-hour grid counted from
  // 1970 lands on 07:00/13:00 in a +07 zone and never on a day boundary, so
  // no tick would ever be the day label.
  const anchor = new Date(start);
  anchor.setHours(0, 0, 0, 0);

  for (let at = anchor.getTime(); at <= end; at += 6 * HOUR) {
    if (at < start) continue;
    const date = new Date(at);
    const midnight = date.getHours() === 0;
    ticks.push({
      at,
      // Bare clock times repeat every day and say nothing about which day it
      // is, so midnight carries the date instead of reading "0:00".
      label: midnight
        ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : `${String(date.getHours()).padStart(2, '0')}:00`,
      major: midnight,
    });
  }
  return ticks;
}

function dayTicks(start: number, end: number, step: number): Timeline['ticks'] {
  const ticks: Timeline['ticks'] = [];
  const first = new Date(start);
  first.setHours(0, 0, 0, 0);

  for (let at = first.getTime(); at <= end; at += step) {
    if (at < start) continue;
    const date = new Date(at);
    ticks.push({
      at,
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      major: date.getDate() === 1,
    });
  }
  return ticks;
}

function monthTicks(start: number, end: number): Timeline['ticks'] {
  const ticks: Timeline['ticks'] = [];
  const cursor = new Date(start);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= end) {
    const at = cursor.getTime();
    if (at >= start) {
      ticks.push({
        at,
        label: cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
        major: cursor.getMonth() === 0,
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

/**
 * Gridlines, chosen by how many pixels a day is worth rather than by how long
 * the window is.
 *
 * The window does not change when the user zooms — only the track's width does —
 * so a length-based rule would keep monthly gridlines on a chart zoomed to 48px
 * per day. Density is the thing the reader actually experiences.
 */
function buildTicks(start: number, end: number, pxPerDay: number | undefined): Timeline['ticks'] {
  const days = Math.max((end - start) / DAY, 1);
  const perDay = pxPerDay && pxPerDay > 0 ? pxPerDay : FALLBACK_TRACK_PX / days;
  const minMs = (MIN_TICK_PX / perDay) * DAY;

  if (minMs <= 6 * HOUR) return hourTicks(start, end);
  if (minMs <= DAY) return dayTicks(start, end, DAY);
  if (minMs <= 7 * DAY) return dayTicks(start, end, 7 * DAY);
  return monthTicks(start, end);
}

/** Build the whole timeline: epic bars, window, gridlines. */
export function buildTimeline(
  groups: EpicGroup[],
  isDone: (bead: Bead) => boolean,
  now: number,
  /** How wide a day is on screen. Omitted on the first frame, before measuring. */
  opts?: { pxPerDay?: number },
): Timeline {
  const epics = groups.map((group) => epicSpan(group, isDone, now));

  const starts = epics.map((epic) => epic.start);
  const ends = epics.map((epic) => epic.end);
  // Always include "now", so the today marker is on-screen even for a plan that
  // is entirely in the past or entirely in the future.
  const rawStart = Math.min(now, ...(starts.length ? starts : [now]));
  const rawEnd = Math.max(now, ...(ends.length ? ends : [now + DAY]));
  const [start, end] = pad(rawStart, rawEnd);

  return { epics, start, end, now, ticks: buildTicks(start, end, opts?.pxPerDay) };
}

/** A bar's position within the window, as percentages. */
export function placement(span: { start: number; end: number }, timeline: Timeline): {
  left: number;
  width: number;
} {
  const total = timeline.end - timeline.start;
  if (total <= 0) return { left: 0, width: 100 };
  const left = ((span.start - timeline.start) / total) * 100;
  const width = ((span.end - span.start) / total) * 100;
  // Sub-pixel bars are invisible; give every issue a minimum footprint.
  return { left: Math.max(0, left), width: Math.max(width, 0.6) };
}

/** "2h 30m" / "3d" — compact effort for a bar label or the detail pane. */
export function formatDuration(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 8) {
    const whole = Math.floor(hours);
    const rest = minutes % 60;
    return rest ? `${whole}h ${rest}m` : `${whole}h`;
  }
  const days = hours / 8; // an 8-hour working day
  return days >= 1 && Number.isInteger(days) ? `${days}d` : `${hours.toFixed(1)}h`;
}
