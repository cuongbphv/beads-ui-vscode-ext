# Roadmap: layout fix, sorting, resizable columns and detail pane

**Date:** 2026-08-09
**Status:** approved, not yet implemented
**Surface:** `Roadmap` tab of the Beads Dashboard webview, plus the shared detail pane.

## Problem

Three complaints, all in the Roadmap tab:

1. A band of empty space sits between the filter row and the date axis. Scrolled content
   leaks above the sticky axis header, so a half-clipped task row is visible where the
   axis should start.
2. There is no way to reorder the plan. Rows are locked to start-date order, and the
   label gutter is a fixed width, so long titles are truncated to uselessness in a narrow
   panel. There is also no way to change the time resolution.
3. The detail pane is a fixed `w-96`. Long descriptions are read through a 384px slot.

## Goals

- Remove the layout artefact and one row of vertical chrome from the Roadmap.
- Sort epic rows *and* their children by priority or by issue type.
- Let the user drag the split between the label gutter and the time track, and change
  the time resolution.
- Let the user drag the right edge of a bar to change the schedule, writing back to `bd`.
- Let the user drag the detail pane wider.

## Non-goals

- Changing what a bar *means*. `shared/schedule.ts` keeps its inference rules.
- Editing anything other than `due_at` and `estimated_minutes` from the chart.
- An Undo affordance in the toast. `notify()` takes no action button today; that is a
  separate change and gets its own issue.
- Server-side sorting. The snapshot is already in memory; `bd list --sort` would cost a
  subprocess per interaction.

## Constraints discovered

**`bd update` has no `--start` flag.** Verified against
`C:\Users\CuongBPV\Workspace\AI\beads\docs\CLI_REFERENCE.md` lines 1466-1498: the update
command exposes `--due`, `--estimate` and `--defer`, but nothing that sets `started_at`.
`started_at` is written by beads when an issue moves to `in_progress`.

A bar's start is therefore **derived**, not stored — `shared/schedule.ts:50` computes
`started_at ?? created_at ?? now`. The left edge of a bar cannot be persisted, so it gets
no drag handle. Only the right edge is editable.

**Issue types and statuses are user-extensible.** Sorting by type must compare the type
string, never a hardcoded rank table (`CLAUDE.md` cardinal sin #2).

**Container queries are invisible to JavaScript.** The detail pane switches between
docked and full-bleed via `@3xl:` on a `@container` root. Widths must therefore travel
through a CSS custom property so the existing class does the switching; a JS media query
would disagree with the container query as soon as the panel is not the viewport.

## Approach

Chosen over two alternatives:

- **Rejected — `react-resizable-panels`.** Saves roughly 80 lines in one place, adds a
  dependency that must clear the `npm audit --audit-level=low` gate on every milestone,
  and helps with neither the zoom nor the bar drag.
- **Rejected — keep everything in `gantt.tsx`.** The file is 361 lines and would pass 700
  with drag, zoom, sort and mutation logic mixed into layout. Violates the repo rule that
  business logic lives in `lib/`, not in components.

**Chosen: a frozen grid plus one shared drag primitive.** Pure logic goes into
framework-free modules that are unit-tested on their own; components keep only layout.

---

## 1. Layout

### Root cause

*Hypothesis, to be confirmed by reproduction before the fix lands.* The scroll container
at `RoadmapView.tsx:152` carries `py-2`. The axis header at `gantt.tsx:52` is
`sticky top-0`. Chromium pins a sticky box to the scroll container's **content box**, not
its padding box, so exactly `padding-top` worth of scrolled content shows above the
header. The sliver in the reported screenshot is roughly 8-10px, consistent with
`py-2` = 8px. The row bleeding through was identified as `Chống lệch REPORT.md §B` by
matching its grey bar position (~69% across).

The fix does not depend on the hypothesis being right, but the hypothesis must be
verified so the same mistake is not reintroduced elsewhere.

### Changes

The Gantt becomes a standard frozen grid: one scroll container that scrolls on both axes.

| Element | Today | After |
|---|---|---|
| Scroll container | `overflow-auto px-3 py-2` | `overflow-auto`, no padding; padding moves to inner wrappers |
| Date axis | `sticky top-0 z-10` inside a padded scroller | `sticky top-0 z-20`, opaque `bg-bg`, unpadded scroller |
| Label gutter | `w-44 shrink-0 @xl:w-64`, scrolls horizontally with the bars | `sticky left-0 z-10`, opaque `bg-bg` |
| Corner cell | does not exist | `sticky top-0 left-0 z-30` |
| "N closed hidden" pill | its own full-width band with `border-b px-3 py-1.5` | folded into the end of the filter row |

The `[Timeline][List]` group moves into a `trailing` slot **inside** `QuickFilterBar`, so
it wraps together with the selects. Today it is a `shrink-0` sibling pinned to the right
of line one while the selects wrap to line two, which leaves a hole in the middle of
line one in a narrow panel.

Scrolling horizontally keeps the task names still; scrolling vertically keeps the date
axis still.

---

## 2. Sorting

New framework-free module `src/shared/roadmap-sort.ts`. `sortEpicSpans`, currently at
`gantt.tsx:354`, moves here.

```ts
export type RoadmapSort = 'timeline' | 'priority' | 'type';

/** Sorts epic rows and their children, preserving the nesting. */
export function sortTimeline(epics: EpicSpan[], sort: RoadmapSort): EpicSpan[];

/** The same comparators for the List shape. */
export function sortGroups(groups: EpicGroup[], sort: RoadmapSort): EpicGroup[];
```

Comparators, every one terminating in `id` so the order is stable across renders:

| Sort | Epic row | Child row |
|---|---|---|
| `timeline` (default) | `start` → `id` — today's behaviour, unchanged | today's `compareBeads` order, unchanged |
| `priority` | `priority` (P0 first) → `start` → `id` | `priority` → `start` → `id` |
| `type` | `issue_type` **string compare** → `priority` → `id` | same |

`type` sorts alphabetically rather than by a rank table, because beads issue types are
user-extensible.

Sorting epic rows is meaningful beyond epics: `groupByEpic` (`shared/model.ts:110-113`)
also creates a group for any **non-epic parent** — a task that parents a subtask.

The synthetic `__unassigned__` group stays pinned last under every sort. It is not a real
epic and has a fabricated `priority: 4`.

**UI:** a `Sort` select in the filter row beside the shape toggle. Applies to both the
Timeline and List shapes. Persisted as `PersistedState.roadmapSort`.

Sorting is presentation only. No `bd` call, no mutation.

---

## 3. Drag infrastructure

Built once, used by both the Gantt gutter (§4) and the detail pane (§6).

`src/webview/lib/drag-resize.ts` — pure, unit-tested:

```ts
export interface Range { min: number; max: number }
export function clamp(px: number, range: Range): number;
/** ←/→ ±16px, Shift ±64px, Home/End to the bounds. undefined for unrelated keys. */
export function keyResize(key: string, shift: boolean, current: number, range: Range): number | undefined;
```

`src/webview/hooks/use-drag-resize.ts` — `pointerdown` with `setPointerCapture`, so the
drag survives the cursor leaving the handle or the webview. No global listeners.

`src/webview/components/splitter.tsx` — `role="separator"`, `aria-orientation="vertical"`,
`aria-valuenow/valuemin/valuemax`, `tabIndex={0}`. 6px hit area, 1px visible rule. Colours
come from the existing `--vscode-*`-derived tokens (`--color-border`, `--color-focus` on
hover and drag) — no hex literals. Double-click resets to the default width.

---

## 4. Resizable gutter

The `GUTTER` constant at `gantt.tsx:28` is replaced by a custom property on the Gantt
root:

```tsx
<div style={{ '--gantt-gutter': `${gutter}px` } as CSSProperties}>
```

The header cell, every row's label cell and the gridline overlay all read
`w-[var(--gantt-gutter)]`. One source of truth; they cannot drift apart.

Range `[120px, 60% of the Gantt viewport width]`, measured with `ResizeObserver`.
Persisted as `PersistedState.roadmapGutter`.

---

## 5. Time zoom

```ts
export type RoadmapZoom = 'fit' | 'day' | 'week' | 'month';
```

Pixels per day: `day` = 48, `week` = 12, `month` = 4. `fit` is not a constant — it is
`trackViewportWidth / ((timeline.end - timeline.start) / DAY)`, i.e. exactly the density
that makes the track fill the viewport with no horizontal scrolling. That is today's
behaviour, now expressed in the same unit as the other three.

`placement()` (`shared/schedule.ts:226`) returns **percentages**, so zoom requires no
change to the maths — set a `min-width` on the track and let it scroll horizontally. The
track widens, the percentages still land in the right place.

The one thing that does need changing is tick selection. `buildTicks`
(`shared/schedule.ts:144`) chooses its step from the **window length**, and zoom does not
change the window — so zooming in would produce absurdly sparse gridlines. It becomes
density-driven:

```ts
buildTimeline(groups, isDone, now, opts?: { pxPerDay?: number })
// pick the smallest unit whose tick spacing is >= 64px
```

The parameter is optional, so every existing call site still compiles.
`schedule.test.ts:156-165` only asserts that ticks are non-empty and inside the window, so
no existing assertion breaks.

This also removes a workaround: `gantt.tsx:66` currently hides minor tick labels behind
`hidden @2xl:inline` because a narrow panel crowds them. Density-driven ticks are already
sparse at narrow widths, so the class goes away.

Persisted as `PersistedState.roadmapZoom`.

---

## 6. Resizable detail pane

Width travels as a custom property so the existing container query keeps deciding docked
versus full-bleed:

```tsx
<main className="flex min-h-0 flex-1" style={{ '--detail-w': `${detailWidth}px` } as CSSProperties}>
  <div className="min-w-0 flex-1">{/* view */}</div>

  {selected ? (
    <>
      <Splitter
        className="hidden @3xl:block"   {/* narrow: the pane covers the content, nothing to drag */}
        aria-label="Resize detail panel"
        onResize={(dx) => setDetailWidth((w) => clamp(w - dx, detailRange))}
      />
      <div className="absolute inset-0 z-10 @3xl:static @3xl:z-auto @3xl:w-[var(--detail-w)] @3xl:shrink-0">
        <BeadDetail … />
      </div>
    </>
  ) : null}
</main>
```

Dragging left widens, hence `startWidth - deltaX`.

Range `[320px, 70% of `<main>`'s width]`, measured with `ResizeObserver`. The clamp must
re-run **whenever the container shrinks**, not only during a drag: a pane set to 900px
would otherwise consume the entire content area when the VSCode window is narrowed.

Double-click resets to 384px, matching today's `w-96`. Persisted as
`PersistedState.detailWidth`.

---

## 7. Drag a bar to reschedule

One gesture: a handle on the **right edge** of a bar. Which field it writes is decided by
the issue's data.

| Issue | `Span.kind` | Right-edge drag writes |
|---|---|---|
| Has `due_at` | `due` | `bd update <id> --due YYYY-MM-DD` |
| No `due_at` | `estimated` / `nominal` | `bd update <id> --estimate <minutes>` |
| Closed | `actual` | **no handle** — the edge is `closed_at`, which bd does not accept |

The bar body is not draggable. It is already a `<button>` that selects the issue
(`gantt.tsx:269-294`); making it both drag and click would swallow the selection. An
issue without a due date still gets its estimate changed by dragging the edge, which is
the intended outcome.

### Guards against unasked mutations

Cardinal sin #4 is running a beads mutation the user did not ask for. A deliberate drag
is an ask; a 3px twitch is not.

- The handle is 8px wide and appears only on hover or keyboard focus of a bar.
- A drag does not begin until the pointer has moved at least 4px.
- **If the snapped value equals the current value, no `bd` call is made at all.**
- `--due` snaps to local midnight — bd accepts `YYYY-MM-DD`.
- `--estimate` snaps to a multiple of 15 minutes, minimum 15.
- The end is clamped so it can never precede the start.

### Layers

No layer is skipped.

1. `src/shared/protocol.ts` — add `setDue(id, date)` and `setEstimate(id, minutes)`. Two
   separate methods, matching the granularity of the existing
   `setStatus` / `setPriority` / `setAssignee`.
2. `src/extension/bd/mutations.ts` — both via `this.run(['update', id, …], id)`. An empty
   string clears the due date; bd documents `--due ""` as "empty to clear".
3. `src/extension/panel/router.ts` — route the two new methods.
4. `src/webview/lib/bar-drag.ts` — pure, and the only place the decision lives:
   ```ts
   export type BarEdit =
     | { field: 'due'; at: number }
     | { field: 'estimate'; minutes: number }
     | { field: 'none'; reason: 'closed' | 'unchanged' };

   export function endFromDrag(span: Span, deltaPx: number, trackPx: number, timeline: Timeline): number;
   export function planBarEdit(span: Span, newEnd: number): BarEdit;
   ```
5. `src/webview/hooks/use-schedule-edit.ts` — returns `{ pending, commit }`, calling
   `call()` and `useToast()` in the shape `bead-detail.tsx:74-85` already uses.
   `gantt.tsx` keeps only layout.

### Feedback

A ghost bar previews the new extent during the drag, labelled with the target date. On
release the bar dims until the host pushes a fresh snapshot — the repo's existing
mutate-then-refetch pattern, not an optimistic write. The toast names the change exactly:
`velox-a6 · due Aug 8 → Aug 12`.

---

## Persisted state

`PersistedState` in `App.tsx:24-33` gains four optional fields. All are optional so a
webview restored from an older `persist()` payload still starts.

```ts
interface PersistedState {
  // … existing: tab, query, collapsedColumns, roadmapShowClosed, roadmapShape
  /** Absent until the user picks a sort; `timeline` until then. */
  roadmapSort?: RoadmapSort;
  /** Absent until the user zooms; `fit` until then. */
  roadmapZoom?: RoadmapZoom;
  /** Label-gutter width in px. Absent until first dragged. */
  roadmapGutter?: number;
  /** Detail-pane width in px. Absent until first dragged. */
  detailWidth?: number;
}
```

Both widths are re-clamped against the live container size on restore, not trusted as
written — a width saved at one window size must not break the layout at another.

## Testing

Every feature carries a test, per `CLAUDE.md`.

| Unit | Test file | Covers |
|---|---|---|
| `shared/roadmap-sort.ts` | `src/test/roadmap-sort.test.ts` | each comparator, tie-breakers, stability, `__unassigned__` pinned last, non-epic parents |
| `shared/schedule.ts` | `src/test/schedule.test.ts` (extend) | density-driven ticks: spacing >= 64px, ticks in window, `pxPerDay` omitted behaves as before |
| `webview/lib/drag-resize.ts` | `src/test/drag-resize.test.ts` | clamp at both bounds, keyboard steps, Shift, Home/End, unrelated keys return `undefined` |
| `webview/lib/bar-drag.ts` | `src/test/bar-drag.test.ts` | pixel→timestamp, midnight snap, 15-minute snap, field selection per `kind`, closed → `none`, unchanged → `none`, end clamped to start |
| `extension/bd/mutations.ts` | `src/test/queries.test.ts` (extend) | exact argv for `setDue` and `setEstimate`, including the clear-due case |

Manual verification, because the layout bug is visual: reproduce the sliver above the
axis header **before** changing anything, then confirm it is gone, at both a narrow and a
wide panel width, with and without the detail pane docked.

## Quality gates

Run after each step:

```
npm run build && npm run typecheck && npm test
npm audit --audit-level=low     # must report 0
```

No new dependency is introduced, so the audit surface is unchanged.

## Sequencing

Presentation-only work first; the only step that writes data goes last.

| # | Work | Depends on | Risk |
|---|---|---|---|
| 1 | Layout: frozen grid, unpadded scroller, fold the closed-hidden pill | — | Low. Reproduce the bug before fixing it |
| 2 | `roadmap-sort.ts` + the Sort control | — | Low, pure functions |
| 3 | `drag-resize.ts` + `use-drag-resize` + `<Splitter>` | — | Low |
| 4 | Resizable gutter | 1, 3 | Medium — header, rows and gridlines must share the custom property |
| 5 | Zoom + density-driven ticks | 1, 4 | Highest — changes `buildTimeline`'s signature and adds horizontal scrolling |
| 6 | Resizable detail pane | 3 | Low |
| 7 | Bar drag → `--due` / `--estimate` | 1, 4, 5 | High — a real mutation, five layers |

Steps 1-6 are pure presentation: if one is wrong, nothing is lost. Step 7 is last because
it is the only one that writes.

## Follow-up issues to file

- Undo action in the toast. `notify()` accepts no action button today.
- Bar left-edge editing, if beads ever gains `bd update --start`.
