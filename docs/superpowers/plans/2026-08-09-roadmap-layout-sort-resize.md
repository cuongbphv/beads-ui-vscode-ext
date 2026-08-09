# Roadmap Layout, Sorting and Resizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Roadmap's sticky-header layout artefact, and make the plan sortable, the Gantt gutter and time axis resizable, the detail pane draggable, and a bar's end editable back into `bd`.

**Architecture:** The Gantt becomes a standard frozen grid — one scroll container on both axes, with a `sticky top-0` date axis, a `sticky left-0` label gutter and a `sticky top-0 left-0` corner. All decision logic (sort comparators, resize clamping, drag→field mapping) lives in framework-free modules under `src/shared/` and `src/webview/lib/` and is unit-tested without a DOM; components keep only layout. `src/webview/components/gantt.tsx` is split into a `gantt/` directory so no file carries layout, drag, zoom and mutation concerns at once.

**Tech Stack:** TypeScript 6.0.3, React 19.2.8, Tailwind CSS 4.3.3 (CSS-first `@theme`), vitest 4.1.10, esbuild. No new dependency is introduced by this plan.

## Global Constraints

Copied from `CLAUDE.md`, `.velox/docs/VELOX-CONTEXT.md` and the design spec. Every task's requirements implicitly include this section.

- **Never spawn `bd` outside `BdService`**, and never call `acquireVsCodeApi()` outside `src/webview/bridge/rpc.ts`.
- **Never read `.beads/issues.jsonl` or the Dolt files.** Always go through `bd --json`.
- **Never hardcode statuses, issue types or kanban columns.** They are user-extensible. Sorting by type compares the type *string*; no rank table.
- **`src/shared/` must not import `vscode` or `react`.** `src/webview/` must not import `vscode`.
- **No hex colour literals in components.** Use the `--vscode-*`-derived tokens from `src/webview/styles/globals.css` (`bg-bg`, `bg-surface`, `border-border`, `border-border-strong`, `text-fg-muted`, …). A visible focus ring already exists globally via `:focus-visible` in `globals.css:171-175` — do not add per-component focus outlines.
- **No remote assets** in the webview. CSP forbids them.
- **Responsiveness uses container queries** (`@md:`, `@xl:`, `@3xl:`), never viewport media queries — a webview panel's width is independent of the viewport.
- **Every feature has a test.** Never skip or delete a failing test.
- **No business logic in React components or command handlers.**
- **Do not "upgrade" `typescript`, `@types/vscode` or `@types/node`.** See `.velox/docs/DECISIONS.md` DEC-006.
- **No new npm dependency.** `npm audit --audit-level=low` must report 0.
- **Git — read this before any commit.** The user has authorised commits, with three rules that override both the per-task commit steps written below and any default attribution habit:
  1. **One commit per wave, not per task.** The per-task "Commit" steps below are superseded; treat them as "stage nothing, report done". Only the orchestrator commits, after the whole wave's gates are green.
  2. **Subagents must not run any git command.** They edit files, run gates, and report.
  3. **No Claude, Anthropic, AI or co-author trailer anywhere in a commit message.** No `Co-Authored-By:`, no "Generated with", no tool name. The message states what the wave does and nothing else.

  Wave commit messages, verbatim:

  ```
  Wave 1  feat(roadmap): add sort comparators, splitter primitive, density ticks, schedule mutations
  Wave 2  feat(roadmap): add date axis, reschedule handle, resizable detail pane, edit hook
  Wave 3  refactor(gantt): rebuild as a frozen grid with a resizable gutter and time zoom
  Wave 4  feat(roadmap): wire sort, zoom, gutter and bar rescheduling into the view
  Wave 5  fix(roadmap): apply code and security review findings
  ```

  Never push. `bd dolt push/pull` is out of scope.
- **Task tracking is `bd`.** The issues already exist: epic `beads-ui-vscode-ext-93r`, tasks `.1`–`.13` matching Tasks 1–13. Claim with `bd update <id> --claim` when starting, `bd close <id>` when the task's gates pass. Do not use TodoWrite or markdown checklists — the checkboxes in *this* file are the plan's own progress markers and should be ticked as you go.

## Verification commands

```bash
npm test                                  # vitest run, whole suite
npx vitest run src/test/<file>.test.ts    # one file
npm run typecheck                         # tsc --noEmit x2 (extension + webview configs)
npm run lint                              # eslint src
npm run build                             # esbuild + tailwind
npm run verify                            # lint + typecheck + test + build + audit:ci
```

## File structure

New files:

| Path | Responsibility |
|---|---|
| `src/shared/roadmap-sort.ts` | Row-order comparators for both Roadmap shapes. Framework-free. |
| `src/webview/lib/drag-resize.ts` | Clamping and keyboard-step maths for both splitters. Pure. |
| `src/webview/lib/bar-drag.ts` | Pixel delta → timestamp → which `bd` field to write. Pure. |
| `src/webview/hooks/use-drag-resize.ts` | Pointer-capture drag wiring for `<Splitter>`. |
| `src/webview/hooks/use-schedule-edit.ts` | Commits a bar edit through `rpc.call` + toast. |
| `src/webview/components/splitter.tsx` | The `role="separator"` handle. Used twice. |
| `src/webview/components/gantt/gantt-axis.tsx` | Date axis header + gridline overlay. |
| `src/webview/components/gantt/gantt-bar.tsx` | One task bar and its right-edge drag handle. |
| `src/webview/components/gantt/gantt-rows.tsx` | `EpicRow` and `TaskRow`. |
| `src/webview/components/gantt/gantt-legend.tsx` | The legend. |
| `src/webview/components/gantt/gantt-chart.tsx` | The frozen-grid shell: scroll container, gutter var, track width. |
| `src/webview/components/gantt/index.ts` | Re-exports, so `../components/gantt` keeps working. |

Modified: `src/shared/schedule.ts`, `src/shared/protocol.ts`, `src/extension/bd/mutations.ts`, `src/extension/panel/router.ts`, `src/webview/components/quick-filter-bar.tsx`, `src/webview/views/RoadmapView.tsx`, `src/webview/App.tsx`.

Deleted: `src/webview/components/gantt.tsx` (replaced by the directory, in Task 11).

## Execution waves

Tasks inside a wave touch **disjoint files** and can run fully in parallel. Do not start a wave until the previous one is merged and `npm run verify` is green.

```
Wave 1  ── T1 sort ── T2 splitter ── T3 ticks ── T4 host RPC ── T5 bar-drag ── T6 filter slot
Wave 2  ── T7 axis (needs T3) ── T8 bar (needs T5) ── T9 detail pane (needs T2) ── T10 edit hook (needs T4,T5)
Wave 3  ── T11 gantt shell (needs T1,T2,T3,T7,T8)
Wave 4  ── T12 RoadmapView wiring (needs T1,T2,T6,T10,T11)
Wave 5  ── T13 gates, manual verification, code review, security review
```

**Known temporary duplication:** Task 1 creates `sortEpicSpans`' replacement without deleting the original from `gantt.tsx`, so Wave 1 stays conflict-free. Task 11 deletes the original. Do not close the plan with both in the tree.

---

## WAVE 1

### Task 1: Sort comparators

**Files:**
- Create: `src/shared/roadmap-sort.ts`
- Test: `src/test/roadmap-sort.test.ts`

**Interfaces:**
- Consumes: `EpicSpan` and `Span` from `src/shared/schedule.ts`; `Bead`, `EpicGroup` from `src/shared/types.ts`.
- Produces:
  - `type RoadmapSort = 'timeline' | 'priority' | 'type'`
  - `const ROADMAP_SORTS: readonly RoadmapSort[]`
  - `sortTimeline(epics: EpicSpan[], sort: RoadmapSort): EpicSpan[]`
  - `sortGroups(groups: EpicGroup[], sort: RoadmapSort): EpicGroup[]`

- [ ] **Step 1: Write the failing test**

Create `src/test/roadmap-sort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { sortGroups, sortTimeline } from '../shared/roadmap-sort';
import type { EpicSpan, Span } from '../shared/schedule';
import type { Bead, EpicGroup } from '../shared/types';

function bead(partial: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return { title: partial.id, status: 'open', priority: 2, issue_type: 'task', ...partial };
}

function span(b: Bead, start: number): Span {
  return { bead: b, start, end: start + 1000, kind: 'nominal', overdue: false, deferred: false };
}

function group(epic: Bead, children: Bead[]): EpicGroup {
  return { epic, children, doneCount: 0, totalCount: children.length };
}

function epicSpanOf(epic: Bead, start: number, children: Array<[Bead, number]>): EpicSpan {
  const kids = children.map(([b, s]) => span(b, s));
  return {
    group: group(epic, kids.map((k) => k.bead)),
    own: span(epic, start),
    children: kids,
    start,
    end: start + 5000,
    hasOverdue: false,
  };
}

describe('sortTimeline', () => {
  it('leaves start order and child order alone for the timeline sort', () => {
    const a = epicSpanOf(bead({ id: 'e1', issue_type: 'epic', priority: 4 }), 100, [
      [bead({ id: 't2', priority: 0 }), 20],
      [bead({ id: 't1', priority: 3 }), 10],
    ]);
    const b = epicSpanOf(bead({ id: 'e2', issue_type: 'epic', priority: 0 }), 50, []);

    const out = sortTimeline([a, b], 'timeline');

    expect(out.map((e) => e.group.epic.id)).toEqual(['e2', 'e1']);
    expect(out[1].children.map((c) => c.bead.id)).toEqual(['t2', 't1']);
  });

  it('puts P0 first at both levels for the priority sort', () => {
    const a = epicSpanOf(bead({ id: 'e1', issue_type: 'epic', priority: 3 }), 100, [
      [bead({ id: 't1', priority: 3 }), 10],
      [bead({ id: 't2', priority: 0 }), 20],
    ]);
    const b = epicSpanOf(bead({ id: 'e2', issue_type: 'epic', priority: 0 }), 900, []);

    const out = sortTimeline([a, b], 'priority');

    expect(out.map((e) => e.group.epic.id)).toEqual(['e2', 'e1']);
    expect(out[1].children.map((c) => c.bead.id)).toEqual(['t2', 't1']);
  });

  it('keeps group.children aligned with the reordered spans', () => {
    const a = epicSpanOf(bead({ id: 'e1', issue_type: 'epic' }), 100, [
      [bead({ id: 't1', priority: 3 }), 10],
      [bead({ id: 't2', priority: 0 }), 20],
    ]);

    const out = sortTimeline([a], 'priority');

    expect(out[0].group.children.map((c) => c.id)).toEqual(
      out[0].children.map((c) => c.bead.id),
    );
  });

  it('sorts types alphabetically rather than by a rank table', () => {
    const a = epicSpanOf(bead({ id: 'e1', issue_type: 'epic' }), 0, [
      [bead({ id: 't1', issue_type: 'task' }), 0],
      [bead({ id: 't2', issue_type: 'bug' }), 0],
      [bead({ id: 't3', issue_type: 'aardvark' }), 0],
    ]);

    const out = sortTimeline([a], 'type');

    expect(out[0].children.map((c) => c.bead.id)).toEqual(['t3', 't2', 't1']);
  });

  it('pins the synthetic No epic group last under every sort', () => {
    const real = epicSpanOf(bead({ id: 'e1', issue_type: 'epic', priority: 4 }), 900, []);
    const synthetic = epicSpanOf(
      bead({ id: '__unassigned__', title: 'No epic', issue_type: 'epic', priority: 0 }),
      0,
      [],
    );

    for (const sort of ['timeline', 'priority', 'type'] as const) {
      const out = sortTimeline([synthetic, real], sort);
      expect(out.map((e) => e.group.epic.id)).toEqual(['e1', '__unassigned__']);
    }
  });

  it('breaks ties on id so the order is stable across renders', () => {
    const rows = ['c', 'a', 'b'].map((id) =>
      epicSpanOf(bead({ id, issue_type: 'epic', priority: 2 }), 500, []),
    );

    expect(sortTimeline(rows, 'priority').map((e) => e.group.epic.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const rows = [
      epicSpanOf(bead({ id: 'e2', issue_type: 'epic', priority: 3 }), 0, []),
      epicSpanOf(bead({ id: 'e1', issue_type: 'epic', priority: 0 }), 0, []),
    ];

    sortTimeline(rows, 'priority');

    expect(rows.map((e) => e.group.epic.id)).toEqual(['e2', 'e1']);
  });
});

describe('sortGroups', () => {
  it('returns groupByEpic order untouched for the timeline sort', () => {
    const groups = [
      group(bead({ id: 'e2', issue_type: 'epic', priority: 3 }), []),
      group(bead({ id: 'e1', issue_type: 'epic', priority: 0 }), []),
    ];

    expect(sortGroups(groups, 'timeline').map((g) => g.epic.id)).toEqual(['e2', 'e1']);
  });

  it('sorts epics and children by priority', () => {
    const groups = [
      group(bead({ id: 'e2', issue_type: 'epic', priority: 3 }), [
        bead({ id: 't1', priority: 4 }),
        bead({ id: 't2', priority: 1 }),
      ]),
      group(bead({ id: 'e1', issue_type: 'epic', priority: 0 }), []),
    ];

    const out = sortGroups(groups, 'priority');

    expect(out.map((g) => g.epic.id)).toEqual(['e1', 'e2']);
    expect(out[1].children.map((c) => c.id)).toEqual(['t2', 't1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/roadmap-sort.test.ts`
Expected: FAIL — `Failed to resolve import "../shared/roadmap-sort"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/roadmap-sort.ts`:

```ts
/**
 * Row order for the Roadmap.
 *
 * Sorting is presentation only — it never calls bd. It lives in `shared/` and is
 * framework-free so the comparators can be tested without a DOM, and so the
 * Timeline and List shapes cannot quietly disagree about what "by priority" means.
 */
import type { EpicSpan } from './schedule';
import type { Bead, EpicGroup } from './types';

export type RoadmapSort = 'timeline' | 'priority' | 'type';

export const ROADMAP_SORTS: readonly RoadmapSort[] = ['timeline', 'priority', 'type'];

/** The synthetic bucket `groupByEpic` appends for work with no reachable parent. */
const UNASSIGNED = '__unassigned__';

/** A row to be ordered. `start` is absent in the List shape, which has no bars. */
interface Row {
  bead: Bead;
  start?: number;
}

/**
 * The "No epic" bucket is not a real epic — it is a catch-all, and a catch-all
 * that floats to the top of a plan reads as the most important thing in it.
 */
function pinLast(a: Bead, b: Bead): number | undefined {
  const left = a.id === UNASSIGNED;
  const right = b.id === UNASSIGNED;
  if (left === right) return undefined;
  return left ? 1 : -1;
}

function byStart(a: Row, b: Row): number {
  return (a.start ?? 0) - (b.start ?? 0);
}

/**
 * Every comparator terminates in `id`, so the order is total: two rows tying on
 * every other key still land in the same place on every render.
 */
function byKey(sort: RoadmapSort, a: Row, b: Row): number {
  const id = (): number => a.bead.id.localeCompare(b.bead.id);

  if (sort === 'priority') {
    return a.bead.priority - b.bead.priority || byStart(a, b) || id();
  }
  if (sort === 'type') {
    // Alphabetical, never a rank table: beads issue types are user-extensible,
    // so any fixed list would silently mis-sort a project's custom type.
    return (
      a.bead.issue_type.localeCompare(b.bead.issue_type) ||
      a.bead.priority - b.bead.priority ||
      id()
    );
  }
  return byStart(a, b) || id();
}

/** Order the Gantt's epic rows and their bars, preserving the nesting. */
export function sortTimeline(epics: EpicSpan[], sort: RoadmapSort): EpicSpan[] {
  const sorted = [...epics].sort(
    (a, b) =>
      pinLast(a.group.epic, b.group.epic) ??
      byKey(
        sort,
        { bead: a.group.epic, start: a.start },
        { bead: b.group.epic, start: b.start },
      ),
  );

  // `timeline` is the status quo: groupByEpic already ordered the children.
  if (sort === 'timeline') return sorted;

  return sorted.map((epic) => {
    const children = [...epic.children].sort((a, b) =>
      byKey(sort, { bead: a.bead, start: a.start }, { bead: b.bead, start: b.start }),
    );
    // `group.children` is re-derived rather than left behind: anything reading
    // the group must see the same order as the bars, or a rollup and a row will
    // one day disagree about which child is which.
    return { ...epic, children, group: { ...epic.group, children: children.map((c) => c.bead) } };
  });
}

/** The same comparators for the List shape, which has no spans. */
export function sortGroups(groups: EpicGroup[], sort: RoadmapSort): EpicGroup[] {
  if (sort === 'timeline') return groups;

  return [...groups]
    .sort((a, b) => pinLast(a.epic, b.epic) ?? byKey(sort, { bead: a.epic }, { bead: b.epic }))
    .map((group) => ({
      ...group,
      children: [...group.children].sort((a, b) => byKey(sort, { bead: a }, { bead: b })),
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/roadmap-sort.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit** (only if the user authorised commits)

```bash
git add src/shared/roadmap-sort.ts src/test/roadmap-sort.test.ts
git commit -m "feat(roadmap): add sort comparators for epic and task rows"
```

---

### Task 2: Splitter primitive

**Files:**
- Create: `src/webview/lib/drag-resize.ts`
- Create: `src/webview/hooks/use-drag-resize.ts`
- Create: `src/webview/components/splitter.tsx`
- Test: `src/test/drag-resize.test.ts`

**Interfaces:**
- Consumes: `cn` from `src/webview/lib/utils.ts`.
- Produces:
  - `interface Range { min: number; max: number }`
  - `clamp(px: number, range: Range): number`
  - `sizeFromDrag(startSize: number, deltaX: number, sign: 1 | -1, range: Range): number`
  - `keyResize(key: string, shift: boolean, current: number, range: Range, sign?: 1 | -1): number | undefined`
  - `useDragResize({ size, range, sign?, onChange })` returning `{ dragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown }`
  - `<Splitter size range sign? onChange label onReset? className? />`

`sign` exists because the two splitters grow in opposite directions: dragging the Gantt splitter right widens the gutter (`sign: 1`), dragging the detail-pane splitter right *narrows* the pane (`sign: -1`).

- [ ] **Step 1: Write the failing test**

Create `src/test/drag-resize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { clamp, keyResize, sizeFromDrag } from '../webview/lib/drag-resize';

const RANGE = { min: 120, max: 400 };

describe('clamp', () => {
  it('holds the value inside the range', () => {
    expect(clamp(50, RANGE)).toBe(120);
    expect(clamp(300, RANGE)).toBe(300);
    expect(clamp(999, RANGE)).toBe(400);
  });

  it('rounds to whole pixels', () => {
    expect(clamp(200.6, RANGE)).toBe(201);
  });

  it('collapses to min when the container is too small for the range', () => {
    // A pane whose max has fallen below its min must still return something
    // renderable rather than an inverted range.
    expect(clamp(300, { min: 320, max: 100 })).toBe(320);
  });
});

describe('sizeFromDrag', () => {
  it('grows with the pointer when sign is 1', () => {
    expect(sizeFromDrag(200, 40, 1, RANGE)).toBe(240);
  });

  it('shrinks with the pointer when sign is -1', () => {
    expect(sizeFromDrag(200, 40, -1, RANGE)).toBe(160);
  });

  it('clamps the result', () => {
    expect(sizeFromDrag(390, 100, 1, RANGE)).toBe(400);
  });
});

describe('keyResize', () => {
  it('nudges by 16px and by 64px with Shift', () => {
    expect(keyResize('ArrowRight', false, 200, RANGE)).toBe(216);
    expect(keyResize('ArrowRight', true, 200, RANGE)).toBe(264);
    expect(keyResize('ArrowLeft', false, 200, RANGE)).toBe(184);
  });

  it('honours the sign so an inverted splitter still grows rightward on ArrowRight', () => {
    expect(keyResize('ArrowRight', false, 200, RANGE, -1)).toBe(184);
    expect(keyResize('ArrowLeft', false, 200, RANGE, -1)).toBe(216);
  });

  it('jumps to the bounds on Home and End', () => {
    expect(keyResize('Home', false, 200, RANGE)).toBe(120);
    expect(keyResize('End', false, 200, RANGE)).toBe(400);
  });

  it('returns undefined for keys it does not own', () => {
    expect(keyResize('Enter', false, 200, RANGE)).toBeUndefined();
    expect(keyResize('a', false, 200, RANGE)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/drag-resize.test.ts`
Expected: FAIL — `Failed to resolve import "../webview/lib/drag-resize"`.

- [ ] **Step 3: Write the pure module**

Create `src/webview/lib/drag-resize.ts`:

```ts
/**
 * Resize maths for the Roadmap gutter and the detail pane.
 *
 * Pure and DOM-free on purpose: the failure mode of a resize bug is a pane the
 * user cannot drag back, so the clamping rules are worth testing directly.
 */

export interface Range {
  min: number;
  max: number;
}

/** Keyboard nudge in px. Shift multiplies it. */
export const STEP = 16;
export const STEP_LARGE = 64;

/**
 * `max` can legitimately fall below `min` — a percentage-derived maximum in a
 * container narrower than the minimum. Returning `min` keeps the pane usable
 * instead of inverting the range.
 */
export function clamp(px: number, range: Range): number {
  if (range.max < range.min) return range.min;
  return Math.min(Math.max(Math.round(px), range.min), range.max);
}

/**
 * `sign` is the direction the size grows in relative to the pointer: 1 for a
 * pane that lives to the left of its handle, -1 for one that lives to the right.
 */
export function sizeFromDrag(
  startSize: number,
  deltaX: number,
  sign: 1 | -1,
  range: Range,
): number {
  return clamp(startSize + sign * deltaX, range);
}

/** `undefined` means the key is not ours — leave the event alone. */
export function keyResize(
  key: string,
  shift: boolean,
  current: number,
  range: Range,
  sign: 1 | -1 = 1,
): number | undefined {
  const step = (shift ? STEP_LARGE : STEP) * sign;
  switch (key) {
    case 'ArrowRight':
      return clamp(current + step, range);
    case 'ArrowLeft':
      return clamp(current - step, range);
    case 'Home':
      return clamp(range.min, range);
    case 'End':
      return clamp(range.max, range);
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/drag-resize.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the hook**

Create `src/webview/hooks/use-drag-resize.ts`:

```tsx
/**
 * Pointer wiring for a splitter.
 *
 * `setPointerCapture` on the handle itself, rather than listeners on the
 * document: the pointer routinely leaves a 6px handle mid-drag, and in a webview
 * it can leave the frame entirely without us ever seeing the pointerup.
 */
import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import { keyResize, sizeFromDrag, type Range } from '../lib/drag-resize';

export interface DragResizeHandlers {
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function useDragResize({
  size,
  range,
  sign = 1,
  onChange,
}: {
  size: number;
  range: Range;
  sign?: 1 | -1;
  onChange: (next: number) => void;
}): DragResizeHandlers {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, size });

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = { x: event.clientX, size };
      setDragging(true);
    },
    [size],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!dragging) return;
      onChange(sizeFromDrag(origin.current.size, event.clientX - origin.current.x, sign, range));
    },
    [dragging, onChange, range, sign],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!dragging) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
    },
    [dragging],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const next = keyResize(event.key, event.shiftKey, size, range, sign);
      if (next === undefined) return;
      event.preventDefault();
      onChange(next);
    },
    [onChange, range, sign, size],
  );

  return { dragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
```

- [ ] **Step 6: Write the component**

Create `src/webview/components/splitter.tsx`:

```tsx
/**
 * A draggable divider, used by the Roadmap gutter and the detail pane.
 *
 * `role="separator"` with `aria-valuenow` is the ARIA window-splitter pattern:
 * it is focusable and resizable from the keyboard, because a mouse-only resize
 * would make part of the UI unreachable.
 */
import type { ReactNode } from 'react';

import { useDragResize } from '../hooks/use-drag-resize';
import type { Range } from '../lib/drag-resize';
import { cn } from '../lib/utils';

export function Splitter({
  size,
  range,
  sign = 1,
  onChange,
  label,
  onReset,
  className,
}: {
  size: number;
  range: Range;
  /** 1 when the resized pane is left of the handle, -1 when it is right of it. */
  sign?: 1 | -1;
  onChange: (next: number) => void;
  label: string;
  /** Double-click target. Omit to make double-click do nothing. */
  onReset?: () => void;
  className?: string;
}): ReactNode {
  const { dragging, ...handlers } = useDragResize({ size, range, sign, onChange });

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      onDoubleClick={onReset}
      {...handlers}
      // `touch-none` stops the webview panning instead of resizing on a trackpad
      // press-drag; `select-none` stops the drag selecting the rows either side.
      className={cn(
        'group relative w-1.5 shrink-0 cursor-col-resize touch-none select-none',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'surface-interactive absolute inset-y-0 left-1/2 w-px -translate-x-1/2',
          dragging ? 'bg-border-strong' : 'bg-border group-hover:bg-border-strong',
        )}
      />
    </div>
  );
}
```

- [ ] **Step 7: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all clean. (`<Splitter>` is unused so far; that is fine — esbuild does not fail on it and eslint's unused rule applies to bindings, not exports.)

- [ ] **Step 8: Commit** (only if authorised)

```bash
git add src/webview/lib/drag-resize.ts src/webview/hooks/use-drag-resize.ts src/webview/components/splitter.tsx src/test/drag-resize.test.ts
git commit -m "feat(webview): add keyboard-accessible splitter primitive"
```

---

### Task 3: Density-driven gridline ticks

**Files:**
- Modify: `src/shared/schedule.ts:144-223` (`buildTicks`, `buildTimeline`)
- Test: `src/test/schedule.test.ts` (extend)

**Interfaces:**
- Produces: `buildTimeline(groups, isDone, now, opts?: { pxPerDay?: number }): Timeline`. The fourth parameter is optional, so every existing call site compiles unchanged.

**Why:** `buildTicks` currently picks its step from the *window length*. Zoom (Task 11) widens the track without changing the window, so a zoomed-in chart would keep monthly gridlines. Picking the step from **pixels per day** fixes that and also removes the `hidden @2xl:inline` workaround at `gantt.tsx:66`, which exists only because a narrow panel crowds daily labels.

**Deliberate behaviour change:** at the fallback density, a ~15-to-21-day window now gets weekly ticks where it used to get daily ones. Daily ticks across 21 days in a 900px pane are 43px apart — under the 64px minimum, which is precisely the crowding being fixed.

- [ ] **Step 1: Write the failing test**

Append to `src/test/schedule.test.ts`:

```ts
describe('buildTicks density', () => {
  function windowOf(days: number, pxPerDay?: number) {
    const groups: EpicGroup[] = [
      {
        epic: bead({ id: 'e', issue_type: 'epic' }),
        children: [bead({ id: 't', created_at: iso(0), due_at: iso(days * DAY) })],
        doneCount: 0,
        totalCount: 1,
      },
    ];
    return buildTimeline(groups, () => false, NOW, pxPerDay ? { pxPerDay } : undefined);
  }

  it('keeps every tick inside the window', () => {
    const timeline = windowOf(30, 48);
    expect(timeline.ticks.length).toBeGreaterThan(0);
    for (const tick of timeline.ticks) {
      expect(tick.at).toBeGreaterThanOrEqual(timeline.start);
      expect(tick.at).toBeLessThanOrEqual(timeline.end);
    }
  });

  it('never places two ticks closer than 64px at the given density', () => {
    for (const pxPerDay of [4, 12, 48]) {
      const timeline = windowOf(120, pxPerDay);
      const perMs = pxPerDay / DAY;
      for (let i = 1; i < timeline.ticks.length; i += 1) {
        const gapPx = (timeline.ticks[i].at - timeline.ticks[i - 1].at) * perMs;
        // Month ticks are irregular (28-31 days); allow the shortest month.
        expect(gapPx).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('subdivides a zoomed-in day window into hours', () => {
    const timeline = windowOf(2, 48);
    expect(timeline.ticks.some((tick) => tick.label.includes(':'))).toBe(true);
  });

  it('falls back to a sane density when pxPerDay is omitted', () => {
    const timeline = windowOf(30);
    expect(timeline.ticks.length).toBeGreaterThan(1);
    expect(timeline.ticks.length).toBeLessThan(20);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/schedule.test.ts`
Expected: FAIL — `buildTimeline` takes 3 arguments (TS error under vitest's transform) and the 2-day window yields no hour labels.

- [ ] **Step 3: Refactor `buildTicks` into density-driven form**

In `src/shared/schedule.ts`, replace the whole `buildTicks` function (lines 140-204) with:

```ts
/** Below this, gridline labels collide and the axis stops being readable. */
const MIN_TICK_PX = 64;

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
```

- [ ] **Step 4: Thread `pxPerDay` through `buildTimeline`**

Replace `buildTimeline` (lines 206-223) with:

```ts
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
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/test/schedule.test.ts && npm test`
Expected: PASS. The pre-existing assertions at `schedule.test.ts:156-165` only require non-empty in-window ticks, so they still hold.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 7: Commit** (only if authorised)

```bash
git add src/shared/schedule.ts src/test/schedule.test.ts
git commit -m "refactor(schedule): choose gridline step by pixel density, not window length"
```

---

### Task 4: `setDue` and `setEstimate` on the host

**Files:**
- Modify: `src/shared/protocol.ts:16-75`
- Modify: `src/extension/bd/mutations.ts:45-49` (insert after `close`)
- Modify: `src/extension/panel/router.ts:78-80` (insert after `closeBead`)
- Test: `src/test/queries.test.ts` (append)

**Interfaces:**
- Produces:
  - RPC `setDue: { params: { id: string; date: string }; result: { ok: true } }`
  - RPC `setEstimate: { params: { id: string; minutes: number }; result: { ok: true } }`
  - `BdMutations.setDue(id: string, date: string): Promise<void>`
  - `BdMutations.setEstimate(id: string, minutes: number): Promise<void>`

**Flags verified** against `C:\Users\CuongBPV\Workspace\AI\beads\docs\CLI_REFERENCE.md` lines 1466-1498: `--due string` ("empty to clear", formats include `2025-01-15`) and `-e, --estimate int` (minutes). There is **no `--start`** — do not invent one.

- [ ] **Step 1: Write the failing test**

Append to `src/test/queries.test.ts`:

```ts
describe('BdMutations schedule writes', () => {
  function mutations(fake: FakeBd): BdMutations {
    return new BdMutations(fake as unknown as BdService);
  }

  it('sets a due date in the format bd documents', async () => {
    const fake = new FakeBd();
    await mutations(fake).setDue('bd-a1', '2026-09-01');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--due', '2026-09-01']]);
  });

  it('clears a due date with an empty string', async () => {
    const fake = new FakeBd();
    await mutations(fake).setDue('bd-a1', '');
    expect(fake.argv).toEqual([['update', 'bd-a1', '--due', '']]);
  });

  it('sends the estimate as whole minutes', async () => {
    const fake = new FakeBd();
    await mutations(fake).setEstimate('bd-a1', 89.6);
    expect(fake.argv).toEqual([['update', 'bd-a1', '--estimate', '90']]);
  });

  it('notifies listeners with the changed id', async () => {
    const fake = new FakeBd();
    const changed: string[][] = [];
    const bd = mutations(fake);
    bd.onChanged((ids) => changed.push(ids));

    await bd.setEstimate('bd-a1', 30);

    expect(changed).toEqual([['bd-a1']]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/queries.test.ts`
Expected: FAIL — `mutations(fake).setDue is not a function`.

- [ ] **Step 3: Add the mutations**

In `src/extension/bd/mutations.ts`, insert after `close` (after line 49):

```ts
  /**
   * The bar's right edge, for an issue that carries a due date.
   *
   * `date` is `YYYY-MM-DD` in the user's local calendar. An empty string clears
   * the due date, which is what bd documents for `--due ""`.
   */
  async setDue(id: string, date: string): Promise<void> {
    await this.run(['update', id, '--due', date], id);
  }

  /**
   * The bar's right edge, for an issue with no due date.
   *
   * bd stores an int, so the value is rounded here rather than trusting a
   * float to survive `String()`.
   */
  async setEstimate(id: string, minutes: number): Promise<void> {
    await this.run(['update', id, '--estimate', String(Math.round(minutes))], id);
  }
```

Also extend the file header comment on line 5 from
`The scope is deliberately narrow — status, priority, assignee, close —` to
`The scope is deliberately narrow — status, priority, assignee, due, estimate, close —`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Declare the methods on the wire**

In `src/shared/protocol.ts`, insert after the `closeBead` entry (after line 52):

```ts
  /** Right-edge bar drag on an issue that carries a due date. `date` is YYYY-MM-DD. */
  setDue: {
    params: { id: string; date: string };
    result: { ok: true };
  };
  /** Right-edge bar drag on an issue with no due date. Minutes, as bd stores them. */
  setEstimate: {
    params: { id: string; minutes: number };
    result: { ok: true };
  };
```

And extend `MUTATING_METHODS` (lines 70-75) so the host refetches after these writes:

```ts
export const MUTATING_METHODS: ReadonlySet<RpcMethodName> = new Set<RpcMethodName>([
  'setStatus',
  'setPriority',
  'setAssignee',
  'setDue',
  'setEstimate',
  'closeBead',
]);
```

- [ ] **Step 6: Route them**

In `src/extension/panel/router.ts`, insert after the `closeBead` case (after line 80):

```ts
    case 'setDue':
      // An empty string is meaningful here — it clears the due date — so this
      // deliberately does not go through requireString.
      await mutations.setDue(id(), String(params.date ?? ''));
      return { ok: true };

    case 'setEstimate': {
      const minutes = Number(params.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error('Missing required parameter "minutes".');
      }
      await mutations.setEstimate(id(), minutes);
      return { ok: true };
    }
```

- [ ] **Step 7: Verify the whole suite and the types**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean. `RpcMethods` is exhaustive over the router's switch, so a missing case would surface here.

- [ ] **Step 8: Commit** (only if authorised)

```bash
git add src/shared/protocol.ts src/extension/bd/mutations.ts src/extension/panel/router.ts src/test/queries.test.ts
git commit -m "feat(bd): add setDue and setEstimate mutations"
```

---

### Task 5: Bar-drag decision logic

**Files:**
- Create: `src/webview/lib/bar-drag.ts`
- Test: `src/test/bar-drag.test.ts`

**Interfaces:**
- Consumes: `DAY`, `MINUTE`, `Span`, `Timeline` from `src/shared/schedule.ts`.
- Produces:
  - `type BarEdit = { field: 'due'; at: number } | { field: 'estimate'; minutes: number } | { field: 'none'; reason: 'closed' | 'unchanged' }`
  - `endFromDrag(span: Span, deltaPx: number, trackPx: number, timeline: Timeline): number`
  - `snapToDay(at: number): number`
  - `toDueDate(at: number): string`
  - `planBarEdit(span: Span, newEnd: number): BarEdit`
  - `const ESTIMATE_STEP_MINUTES = 15`

- [ ] **Step 1: Write the failing test**

Create `src/test/bar-drag.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ESTIMATE_STEP_MINUTES, endFromDrag, planBarEdit, snapToDay, toDueDate } from '../webview/lib/bar-drag';
import { DAY, HOUR, MINUTE, type Span, type Timeline } from '../shared/schedule';
import type { Bead } from '../shared/types';

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

/** A 10-day window; with a 1000px track that is exactly 100px per day. */
const timeline: Timeline = {
  epics: [],
  start: NOW,
  end: NOW + 10 * DAY,
  now: NOW,
  ticks: [],
};

describe('endFromDrag', () => {
  it('converts pixels to milliseconds against the window', () => {
    const s = span({ bead: bead({ id: 'a' }) });
    expect(endFromDrag(s, 100, 1000, timeline)).toBe(s.end + DAY);
    expect(endFromDrag(s, -50, 1000, timeline)).toBe(s.end - DAY / 2);
  });

  it('never lets the end fall to or before the start', () => {
    const s = span({ bead: bead({ id: 'a' }) });
    expect(endFromDrag(s, -9999, 1000, timeline)).toBe(s.start + MINUTE);
  });

  it('returns the current end when the track has not been measured', () => {
    const s = span({ bead: bead({ id: 'a' }) });
    expect(endFromDrag(s, 400, 0, timeline)).toBe(s.end);
  });
});

describe('snapToDay', () => {
  it('rounds to the nearer local midnight', () => {
    const morning = new Date(2026, 7, 4, 9, 0, 0, 0).getTime();
    const evening = new Date(2026, 7, 4, 20, 0, 0, 0).getTime();
    expect(snapToDay(morning)).toBe(new Date(2026, 7, 4).getTime());
    expect(snapToDay(evening)).toBe(new Date(2026, 7, 5).getTime());
  });
});

describe('toDueDate', () => {
  it('formats the local calendar day, not the UTC one', () => {
    // 2026-08-04 23:30 local is 2026-08-04 for bd, even where toISOString says the 5th.
    expect(toDueDate(new Date(2026, 7, 4, 23, 30).getTime())).toBe('2026-08-04');
    expect(toDueDate(new Date(2026, 11, 31).getTime())).toBe('2026-12-31');
  });
});

describe('planBarEdit', () => {
  it('refuses to edit a closed issue', () => {
    const s = span({ bead: bead({ id: 'a', status: 'closed' }), kind: 'actual' });
    expect(planBarEdit(s, s.end + DAY)).toEqual({ field: 'none', reason: 'closed' });
  });

  it('writes a due date when the issue carries one', () => {
    const due = new Date(2026, 7, 8).getTime();
    const s = span({ bead: bead({ id: 'a', due_at: new Date(due).toISOString() }), end: due, kind: 'due' });

    const edit = planBarEdit(s, due + 4 * DAY);

    expect(edit).toEqual({ field: 'due', at: new Date(2026, 7, 12).getTime() });
  });

  it('does nothing when the drag lands on the same calendar day', () => {
    const due = new Date(2026, 7, 8).getTime();
    const s = span({ bead: bead({ id: 'a', due_at: new Date(due).toISOString() }), end: due, kind: 'due' });

    expect(planBarEdit(s, due + 2 * HOUR)).toEqual({ field: 'none', reason: 'unchanged' });
  });

  it('writes an estimate when the issue has no due date', () => {
    const s = span({ bead: bead({ id: 'a', estimated_minutes: 60 }), end: NOW + HOUR, kind: 'estimated' });

    expect(planBarEdit(s, NOW + 3 * HOUR)).toEqual({ field: 'estimate', minutes: 180 });
  });

  it('snaps an estimate to a quarter hour and never below one step', () => {
    const s = span({ bead: bead({ id: 'a' }), end: NOW + HOUR, kind: 'nominal' });

    expect(planBarEdit(s, NOW + 22 * MINUTE)).toEqual({ field: 'estimate', minutes: 15 });
    expect(planBarEdit(s, NOW - 5 * DAY)).toEqual({
      field: 'estimate',
      minutes: ESTIMATE_STEP_MINUTES,
    });
  });

  it('does nothing when the snapped estimate equals the stored one', () => {
    const s = span({ bead: bead({ id: 'a', estimated_minutes: 60 }), end: NOW + HOUR, kind: 'estimated' });

    expect(planBarEdit(s, NOW + 62 * MINUTE)).toEqual({ field: 'none', reason: 'unchanged' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/bar-drag.test.ts`
Expected: FAIL — `Failed to resolve import "../webview/lib/bar-drag"`.

- [ ] **Step 3: Write the implementation**

Create `src/webview/lib/bar-drag.ts`:

```ts
/**
 * Turning a drag on a bar's right edge into a bd write.
 *
 * beads has no `--start` (verified against bd's CLI reference), so only the end
 * of a bar is editable — and which field that end lands in depends on what the
 * issue already carries. All of that decision lives here, pure, because the
 * failure mode is writing the wrong date into someone's tracker.
 */
import { DAY, MINUTE, type Span, type Timeline } from '../../shared/schedule';

/** bd stores minutes; a quarter hour is the finest grid a drag can honestly hit. */
export const ESTIMATE_STEP_MINUTES = 15;

export type BarEdit =
  | { field: 'due'; at: number }
  | { field: 'estimate'; minutes: number }
  | { field: 'none'; reason: 'closed' | 'unchanged' };

/**
 * Where the bar's end lands after its handle moves `deltaPx` across a track
 * `trackPx` wide. `trackPx` of 0 means nothing has been measured yet.
 */
export function endFromDrag(
  span: Span,
  deltaPx: number,
  trackPx: number,
  timeline: Timeline,
): number {
  if (trackPx <= 0) return span.end;
  const msPerPx = (timeline.end - timeline.start) / trackPx;
  return Math.max(span.start + MINUTE, span.end + deltaPx * msPerPx);
}

/** The nearer local midnight — bd's `--due` takes a calendar date, not a time. */
export function snapToDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  const floor = date.getTime();
  return at - floor >= DAY / 2 ? floor + DAY : floor;
}

/**
 * `YYYY-MM-DD` in local time.
 *
 * Never `toISOString().slice(0, 10)`: in a +07 zone that reports tomorrow for
 * anything after 17:00, and the user would watch their due date jump a day.
 */
export function toDueDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Decide what — if anything — to write.
 *
 * `none` is a first-class outcome, not an error: a drag that lands back where it
 * started must not spawn a bd subprocess, and a closed issue's end is
 * `closed_at`, which bd will not accept.
 */
export function planBarEdit(span: Span, newEnd: number): BarEdit {
  if (span.kind === 'actual') return { field: 'none', reason: 'closed' };

  if (span.bead.due_at) {
    const at = snapToDay(newEnd);
    if (toDueDate(at) === toDueDate(span.end)) return { field: 'none', reason: 'unchanged' };
    return { field: 'due', at };
  }

  const raw = (newEnd - span.start) / MINUTE;
  const minutes = Math.max(
    ESTIMATE_STEP_MINUTES,
    Math.round(raw / ESTIMATE_STEP_MINUTES) * ESTIMATE_STEP_MINUTES,
  );
  if (minutes === span.bead.estimated_minutes) return { field: 'none', reason: 'unchanged' };
  return { field: 'estimate', minutes };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/bar-drag.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 6: Commit** (only if authorised)

```bash
git add src/webview/lib/bar-drag.ts src/test/bar-drag.test.ts
git commit -m "feat(roadmap): add bar-drag to bd-field mapping"
```

---

### Task 6: Trailing slot on the filter bar

**Files:**
- Modify: `src/webview/components/quick-filter-bar.tsx:15-115`

**Interfaces:**
- Produces: `QuickFilterBar` gains an optional `trailing?: ReactNode` prop, rendered as the **last child of the wrapping flex container** so it wraps with the selects instead of being pinned to the right of line one.

**Why:** today the `[Timeline][List]` group is a `shrink-0` sibling *outside* this component (`RoadmapView.tsx:122-135`). In a narrow panel the selects wrap to line two while the toggle stays on line one, leaving a hole in the middle of line one. Moving it inside the same wrap flow closes the hole.

- [ ] **Step 1: Add the prop**

In `src/webview/components/quick-filter-bar.tsx`, change the import on line 8 to include `ReactNode` as a value-level type import (it already imports `type ReactNode`), then extend the props:

```tsx
export function QuickFilterBar({
  beads,
  epics,
  query,
  onChange,
  className,
  trailing,
}: {
  beads: Bead[];
  epics: Bead[];
  query: BeadQuery;
  onChange: (next: BeadQuery) => void;
  className?: string;
  /**
   * Controls that belong to the owning tab — the Roadmap's shape and sort
   * pickers. They live inside this flex container rather than beside it so they
   * wrap with the selects; pinned outside, they leave a hole in the first row
   * the moment the panel is too narrow for one line.
   */
  trailing?: ReactNode;
}): ReactNode {
```

- [ ] **Step 2: Render it last**

Replace the closing of the flex container (lines 104-115) with:

```tsx
      {active ? (
        <button
          type="button"
          onClick={() => onChange({ includeClosed: query.includeClosed })}
          className="text-fg-muted hover:text-fg surface-interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm"
        >
          <X aria-hidden="true" className="size-3.5" />
          Clear
        </button>
      ) : null}

      {trailing}
    </div>
  );
}
```

- [ ] **Step 3: Export the `Select` helper for reuse**

The Roadmap needs the same select styling for its Sort and Zoom pickers. Change line 118 from `function Select({` to:

```tsx
/** Shared by the filter bar and by any tab-owned control passed in via `trailing`. */
export function Select({
```

- [ ] **Step 4: Verify nothing regressed**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all clean. `BoardView` also renders `QuickFilterBar`; `trailing` is optional so it is unaffected.

- [ ] **Step 5: Commit** (only if authorised)

```bash
git add src/webview/components/quick-filter-bar.tsx
git commit -m "feat(webview): let a tab pass trailing controls into the filter bar"
```

---

## WAVE 2

### Task 7: Gantt axis component

**Files:**
- Create: `src/webview/components/gantt/gantt-axis.tsx`

**Interfaces:**
- Consumes: `placement`, `Timeline` from `src/shared/schedule.ts`; `cn`, `shortDate` from `src/webview/lib/utils.ts`.
- Produces:
  - `<GanttAxis timeline={Timeline} />` — the sticky header row (corner cell + tick labels).
  - `<GanttGrid timeline={Timeline} />` — the absolutely-positioned gridline and today-marker overlay.

Both read the gutter width from the `--gantt-gutter` custom property set by the shell in Task 11; neither takes a width prop, so the header and the rows cannot drift apart.

The `hidden @2xl:inline` class that used to hide minor labels is **gone** — Task 3 makes ticks sparse by construction.

- [ ] **Step 1: Write the component**

Create `src/webview/components/gantt/gantt-axis.tsx`:

```tsx
/**
 * The Gantt's date axis and its gridline layer.
 *
 * Both are positioned from the same `--gantt-gutter` custom property the shell
 * sets, so a resized gutter cannot leave the header and the rows disagreeing
 * about where the track begins.
 */
import type { ReactNode } from 'react';

import { placement, type Timeline } from '../../../shared/schedule';
import { cn, shortDate } from '../../lib/utils';

/** Every element that must line up with the label gutter uses this. */
export const GUTTER_CLASS = 'w-[var(--gantt-gutter)] shrink-0';

export function GanttAxis({ timeline }: { timeline: Timeline }): ReactNode {
  return (
    <div className="bg-bg border-border sticky top-0 z-20 flex items-end border-b pb-1">
      {/* The corner outranks both sticky axes, or a scrolled row shows through it. */}
      <div className={cn(GUTTER_CLASS, 'bg-bg sticky left-0 z-30 px-2 text-xs text-fg-muted')}>
        {shortDate(timeline.start)} → {shortDate(timeline.end)}
      </div>
      <div className="relative h-6 min-w-0 flex-1">
        {timeline.ticks.map((tick) => {
          const { left } = placement({ start: tick.at, end: tick.at }, timeline);
          return (
            <span
              key={tick.at}
              className={cn(
                'absolute bottom-0 -translate-x-1/2 text-[10px] whitespace-nowrap',
                tick.major ? 'text-fg font-medium' : 'text-fg-muted',
              )}
              style={{ left: `${left}%` }}
            >
              {tick.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Gridlines and the today marker, behind every row. */
export function GanttGrid({ timeline }: { timeline: Timeline }): ReactNode {
  const nowLeft = placement({ start: timeline.now, end: timeline.now }, timeline).left;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
      <div className={GUTTER_CLASS} />
      <div className="relative min-w-0 flex-1">
        {timeline.ticks.map((tick) => {
          const { left } = placement({ start: tick.at, end: tick.at }, timeline);
          return (
            <span
              key={tick.at}
              // Gridlines are scaffolding: day boundaries a little firmer than
              // the rest, but never louder than the bars or the today marker.
              className={cn(
                'absolute inset-y-0 w-px',
                tick.major ? 'bg-border-strong/35' : 'bg-border/40',
              )}
              style={{ left: `${left}%` }}
            />
          );
        })}
        <span className="bg-danger absolute inset-y-0 w-0.5" style={{ left: `${nowLeft}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Commit** (only if authorised)

```bash
git add src/webview/components/gantt/gantt-axis.tsx
git commit -m "feat(gantt): extract the date axis and gridline layer"
```

---

### Task 8: Gantt bar with a resize handle

**Files:**
- Create: `src/webview/components/gantt/gantt-bar.tsx`

**Interfaces:**
- Consumes: `endFromDrag`, `planBarEdit`, `toDueDate`, `BarEdit` from `src/webview/lib/bar-drag.ts`; `formatDuration`, `placement`, `Span`, `Timeline` from `src/shared/schedule.ts`; `typeStyle` from `src/shared/types.ts`; `cn`, `shortDate` from `src/webview/lib/utils.ts`.
- Produces: `<GanttBar span timeline done onSelect onCommit pending />` where
  `onCommit: (edit: BarEdit) => void` and `pending: boolean`.

**Guards, per the spec:** an 8px handle that appears only on hover/focus; a 4px movement threshold before a drag counts; `planBarEdit` returning `none` results in **no call at all**; closed issues get no handle.

- [ ] **Step 1: Write the component**

Create `src/webview/components/gantt/gantt-bar.tsx`:

```tsx
/**
 * One task bar, and the handle that reschedules it.
 *
 * The bar body stays a plain button that selects the issue — making it both
 * draggable and clickable would swallow the selection. Only the right edge is
 * draggable, because beads has no `--start` to write a left edge back to.
 */
import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { formatDuration, placement, type Span, type Timeline } from '../../../shared/schedule';
import { typeStyle } from '../../../shared/types';
import { endFromDrag, planBarEdit, toDueDate, type BarEdit } from '../../lib/bar-drag';
import { cn, shortDate } from '../../lib/utils';

/** Below this the pointer has not moved enough to mean a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

const KIND_TEXT: Record<Span['kind'], string> = {
  actual: 'closed',
  due: 'due',
  estimated: 'estimated end',
  nominal: 'no dates — nominal bar',
};

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

export function GanttBar({
  span,
  timeline,
  done,
  onSelect,
  onCommit,
  pending,
}: {
  span: Span;
  timeline: Timeline;
  done: boolean;
  onSelect: (id: string) => void;
  /** Called once on release, and never with a `none` edit. */
  onCommit: (edit: BarEdit) => void;
  /** True between release and the host's next snapshot. */
  pending: boolean;
}): ReactNode {
  const bead = span.bead;
  const style = typeStyle(bead.issue_type);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, moved: false });
  const [preview, setPreview] = useState<number | undefined>(undefined);

  // A closed bar ends at `closed_at`, which bd does not accept as an argument.
  const editable = span.kind !== 'actual';
  const shown: Span = preview === undefined ? span : { ...span, end: preview };
  const { left, width } = placement(shown, timeline);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, moved: false };
    setPreview(span.end);
  }, [span.end]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (preview === undefined) return;
      const delta = event.clientX - drag.current.x;
      if (!drag.current.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      drag.current.moved = true;
      setPreview(endFromDrag(span, delta, trackRef.current?.clientWidth ?? 0, timeline));
    },
    [preview, span, timeline],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (preview === undefined) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const moved = drag.current.moved;
      const end = preview;
      setPreview(undefined);
      if (!moved) return;

      const edit = planBarEdit(span, end);
      // `none` means the drag landed back where it started, or the issue is
      // closed. Either way this must not spawn a bd subprocess.
      if (edit.field === 'none') return;
      onCommit(edit);
    },
    [onCommit, preview, span],
  );

  return (
    <div ref={trackRef} className="relative h-7 min-w-0 flex-1">
      <button
        type="button"
        onClick={() => onSelect(bead.id)}
        title={barTitle(span)}
        className={cn(
          'absolute top-1/2 flex h-4 -translate-y-1/2 cursor-pointer items-center gap-1 rounded-sm px-1 text-[10px] whitespace-nowrap transition-[filter,box-shadow] hover:brightness-110',
          // An inferred end is drawn faint, so a bar that is really a guess
          // never reads as a commitment.
          span.kind === 'nominal' && 'opacity-55',
          span.overdue && 'ring-danger ring-1',
          pending && 'animate-pulse opacity-60',
        )}
        style={
          {
            left: `${left}%`,
            width: `${width}%`,
            background: done
              ? `color-mix(in oklab, var(--color-success) 55%, transparent)`
              : span.deferred
                ? `color-mix(in oklab, ${style.color} 30%, transparent)`
                : style.color,
            color: 'var(--color-bg)',
          } as CSSProperties
        }
      >
        <span className="sr-only">{barTitle(span)}</span>
      </button>

      {editable ? (
        <span
          role="slider"
          aria-label={`Reschedule ${bead.id}`}
          aria-valuenow={Math.round(shown.end / 1000)}
          aria-valuetext={toDueDate(shown.end)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={cn(
            // Invisible until the row is hovered or the handle is focused: a
            // permanently visible grip on every bar would be noise, and an
            // easy way to write a date nobody meant to change.
            'absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 cursor-col-resize touch-none rounded-sm opacity-0',
            'bg-fg-strong/70 group-hover/row:opacity-100 focus-visible:opacity-100',
            preview !== undefined && 'opacity-100',
          )}
          style={{ left: `${Math.min(left + width, 100)}%` }}
        />
      ) : null}

      {/* The estimate rides outside the bar, where a 3px bar can still show it. */}
      {bead.estimated_minutes ? (
        <span
          aria-hidden="true"
          className="text-fg-muted absolute top-1/2 hidden -translate-y-1/2 pl-3 text-[10px] whitespace-nowrap tabular-nums @2xl:inline"
          style={{ left: `${Math.min(left + width, 96)}%` }}
        >
          {formatDuration(bead.estimated_minutes)}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Commit** (only if authorised)

```bash
git add src/webview/components/gantt/gantt-bar.tsx
git commit -m "feat(gantt): add a right-edge reschedule handle to task bars"
```

---

### Task 9: Resizable detail pane

**Files:**
- Modify: `src/webview/App.tsx:24-33` (`PersistedState`), `:41-64` (state + persist), `:152-222` (`<main>`)

**Interfaces:**
- Consumes: `<Splitter>` from Task 2, `clamp` / `Range` from `src/webview/lib/drag-resize.ts`.
- Produces: `PersistedState.detailWidth?: number`.

**Why the width travels as a CSS variable:** docked-versus-full-bleed is decided by the container query `@3xl:` on the `@container` root. JavaScript cannot read a container query, and a JS media query would disagree with it the moment the panel is not the viewport. Putting the width in `--detail-w` lets the existing class keep deciding.

- [ ] **Step 1: Add the state**

In `src/webview/App.tsx`, extend `PersistedState` (after line 32):

```ts
  /** Detail-pane width in px. Absent until the user first drags it. */
  detailWidth?: number;
```

Add the imports (after line 14):

```ts
import { Splitter } from './components/splitter';
import { clamp, type Range } from './lib/drag-resize';
```

Add near the other `useState` calls (after line 51):

```tsx
const [detailWidth, setDetailWidth] = useState(saved?.detailWidth ?? DETAIL_DEFAULT_PX);
const mainRef = useRef<HTMLElement>(null);
const [mainWidth, setMainWidth] = useState(0);

// The maximum is a share of the container, so it moves when the panel does.
const detailRange = useMemo<Range>(
  () => ({ min: DETAIL_MIN_PX, max: Math.round(mainWidth * DETAIL_MAX_SHARE) }),
  [mainWidth],
);

useEffect(() => {
  const node = mainRef.current;
  if (!node) return;
  const observer = new ResizeObserver(([entry]) => setMainWidth(entry.contentRect.width));
  observer.observe(node);
  return () => observer.disconnect();
}, []);

// Re-clamp whenever the container shrinks, not only while dragging: a pane
// restored at 900px would otherwise swallow the whole view in a narrow window.
useEffect(() => {
  if (mainWidth === 0) return;
  setDetailWidth((current) => clamp(current, detailRange));
}, [detailRange, mainWidth]);
```

Add the constants above `export function App()` (after line 39):

```ts
/** Matches today's `w-96`, so nothing moves until the user drags. */
const DETAIL_DEFAULT_PX = 384;
const DETAIL_MIN_PX = 320;
const DETAIL_MAX_SHARE = 0.7;
```

- [ ] **Step 2: Persist it**

Add `detailWidth` to the `persist` payload and its dependency array (lines 56-63):

```tsx
  useEffect(
    () =>
      persist<PersistedState>({
        tab,
        query,
        collapsedColumns,
        roadmapShowClosed,
        roadmapShape,
        detailWidth,
      }),
    [tab, query, collapsedColumns, roadmapShowClosed, roadmapShape, detailWidth],
  );
```

- [ ] **Step 3: Render the splitter**

Replace `<main className="flex min-h-0 flex-1">` on line 152 with:

```tsx
        <main
          ref={mainRef}
          className="flex min-h-0 flex-1"
          style={{ '--detail-w': `${detailWidth}px` } as CSSProperties}
        >
```

Replace the detail block (lines 205-221) with:

```tsx
          {selected ? (
            <>
              {/* Narrow: the pane covers the content, so there is nothing to split. */}
              <Splitter
                className="hidden @3xl:block"
                label="Resize detail panel"
                size={detailWidth}
                range={detailRange}
                // The pane is right of the handle, so dragging right narrows it.
                sign={-1}
                onChange={setDetailWidth}
                onReset={() => setDetailWidth(clamp(DETAIL_DEFAULT_PX, detailRange))}
              />
              <div className="absolute inset-0 z-10 @3xl:static @3xl:z-auto @3xl:w-[var(--detail-w)] @3xl:shrink-0">
                <BeadDetail
                  bead={selected}
                  beads={beads}
                  index={index}
                  onClose={() => setFocusedId(undefined)}
                  onSelect={onSelect}
                  refreshKey={snapshot?.fetchedAt}
                />
              </div>
            </>
          ) : null}
```

Add `type CSSProperties` to the React type import on line 8.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm test && npm run build`

- [ ] **Step 5: Manual check**

Run `npm run build`, open the extension host (F5 in VSCode), open the Beads Dashboard, select an issue.
Expected: a divider appears left of the pane; dragging it resizes; the pane stops at 320px and at 70% of the panel; Tab reaches the divider and ←/→ move it; double-click returns it to 384px; narrowing the whole window never hides the content area.

- [ ] **Step 6: Commit** (only if authorised)

```bash
git add src/webview/App.tsx
git commit -m "feat(webview): make the detail pane draggable and remember its width"
```

---

### Task 10: Schedule-edit hook

**Files:**
- Create: `src/webview/hooks/use-schedule-edit.ts`

**Interfaces:**
- Consumes: `call`, `asRpcError` from `src/webview/bridge/rpc.ts`; `useToast` from `src/webview/components/toast.tsx`; `BarEdit`, `toDueDate` from `src/webview/lib/bar-drag.ts`; `formatDuration` from `src/shared/schedule.ts`.
- Produces: `useScheduleEdit(): { pending: ReadonlySet<string>; commit: (span: Span, edit: BarEdit) => void }`.

`pending` holds ids between release and the host's next snapshot; `<GanttBar pending>` reads it. This mirrors the mutate-then-refetch pattern already in `bead-detail.tsx:74-85` — no optimistic write, because a failed `bd` call must not leave a lie on screen.

- [ ] **Step 1: Write the hook**

Create `src/webview/hooks/use-schedule-edit.ts`:

```ts
/**
 * Commits a bar drag to bd.
 *
 * Mutate, toast, and wait for the host's snapshot — the same contract the detail
 * pane uses. Nothing is written optimistically: if bd refuses, the bar must snap
 * back rather than keep showing a date that was never stored.
 */
import { useCallback, useState } from 'react';

import { formatDuration, type Span } from '../../shared/schedule';
import { asRpcError, call } from '../bridge/rpc';
import { useToast } from '../components/toast';
import { toDueDate, type BarEdit } from '../lib/bar-drag';
import { shortDate } from '../lib/utils';

export interface ScheduleEditApi {
  /** Ids awaiting a fresh snapshot. */
  pending: ReadonlySet<string>;
  commit: (span: Span, edit: BarEdit) => void;
}

export function useScheduleEdit(): ScheduleEditApi {
  const { notify } = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const release = useCallback((id: string) => {
    setPending((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(
    (span: Span, edit: BarEdit) => {
      if (edit.field === 'none') return;
      const id = span.bead.id;
      setPending((current) => new Set(current).add(id));

      const request =
        edit.field === 'due'
          ? call('setDue', { id, date: toDueDate(edit.at) })
          : call('setEstimate', { id, minutes: edit.minutes });

      const summary =
        edit.field === 'due'
          ? `${id} · due ${shortDate(span.end)} → ${shortDate(edit.at)}`
          : `${id} · est ${formatDuration(span.bead.estimated_minutes) || 'none'} → ${formatDuration(edit.minutes)}`;

      request
        .then(() => notify(summary))
        .catch((error: unknown) => notify(asRpcError(error).message, 'error'))
        .finally(() => release(id));
    },
    [notify, release],
  );

  return { pending, commit };
}
```

- [ ] **Step 2: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean. If `asRpcError` is not exported from `bridge/rpc.ts`, use the same import `bead-detail.tsx:36` uses — it is.

- [ ] **Step 3: Commit** (only if authorised)

```bash
git add src/webview/hooks/use-schedule-edit.ts
git commit -m "feat(roadmap): add the schedule-edit commit hook"
```

---

## WAVE 3

### Task 11: Frozen-grid Gantt shell

**Files:**
- Create: `src/webview/components/gantt/gantt-rows.tsx`
- Create: `src/webview/components/gantt/gantt-legend.tsx`
- Create: `src/webview/components/gantt/gantt-chart.tsx`
- Create: `src/webview/components/gantt/index.ts`
- Delete: `src/webview/components/gantt.tsx`

**Interfaces:**
- Consumes: `GanttAxis`, `GanttGrid`, `GUTTER_CLASS` (Task 7); `GanttBar` (Task 8); `sortTimeline` (Task 1); `BarEdit` (Task 5).
- Produces, all re-exported from `index.ts` so the existing import path `../components/gantt` keeps working:
  - `<GanttChart timeline index collapsed onToggle onSelect selectedId blockedIds gutter onGutterChange zoom onCommit pendingIds />`
  - `<GanttLegend />`
  - `hasNoScheduleData(beads: Bead[]): boolean`
  - `type RoadmapZoom = 'fit' | 'day' | 'week' | 'month'`, `ROADMAP_ZOOMS`, `pxPerDayFor(zoom, trackPx, windowMs)`

**This task deletes `sortEpicSpans` from the tree.** `src/shared/roadmap-sort.ts` (Task 1) replaces it. Confirm with `rg "sortEpicSpans" src` that no reference survives.

- [ ] **Step 1: Write the legend**

Create `src/webview/components/gantt/gantt-legend.tsx` — move `GanttLegend` verbatim from `gantt.tsx:331-351`:

```tsx
/** Legend so the faint bars, the hollow epics and the red line are readable. */
import type { ReactNode } from 'react';

export function GanttLegend(): ReactNode {
  return (
    <ul className="text-fg-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <li className="flex items-center gap-1">
        <span className="bg-success/60 h-2 w-4 rounded-sm" /> done
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-type-task h-2 w-4 rounded-sm" /> open
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-type-task h-2 w-4 rounded-sm opacity-55" /> no dates
      </li>
      <li className="flex items-center gap-1">
        <span className="ring-danger h-2 w-4 rounded-sm ring-1" /> overdue
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-danger h-3 w-px" /> today
      </li>
    </ul>
  );
}
```

- [ ] **Step 2: Write the rows**

Create `src/webview/components/gantt/gantt-rows.tsx`:

```tsx
/**
 * The Gantt's two row shapes.
 *
 * The label cell is `sticky left-0` so task names survive a horizontal scroll at
 * a zoomed-in resolution; it needs an opaque background or the bars slide under
 * the text.
 */
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { StatusIndex, progressOf } from '../../../shared/model';
import { placement, type EpicSpan, type Span, type Timeline } from '../../../shared/schedule';
import { typeStyle } from '../../../shared/types';
import type { BarEdit } from '../../lib/bar-drag';
import { cn, shortDate } from '../../lib/utils';
import { PriorityDot, TypeIcon } from '../primitives';
import { GUTTER_CLASS } from './gantt-axis';
import { GanttBar } from './gantt-bar';

export function EpicRow({
  epic,
  timeline,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
}: {
  epic: EpicSpan;
  timeline: Timeline;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}): ReactNode {
  const bead = epic.group.epic;
  const synthetic = bead.id === '__unassigned__';
  const { left, width } = placement(epic, timeline);
  const done = progressOf(epic.group);
  const style = typeStyle(bead.issue_type);

  return (
    <li
      className={cn(
        'border-border/60 hover:bg-surface-hover flex items-center border-b transition-colors',
        bead.id === selectedId && 'bg-surface-active',
      )}
    >
      <div
        className={cn(
          GUTTER_CLASS,
          'bg-bg sticky left-0 z-10 flex min-w-0 items-center gap-1 py-1.5 pr-2 pl-1',
        )}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="text-fg-muted hover:text-fg shrink-0 cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="size-4" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-4" />
          )}
          <span className="sr-only">
            {collapsed ? 'Expand' : 'Collapse'} {bead.title}
          </span>
        </button>
        <TypeIcon type={bead.issue_type} className={style.className} />
        <button
          type="button"
          disabled={synthetic}
          onClick={() => onSelect(bead.id)}
          title={bead.title}
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium disabled:cursor-default"
        >
          {bead.title}
        </button>
        <span className="text-fg-muted shrink-0 text-[11px] tabular-nums">
          {epic.group.doneCount}/{epic.group.totalCount}
        </span>
      </div>

      <div className="relative h-8 min-w-0 flex-1">
        {/* The epic bar is a summary bracket: hollow, with progress filled in. */}
        <div
          className={cn(
            'absolute top-1/2 h-3 -translate-y-1/2 rounded-sm border',
            epic.hasOverdue ? 'border-danger' : 'border-border-strong',
          )}
          style={
            {
              left: `${left}%`,
              width: `${width}%`,
              background: `color-mix(in oklab, ${style.color} 14%, transparent)`,
            } as CSSProperties
          }
          title={`${bead.title} · ${shortDate(epic.start)} → ${shortDate(epic.end)} · ${done}%`}
        >
          <div
            className="bg-success/70 h-full rounded-l-[2px] transition-[width] duration-300"
            style={{ width: `${done}%` }}
          />
        </div>
      </div>
    </li>
  );
}

export function TaskRow({
  span,
  timeline,
  index,
  onSelect,
  selected,
  blocked,
  onCommit,
  pending,
}: {
  span: Span;
  timeline: Timeline;
  index: StatusIndex;
  onSelect: (id: string) => void;
  selected: boolean;
  blocked: boolean;
  onCommit: (span: Span, edit: BarEdit) => void;
  pending: boolean;
}): ReactNode {
  const bead = span.bead;
  const style = typeStyle(bead.issue_type);
  const done = index.isDone(bead.status);

  return (
    // `group/row` is what reveals the bar's drag handle on hover.
    <li
      className={cn(
        'group/row border-border/40 hover:bg-surface-hover flex items-center border-b transition-colors',
        selected && 'bg-surface-active',
      )}
    >
      <div
        className={cn(
          GUTTER_CLASS,
          'bg-bg sticky left-0 z-10 flex min-w-0 items-center gap-1.5 py-1 pr-2 pl-6',
        )}
      >
        <TypeIcon type={bead.issue_type} className={style.className} />
        <button
          type="button"
          onClick={() => onSelect(bead.id)}
          title={`${bead.id}: ${bead.title}`}
          className={cn(
            'min-w-0 flex-1 cursor-pointer truncate text-left text-[13px]',
            done && 'text-fg-muted line-through decoration-1',
          )}
        >
          {bead.title}
        </button>
        {blocked ? <Lock aria-label="blocked" className="text-fg-muted size-3 shrink-0" /> : null}
        <PriorityDot priority={bead.priority} />
      </div>

      <GanttBar
        span={span}
        timeline={timeline}
        done={done}
        onSelect={onSelect}
        onCommit={(edit) => onCommit(span, edit)}
        pending={pending}
      />
    </li>
  );
}
```

- [ ] **Step 3: Write the shell**

Create `src/webview/components/gantt/gantt-chart.tsx`:

```tsx
/**
 * The Gantt as a frozen grid.
 *
 * One scroll container on both axes, with the date axis pinned to the top and
 * the label gutter pinned to the left. The container carries no padding: a
 * padded scroller lets `sticky top-0` pin below the padding, and exactly that
 * much scrolled content then shows above the header — which is the sliver this
 * layout was rewritten to remove.
 */
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { StatusIndex } from '../../../shared/model';
import { DAY, type Span, type Timeline } from '../../../shared/schedule';
import type { Bead } from '../../../shared/types';
import type { BarEdit } from '../../lib/bar-drag';
import { GanttAxis, GanttGrid } from './gantt-axis';
import { EpicRow, TaskRow } from './gantt-rows';

export type RoadmapZoom = 'fit' | 'day' | 'week' | 'month';

export const ROADMAP_ZOOMS: readonly RoadmapZoom[] = ['fit', 'day', 'week', 'month'];

/** How wide one day is at each zoom. `fit` is whatever makes the track fill the pane. */
const ZOOM_PX_PER_DAY: Record<Exclude<RoadmapZoom, 'fit'>, number> = {
  day: 48,
  week: 12,
  month: 4,
};

export function pxPerDayFor(zoom: RoadmapZoom, trackPx: number, windowMs: number): number {
  if (zoom !== 'fit') return ZOOM_PX_PER_DAY[zoom];
  const days = Math.max(windowMs / DAY, 1);
  return trackPx > 0 ? trackPx / days : 0;
}

export function GanttChart({
  timeline,
  index,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
  blockedIds,
  gutter,
  zoom,
  onTrackWidth,
  onCommit,
  pendingIds,
}: {
  timeline: Timeline;
  index: StatusIndex;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
  /** Label-gutter width in px, owned by RoadmapView. */
  gutter: number;
  zoom: RoadmapZoom;
  /** Reports the measured track width so the caller can pick tick density. */
  onTrackWidth: (px: number) => void;
  onCommit: (span: Span, edit: BarEdit) => void;
  pendingIds: ReadonlySet<string>;
}): ReactNode {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportPx, setViewportPx] = useState(0);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setViewportPx(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const trackViewportPx = Math.max(viewportPx - gutter, 0);
  const days = Math.max((timeline.end - timeline.start) / DAY, 1);
  // At `fit` the track is exactly the viewport, so no horizontal scrollbar
  // appears; at any other zoom it grows and the grid scrolls under the gutter.
  const trackPx =
    zoom === 'fit' ? trackViewportPx : Math.max(trackViewportPx, ZOOM_PX_PER_DAY[zoom] * days);

  useEffect(() => onTrackWidth(trackPx), [onTrackWidth, trackPx]);

  return (
    <div
      ref={viewportRef}
      className="min-h-0 flex-1 overflow-auto"
      style={{ '--gantt-gutter': `${gutter}px` } as CSSProperties}
    >
      <div style={{ minWidth: `${gutter + trackPx}px` }}>
        <GanttAxis timeline={timeline} />

        <div className="relative">
          <GanttGrid timeline={timeline} />

          <ul className="relative grid">
            {timeline.epics.map((epic) => (
              <Fragment key={epic.group.epic.id}>
                <EpicRow
                  epic={epic}
                  timeline={timeline}
                  collapsed={collapsed.has(epic.group.epic.id)}
                  onToggle={() => onToggle(epic.group.epic.id)}
                  onSelect={onSelect}
                  selectedId={selectedId}
                />
                {!collapsed.has(epic.group.epic.id)
                  ? epic.children.map((span) => (
                      <TaskRow
                        key={span.bead.id}
                        span={span}
                        timeline={timeline}
                        index={index}
                        onSelect={onSelect}
                        selected={span.bead.id === selectedId}
                        blocked={blockedIds.has(span.bead.id)}
                        onCommit={onCommit}
                        pending={pendingIds.has(span.bead.id)}
                      />
                    ))
                  : null}
              </Fragment>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** True when nothing in the set carries a real date — worth telling the user. */
export function hasNoScheduleData(beads: Bead[]): boolean {
  return !beads.some((bead) => bead.due_at || bead.estimated_minutes || bead.started_at);
}
```

- [ ] **Step 4: Write the barrel**

Create `src/webview/components/gantt/index.ts`:

```ts
/**
 * Re-exports so `../components/gantt` keeps resolving after the split.
 *
 * `sortEpicSpans` used to live here; row order is now `shared/roadmap-sort.ts`,
 * which the List shape shares.
 */
export { GanttChart, hasNoScheduleData, pxPerDayFor, ROADMAP_ZOOMS, type RoadmapZoom } from './gantt-chart';
export { GanttLegend } from './gantt-legend';
export { barTitle } from './gantt-bar';
```

- [ ] **Step 5: Delete the old file**

```bash
rm src/webview/components/gantt.tsx
rg "sortEpicSpans" src
```
Expected: `rg` prints nothing. If it prints a hit in `RoadmapView.tsx`, that is Task 12's job — leave the plan's wave order intact and go straight to Task 12.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exactly one class of error, in `RoadmapView.tsx`, for the props `GanttChart` now requires. Task 12 fixes them.

- [ ] **Step 7: Commit** (only if authorised — commit together with Task 12 if you prefer a green tree at every commit)

```bash
git add src/webview/components/gantt src/webview/components/gantt.tsx
git commit -m "refactor(gantt): split into a frozen-grid directory with zoom support"
```

---

## WAVE 4

### Task 12: Wire the Roadmap

**Files:**
- Modify: `src/webview/views/RoadmapView.tsx` (whole file)
- Modify: `src/webview/App.tsx:24-33`, `:41-64`, `:176-189` (three more persisted fields, passed down)

**Interfaces:**
- Consumes everything from Tasks 1, 2, 3, 6, 10, 11.
- Produces: `PersistedState.roadmapSort?`, `.roadmapZoom?`, `.roadmapGutter?`.

- [ ] **Step 1: Add the three persisted fields in `App.tsx`**

Extend `PersistedState`:

```ts
  /** Absent until the user picks one; `timeline` until then. */
  roadmapSort?: RoadmapSort;
  /** Absent until the user zooms; `fit` until then. */
  roadmapZoom?: RoadmapZoom;
  /** Label-gutter width in px. Absent until first dragged. */
  roadmapGutter?: number;
```

Add imports:

```ts
import type { RoadmapSort } from '../shared/roadmap-sort';
import type { RoadmapZoom } from './components/gantt';
```

Add state:

```tsx
const [roadmapSort, setRoadmapSort] = useState<RoadmapSort>(saved?.roadmapSort ?? 'timeline');
const [roadmapZoom, setRoadmapZoom] = useState<RoadmapZoom>(saved?.roadmapZoom ?? 'fit');
const [roadmapGutter, setRoadmapGutter] = useState(saved?.roadmapGutter ?? 224);
```

(224px is today's `w-56`-equivalent midpoint between the old `w-44`/`@xl:w-64` breakpoint pair.)

Add all three to the `persist` payload and its dependency array, and pass them to `<RoadmapView>`:

```tsx
                sort={roadmapSort}
                onSortChange={setRoadmapSort}
                zoom={roadmapZoom}
                onZoomChange={setRoadmapZoom}
                gutter={roadmapGutter}
                onGutterChange={setRoadmapGutter}
```

- [ ] **Step 2: Rewrite `RoadmapView.tsx`**

Replace the whole file with:

```tsx
/**
 * Roadmap: the drill-down tab, in two shapes.
 *
 * Timeline is the default — beads stores start, due, estimate and PIC, so the
 * parent→child hierarchy is a Gantt without inventing any data. List keeps the
 * older card view for when the dates are not the question being asked.
 */
import { CheckCircle2, GanttChartSquare, List as ListIcon, Map as MapIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { StatusIndex, filterBeads, groupByEpic, progressOf, type BeadQuery } from '../../shared/model';
import { sortGroups, sortTimeline, type RoadmapSort } from '../../shared/roadmap-sort';
import { buildTimeline } from '../../shared/schedule';
import { typeStyle, type Bead, type EpicGroup } from '../../shared/types';
import { BeadCard } from '../components/bead-card';
import {
  GanttChart,
  GanttLegend,
  hasNoScheduleData,
  pxPerDayFor,
  type RoadmapZoom,
} from '../components/gantt';
import { EmptyState, ProgressBar, TypeIcon } from '../components/primitives';
import { QuickFilterBar, Select } from '../components/quick-filter-bar';
import { Splitter } from '../components/splitter';
import { useScheduleEdit } from '../hooks/use-schedule-edit';
import { clamp, type Range } from '../lib/drag-resize';
import { hiddenClosedCount, resolveShape, type RoadmapShape } from '../lib/roadmap-shape';
import { cn } from '../lib/utils';

const GUTTER_MIN_PX = 120;
const GUTTER_MAX_SHARE = 0.6;
const GUTTER_DEFAULT_PX = 224;

export function RoadmapView({
  beads,
  index,
  query,
  onQueryChange,
  onSelect,
  selectedId,
  blockedIds,
  showClosed,
  onShowClosedChange,
  shape: chosenShape,
  onShapeChange,
  sort,
  onSortChange,
  zoom,
  onZoomChange,
  gutter,
  onGutterChange,
}: {
  beads: Bead[];
  index: StatusIndex;
  query: BeadQuery;
  onQueryChange: (next: BeadQuery) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
  /**
   * Scoped to this tab. A finished plan is a wall of strikethroughs, so the
   * Roadmap starts without them — while the Board, where "done" is a column
   * you move things into, keeps its own answer.
   */
  showClosed: boolean;
  onShowClosedChange: (next: boolean) => void;
  /** `undefined` until the user picks one; the date range decides until then. */
  shape?: RoadmapShape;
  onShapeChange: (next: RoadmapShape) => void;
  sort: RoadmapSort;
  onSortChange: (next: RoadmapSort) => void;
  zoom: RoadmapZoom;
  onZoomChange: (next: RoadmapZoom) => void;
  gutter: number;
  onGutterChange: (next: number) => void;
}): ReactNode {
  const epics = useMemo(() => beads.filter((bead) => bead.issue_type === 'epic'), [beads]);
  const { pending, commit } = useScheduleEdit();

  // Everything in the filter bar is shared with the other tabs except the
  // closed toggle, which this tab answers for itself.
  const roadmapQuery = useMemo<BeadQuery>(
    () => ({ ...query, includeClosed: showClosed }),
    [query, showClosed],
  );
  const hiddenClosed = useMemo(
    () => hiddenClosedCount(beads, roadmapQuery, index),
    [beads, roadmapQuery, index],
  );

  // Epics themselves are never filtered out by the status filter — an epic
  // whose children all match must still be reachable.
  //
  // The filter decides which child cards are *listed*; it must not decide what
  // the progress rollup divides by, or an epic whose children are all closed
  // reads "0/0 · 0%" the moment the Closed filter is unticked.
  const groups = useMemo(() => {
    const rollups = new Map<string, { done: number; total: number }>();
    for (const group of groupByEpic(beads, index)) {
      rollups.set(group.epic.id, { done: group.doneCount, total: group.totalCount });
    }

    const visible = filterBeads(beads, roadmapQuery, index);
    const keep = new Set(visible.map((bead) => bead.id));
    const withEpics = beads.filter((bead) => keep.has(bead.id) || bead.issue_type === 'epic');

    return groupByEpic(withEpics, index)
      .filter((group) => group.children.length > 0 || keep.has(group.epic.id))
      .map((group) => {
        const rollup = rollups.get(group.epic.id);
        return rollup ? { ...group, doneCount: rollup.done, totalCount: rollup.total } : group;
      });
  }, [beads, roadmapQuery, index]);

  // Measured by the chart, fed back so the tick density matches what is drawn.
  const [trackPx, setTrackPx] = useState(0);

  // The gutter's maximum is a share of the pane, so it has to follow the pane.
  // A ref callback would only fire on mount and leave the range frozen at the
  // width the panel happened to open at.
  const paneRef = useRef<HTMLDivElement>(null);
  const [viewportPx, setViewportPx] = useState(0);

  useEffect(() => {
    const node = paneRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setViewportPx(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // One clock reading per render, so every bar agrees on where "today" is.
  const timeline = useMemo(() => {
    const built = buildTimeline(groups, (bead) => index.isDone(bead.status), Date.now());
    const pxPerDay = pxPerDayFor(zoom, trackPx, built.end - built.start);
    const withTicks = buildTimeline(groups, (bead) => index.isDone(bead.status), built.now, {
      pxPerDay,
    });
    return { ...withTicks, epics: sortTimeline(withTicks.epics, sort) };
  }, [groups, index, sort, trackPx, zoom]);

  const listGroups = useMemo(() => sortGroups(groups, sort), [groups, sort]);

  const gutterRange = useMemo<Range>(
    () => ({ min: GUTTER_MIN_PX, max: Math.round(viewportPx * GUTTER_MAX_SHARE) }),
    [viewportPx],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onTrackWidth = useCallback((px: number) => setTrackPx(px), []);

  const undated = hasNoScheduleData(beads);
  const shape = resolveShape(chosenShape, timeline);

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      {/* One band, not three: the shape, sort and zoom pickers and the
          closed-hidden count all wrap inside the filter row, so nothing is
          pinned right while the selects wrap beneath it. */}
      <div className="border-border border-b px-3 py-2">
        <QuickFilterBar
          beads={beads}
          epics={epics}
          query={roadmapQuery}
          onChange={(next) => {
            // The closed toggle belongs to this tab; everything else is shared.
            onShowClosedChange(next.includeClosed ?? false);
            onQueryChange({ ...next, includeClosed: query.includeClosed });
          }}
          trailing={
            <>
              <Select
                label="Sort"
                value={sort}
                onChange={(value) => onSortChange(value as RoadmapSort)}
                options={[
                  { value: 'timeline', label: 'By date' },
                  { value: 'priority', label: 'By priority' },
                  { value: 'type', label: 'By type' },
                ]}
              />

              {shape === 'timeline' ? (
                <Select
                  label="Zoom"
                  value={zoom}
                  onChange={(value) => onZoomChange(value as RoadmapZoom)}
                  options={[
                    { value: 'fit', label: 'Fit' },
                    { value: 'day', label: 'Days' },
                    { value: 'week', label: 'Weeks' },
                    { value: 'month', label: 'Months' },
                  ]}
                />
              ) : null}

              <div role="group" aria-label="Roadmap shape" className="flex gap-1">
                <ShapeButton
                  active={shape === 'timeline'}
                  onClick={() => onShapeChange('timeline')}
                  icon={<GanttChartSquare aria-hidden="true" className="size-3.5" />}
                  label="Timeline"
                />
                <ShapeButton
                  active={shape === 'list'}
                  onClick={() => onShapeChange('list')}
                  icon={<ListIcon aria-hidden="true" className="size-3.5" />}
                  label="List"
                />
              </div>

              {/* Never a silent filter: the count is on screen and is the control. */}
              {hiddenClosed > 0 ? (
                <button
                  type="button"
                  onClick={() => onShowClosedChange(true)}
                  className="text-fg-muted hover:bg-surface-hover hover:text-fg border-border surface-interactive inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                >
                  <CheckCircle2 aria-hidden="true" className="size-3" />
                  {hiddenClosed} closed hidden — show
                </button>
              ) : null}
            </>
          }
        />
      </div>

      {groups.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <EmptyState
            icon={<MapIcon className="size-10" />}
            title="Nothing matches these filters"
            hint="Clear the filter bar, or tick “Closed” to include finished work."
          />
        </div>
      ) : shape === 'timeline' ? (
        <div ref={paneRef} className="flex min-h-0 flex-1 flex-col">
          {undated ? (
            <p className="text-fg-muted border-border mx-3 mt-2 rounded-md border border-dashed px-2 py-1.5 text-xs">
              No issue carries a due date or an estimate yet, so every bar is a nominal one-day
              block. Add them with <code>bd update &lt;id&gt; --due 2026-09-01 --estimate 120</code>.
            </p>
          ) : null}

          <div className="relative flex min-h-0 flex-1">
            <GanttChart
              timeline={timeline}
              index={index}
              collapsed={collapsed}
              onToggle={toggle}
              onSelect={onSelect}
              selectedId={selectedId}
              blockedIds={blockedIds}
              gutter={clamp(gutter, gutterRange)}
              zoom={zoom}
              onTrackWidth={onTrackWidth}
              onCommit={commit}
              pendingIds={pending}
            />
            {/* Absolutely placed over the grid, so it does not become a third
                column the sticky gutter would have to account for. */}
            <Splitter
              className="absolute inset-y-0 z-40"
              style={{ left: `calc(${clamp(gutter, gutterRange)}px - 3px)` }}
              label="Resize the task name column"
              size={clamp(gutter, gutterRange)}
              range={gutterRange}
              onChange={onGutterChange}
              onReset={() => onGutterChange(clamp(GUTTER_DEFAULT_PX, gutterRange))}
            />
          </div>

          <div className="border-border border-t px-3 py-1.5">
            <GanttLegend />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <ul className="grid gap-2 py-1">
            {listGroups.map((group) => (
              <EpicRow
                key={group.epic.id}
                group={group}
                collapsed={collapsed.has(group.epic.id)}
                onToggle={() => toggle(group.epic.id)}
                onSelect={onSelect}
                selectedId={selectedId}
                blockedIds={blockedIds}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ShapeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'surface-interactive inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs',
        active
          ? 'bg-surface-active text-fg-strong'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EpicRow({
  group,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
  blockedIds,
}: {
  group: EpicGroup;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
}): ReactNode {
  const synthetic = group.epic.id === '__unassigned__';
  const panelId = `epic-panel-${group.epic.id}`;
  const style = typeStyle(group.epic.issue_type);

  return (
    <li
      className="bg-surface border-border type-spine overflow-hidden rounded-lg border"
      style={{ '--type-color': style.color } as CSSProperties}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          onClick={onToggle}
          className="text-fg-muted hover:text-fg shrink-0 cursor-pointer"
        >
          <span aria-hidden="true" className={cn('block transition-transform', collapsed && '-rotate-90')}>
            ▾
          </span>
          <span className="sr-only">
            {collapsed ? 'Expand' : 'Collapse'} {group.epic.title}
          </span>
        </button>

        <TypeIcon type={group.epic.issue_type} className={style.className} />

        <button
          type="button"
          disabled={synthetic}
          onClick={() => onSelect(group.epic.id)}
          className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
        >
          <span className="text-fg-strong block truncate text-sm font-medium">
            {group.epic.title}
          </span>
          {!synthetic ? (
            <span className="text-fg-muted font-mono text-xs">{group.epic.id}</span>
          ) : null}
        </button>

        <div className="flex w-40 shrink-0 flex-col gap-1 @md:w-56">
          <span className="text-fg-muted text-right text-xs tabular-nums">
            {group.doneCount}/{group.totalCount} · {progressOf(group)}%
          </span>
          <ProgressBar
            done={group.doneCount}
            total={group.totalCount}
            label={`${group.epic.title} progress`}
          />
        </div>
      </div>

      {!collapsed ? (
        <ul
          id={panelId}
          className="border-border grid gap-1.5 border-t px-2 py-2 @xl:grid-cols-2 @5xl:grid-cols-3"
        >
          {group.children.length === 0 ? (
            <li className="text-fg-muted px-1 py-2 text-sm">No child issues.</li>
          ) : (
            group.children.map((child) => (
              <li key={child.id}>
                <BeadCard
                  bead={child}
                  blocked={blockedIds.has(child.id)}
                  selected={child.id === selectedId}
                  onSelect={onSelect}
                />
              </li>
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}
```

- [ ] **Step 3: Let `<Splitter>` accept a `style` prop**

The Gantt splitter is absolutely positioned, so `splitter.tsx` needs one more prop. In `src/webview/components/splitter.tsx`, add `style?: CSSProperties` to the props and spread it onto the root `<div style={style}>`, importing `type CSSProperties` from `react`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all clean, whole suite green.

- [ ] **Step 5: Commit** (only if authorised)

```bash
git add src/webview/views/RoadmapView.tsx src/webview/App.tsx src/webview/components/splitter.tsx
git commit -m "feat(roadmap): wire sort, zoom, gutter splitter and bar rescheduling"
```

---

## WAVE 5

### Task 13: Gates, manual verification, review

**Files:** none created; fixes land wherever the reviews point.

- [ ] **Step 1: Full gate**

Run: `npm run verify`
Expected: lint, typecheck, the whole vitest suite, the build and `npm audit --audit-level=low` all pass, with audit reporting 0 vulnerabilities. Paste the audit line into the handoff — do not summarise it.

- [ ] **Step 2: Reproduce the original bug is gone**

Launch the extension host (F5), open the Beads Dashboard on a workspace with enough issues to scroll, go to Roadmap → Timeline.
Check, at a **narrow** panel width and again at a **wide** one, with the detail pane both closed and docked:

- Scroll the rows down. **No sliver of a row appears above the date axis.**
- The filter row is a single band; there is no separate "N closed hidden" stripe and no hole between the selects and the shape toggle when the row wraps.
- Scroll horizontally at `Zoom: Days`. Task names stay put; the date axis scrolls with the bars; the corner cell never lets a row show through.

- [ ] **Step 3: Exercise every new control**

- Sort → By priority, By type, By date: epic rows and child rows both reorder; "No epic" stays last.
- Drag the gutter splitter: names get more room, minimum 120px, maximum 60%. Tab to it, ←/→ move it, Home/End jump to the bounds, double-click resets.
- Zoom → Days/Weeks/Months: gridline labels stay legible and never overlap at any zoom.
- Hover a bar: the right-edge handle appears. Click the bar without moving — **the issue is selected and no toast appears**. Drag the handle a few pixels and release on the same day — **no toast, no bd call**. Drag it several days and release — the toast names the change, the bar dims, then the new snapshot arrives.
- Hover a **closed** bar: no handle.
- Reload the panel: sort, zoom, gutter width and detail width all come back.

Confirm the writes actually landed:
```bash
bd show <id> --json
```

- [ ] **Step 4: Code review**

Run the `/code-review` skill at `high` effort over the branch diff. Apply the findings that hold up; for any you reject, say why in the handoff rather than silently dropping it.

- [ ] **Step 5: Security review**

Run the `/security-review` skill over the branch diff. Pay particular attention to:

- **Argument injection into `bd`.** `setDue` passes a user-influenced string into an argv. Confirm `BdService` spawns without a shell (it should already — check `spawn` options), and that a `date` of `--force` or `; rm -rf .` reaches bd as one literal argument and is rejected by bd, not by us.
- **Router narrowing.** `setEstimate` must reject a non-finite or non-positive `minutes` before it reaches an argv; `setDue` must accept an empty string but nothing exotic.
- **No new dependency.** `npm audit --audit-level=low` reports 0.
- **CSP.** No remote asset, font or CDN script was introduced.

Fix everything the review raises. Re-run `npm run verify` after the fixes.

- [ ] **Step 6: File the follow-up issues**

```bash
bd create --title="Undo action in the dashboard toast" --description="notify() takes no action button, so a bar drag cannot be undone from the toast. Add an optional action to the toast API and wire it to the inverse mutation." --type=feature --priority=3
bd create --title="Bar left-edge editing once bd gains --start" --description="bd update has no --start today, so a bar's start is derived (started_at ?? created_at ?? now) and cannot be dragged. Revisit if beads adds the flag." --type=feature --priority=4
```

- [ ] **Step 7: Update the Velox bookkeeping**

Per `.velox/docs/VELOX-CONTEXT.md` §3.3, in this order: the relevant `M###-ROADMAP.md`, then `.velox/STATUS.md`, then `.velox/INDEX.md` (the `gantt/` directory and the five new `lib`/`hooks` modules are new navigation entries).

- [ ] **Step 8: Hand off**

Report: files changed, the exact `npm run verify` output, which bd issues were closed or created, and — if commits were not authorised — the staged-but-uncommitted state and the proposed commands.

---

## Self-review

**Spec coverage.** §1 layout → T11 (frozen grid, unpadded scroller) + T12 (folded pill, trailing slot) + T6. §2 sorting → T1 + T12. §3 drag infrastructure → T2. §4 resizable gutter → T2 + T11 + T12. §5 zoom → T3 + T11 + T12. §6 detail pane → T9. §7 bar drag → T4 + T5 + T8 + T10. Persisted state → T9 (`detailWidth`) + T12 (`roadmapSort`, `roadmapZoom`, `roadmapGutter`). Testing table → T1, T2, T3, T4, T5. Quality gates → every task's verify step plus T13. Follow-up issues → T13 Step 6.

**Type consistency.** `RoadmapSort` is declared once in `shared/roadmap-sort.ts` and imported by `App.tsx` and `RoadmapView.tsx`. `RoadmapZoom` is declared once in `gantt/gantt-chart.tsx` and re-exported through `gantt/index.ts`. `Range` and `clamp` come only from `webview/lib/drag-resize.ts`. `BarEdit` comes only from `webview/lib/bar-drag.ts`. `GUTTER_CLASS` is exported by `gantt-axis.tsx` and consumed by `gantt-rows.tsx` — one definition of the gutter width, used by the header, the rows and the gridline layer.

**Known open detail for the implementer.** `timeline` in `RoadmapView` builds twice — once to learn the window, once with the resulting `pxPerDay`. That is correct but wasteful. If the second call shows up in a profile, split `buildTimeline` into a window pass and a tick pass rather than caching across renders; do not micro-optimise it speculatively.
