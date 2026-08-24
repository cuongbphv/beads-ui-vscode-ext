# Molecule / wisp / gate JSON fixtures (bd 1.2.2)

Real, unedited `--json` output captured on 2026-08-24 from
`bd version 1.2.2 (6c124203e: HEAD@6c124203e771)` on Windows 11.
Bead: `beads-ui-vscode-ext-8eo.1`.

## How they were generated

In a throwaway scratch project (`bd init` in a temp dir, prefix
`bd-mol-fixtures-scratch` — never this repo's board):

1. Authored a minimal TOML formula `fixdemo` in `.beads/formulas/` — 4 steps
   (`design` → parallel `impl-a`/`impl-b` → `review`), one required var `name`.
2. `bd cook fixdemo --persist` (proto `fixdemo`, "template" label).
3. `bd mol pour fixdemo --var name=auth` → root `...-mol-yh9` + 4 step issues.
4. `bd mol wisp fixdemo --var name=healthcheck` → root `...-wisp-0o9` (+4 steps).
5. Progressed steps so states differ: claimed + closed `design`
   (`...-mol-7ps`), claimed `impl-a` (`...-mol-25d`, left in_progress).
6. Created three gates: `bd gate create --type=human --blocks <review>`,
   `--type=timer --timeout=2h --blocks <impl-b>`,
   `--type=gh:pr --await-id=42 --blocks <impl-a>`; later resolved the gh:pr
   gate (`bd gate resolve`) for the resolved-gate shape.
7. For a populated `mol stale`: created an **epic** with one child and closed
   the child (see the stale findings below for why a molecule doesn't work).

Every command exited 0. Files are byte-for-byte redirected stdout (UTF-8, no BOM).

## Fixture files

| File | Command |
|------|---------|
| `list-type-molecule.json` | `bd list --type molecule --json` |
| `list-type-molecule-include-templates.json` | `bd list --type molecule --include-templates --json` |
| `mol-show-parallel.json` | `bd mol show <mol-root> --parallel --json` |
| `mol-progress.json` | `bd mol progress <mol-root> --json` |
| `mol-current.json` | `bd mol current --json` |
| `wisp-list.json` | `bd mol wisp list --json` |
| `mol-stale.json` | `bd mol stale --json` (populated via the epic) |
| `gate-list.json` | `bd gate list --json` (3 open gates) |
| `gate-list-all-with-resolved.json` | `bd gate list --all --json` (incl. resolved gh:pr gate) |
| `gate-show-human.json` / `gate-show-timer.json` / `gate-show-ghpr.json` | `bd gate show <gate-id> --json` |
| `list-all.json` | `bd list --all --json` (watermark question) |
| `list-watermark.json` | `bd list --all --sort updated --limit 1 --json` |

## Previously-unverified questions — measured answers

Every item below was flagged `[Unverified]` in the design plan
(`t-m-hi-u-...ae51903e778dc1210.md`) and is now settled by measurement.

### 1. `bd mol progress <id> --json` shape

Top-level object (not array):
`molecule_id`, `molecule_title`, `total`, `completed`, `in_progress`,
`percent` (integer 0–100), `current_step_id`, `schema_version`.
**No rate / ETA fields were emitted** in this capture (help text advertises
them; they are absent here — treat as optional/omitempty). Field names are
snake_case; the plan's `currentStepTitle` does not exist — only
`current_step_id`.

### 2. `bd mol show <id> --parallel --json` shape

Object: `root` (issue row), `issues` (all rows incl. root), `dependencies`
(rows `{issue_id, depends_on_id, type: "parent-child"|"blocks", created_at,
created_by, metadata}`), `bonded_from: null`, `is_compound: false`,
`variables: null`, `schema_version`, and `parallel`:

- `parallel.molecule_id`, `parallel.total_steps`, `parallel.ready_steps`
- `parallel.parallel_groups`: map of group name (`"group-1"`) → array of
  step ids. Note: the ROOT id appears inside the group too.
- `parallel.steps`: map keyed by step id →
  `{step_id, status, is_ready, parallel_group ("" when none), blocked_by,
  blocks, can_parallel (array or null)}`.
- **Gate deps do NOT appear in `blocked_by`** and do not flip `is_ready`:
  `impl-b` had an open timer gate yet showed `blocked_by: [], is_ready: true`.
  `blocked_by`/`blocks` only reflect sibling step ordering.

### 3. `bd mol current --json` shape

ARRAY of per-molecule objects:
`{molecule_id, molecule_title, current_step (issue row), next_step (issue
row), steps: [{issue, status, is_current}], completed, total}`.
Observed step `status` values: `done`, `ready`, `current`, `pending`.
`blocked` was NOT observed — a step blocked only by an open gate was
reported `ready` (gates are invisible to mol step-state too), and a step
waiting on open sibling steps was `pending`. `total` = 4 (steps only, root
excluded), while `mol show` `total_steps` = 5 (root included).

### 4. Gate field names (`await_type` / `await_id` / `timeout` / `waiters`)

- `bd gate list --json` → ARRAY of issue rows (`issue_type: "gate"`), each
  with `await_type` always; `await_id` (string, e.g. `"42"`) only for
  gh:pr; `timeout` only for timer gates — a **number in Go nanoseconds**
  (`7200000000000` = 2h). Human gates carry neither.
- `bd gate show <id> --json` → single object, same fields plus
  `schema_version`. **There is NO `waiters` field in any JSON output**, and
  even text `bd gate show` prints no waiter list on 1.2.2 — the closest
  proxy is `dependent_count` on `bd list --type gate --json` rows (the
  blocked issue carries the gate in its own `dependencies` array as a
  `"blocks"` dep). The plan's `BdGate.waiters?: string[]` has no data source.
- Resolved gate (`gate-list-all-with-resolved.json`): `status: "closed"` +
  `closed_at`; `bd gate list` without `--all` drops it.

### 5. `mol_type` / `wisp_type` field names on issue rows

**Neither field exists in any captured JSON.** Molecule roots are plain
issue rows with `issue_type: "molecule"`; wisp rows expose the issue type
under the key `type` (`"molecule"` for the wisp root, `"task"` for steps)
inside `wisp list`, and carry no `wisp_type`/`mol_type`/ephemeral marker.
The `--mol-type`/`--wisp-type` list filters exist as flags, but 1.2.2 does
not emit those attributes in JSON. Do not add `mol_type`/`wisp_type` to the
`Bead` type based on JSON — they are unavailable.

### 6. `bd mol wisp list --json` shape

`{count, schema_version, wisps: [...]}` — includes root AND all step issues
(5 rows for one 4-step wisp). Row fields: `id`, `title`, `status`,
`priority`, `type`, `created_at`, `updated_at`. No TTL fields.

### 7. Wisp TTLs

**The CLI exposes no per-wisp-type TTLs.** The roadmap-brief values
(heartbeat/ping 6h, patrol 24h, recovery/error/escalation 7d) appear nowhere
in bd 1.2.2 help or JSON. The only time-based knob is `bd mol wisp gc --age`
(default `"1h"` abandonment threshold, wisps not updated in that window and
not closed). UI must treat TTL as unknown/heuristic, not CLI-sourced.

### 8. Watermark question: do mol roots / wisps show in plain `bd list --all --json`?

Measured with 1 poured molecule (5 issues), 1 wisp (5 issues), 1 proto and
3 gates in the DB — `list-all.json` contains EXACTLY the 5 persistent
molecule issues (root + 4 steps):

- **Molecule roots and their steps: YES** — they appear (root has
  `issue_type: "molecule"`, steps are ordinary `task` rows with
  `parent` + `dependencies`). Watermark-based refresh sees poured-mol
  writes.
- **Wisps: NO** — ephemeral issues are absent from `bd list --all --json`
  entirely (even with `--include-templates`), so wisp writes CANNOT move a
  `bd list --sort updated --limit 1` watermark. Wisp staleness must be
  bounded by forced resync or a tab-local refetch interval.
- **Gates: NO** — `issue_type: "gate"` rows are also excluded from plain
  `bd list --all --json` (`list-watermark.json` proves it: top row by
  `updated` is a task from 15:07:31 although gates were written at
  15:07:46–47). Gate create/resolve does not move the watermark either;
  gates are only visible via `bd gate list` / `bd list --type gate`.
- **Templates: excluded by default**; `--include-templates` adds the proto
  row with `labels: ["template"]` and `is_template: true`.

### 9. `--include-templates` difference

`list-type-molecule.json` has 1 row (the poured root);
`list-type-molecule-include-templates.json` has 2 — the extra proto row is
identical in shape plus `labels: ["template"]` and `is_template: true`, and
its `id` is the bare formula name (`fixdemo`, no project prefix).

### 10. `bd mol stale --json` semantics (surprise finding)

- Populated shape: `{blocking_count, total_count, schema_version,
  stale_molecules: [{id, title, total_children, closed_children,
  blocking_count}]}`; empty is `stale_molecules: null` (not `[]`).
- On 1.2.2 stale detection matches its help text — "epics with children":
  it flags **epic-type roots** that are complete-but-open. A poured
  molecule root did NOT trigger it, even reopened with all children closed
  (bd auto-closes a completed molecule root: closing the last child printed
  `✓ Auto-closed completed molecule ...`). The populated fixture therefore
  comes from an epic; expect `stale_molecules: null` in molecule-only
  projects.

### 11. Misc pinned facts

- Poured step ids share the project hash namespace (`...-mol-25d`), NOT
  dotted child ids; wisp steps likewise (`...-wisp-421`). (Manually created
  epic children DO get dotted ids: `...-jhl.1`.)
- The gate is attached as a `"blocks"` dependency ON the blocked issue
  (`dependencies[]` of the step, `depends_on_id: <gate-id>`), so open-gate
  detection per step = step.dependencies ∋ gate id with gate status open.
- `bd cook --persist` output/proto id = bare formula name; pour warns
  nothing on reuse; timestamps inside `dependencies[].created_at` are local
  +07:00 wall-clock stored as `Z` (off by 7h vs the issue rows' true UTC) —
  do not trust dep timestamps for ordering against issue timestamps.
