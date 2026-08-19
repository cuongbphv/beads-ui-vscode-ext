---
description: Split tasks out of a markdown file onto the beads board — one file = one epic + child tasks, each labelled into the right swimlane with evidence
argument-hint: "<file.md | directory> [--apply] [--epic <id>] [--section \"<heading>\"]"
---


# bead-split

You are splitting tasks out of markdown onto the beads board. **The parameters are the text
the user typed after the command** (`<file.md | directory> [--apply] [--epic <id>] [--section "<heading>"]`).

**DRY-RUN IS THE DEFAULT.** Without `--apply`, write absolutely nothing to the board — print
the preview table and stop. This is the step that goes wrong most easily: a wrong label costs
one line to fix during the preview, but becomes silent debt once it is on the board.

## 0. The label rules — not duplicated here

Read **§0 of `bead-loop`** (`.codex/prompts/bead-loop.md`) — it declares itself the single
source of truth for the `auto-ok` / `auto-partial` / `needs-human` rules. Two copies will drift.

Three consequences that apply directly to this command:

- A child task **must** carry exactly one of the three labels. An epic does not need one.
- **Never infer a label from a title.** The label has to come with a measurable reason,
  written into that bead's own notes.
- Cannot measure it → `needs-human`. Unmeasured is not zero.

This repo's board renders those three labels as swimlanes
(`src/webview/lib/board-swimlanes.ts`): a bead missing all three falls into the `unlabeled`
lane, which carries a warning flag. If a split leaves `unlabeled` higher than it started,
this command has failed.

## 1. Resolve the input

- The parameter points at **one file** ending `.md` / `.markdown` → process exactly that file.
- It points at a **directory** → glob `*.md` + `*.markdown`, **not recursively**, sorted by
  name. Print the list of files you will process BEFORE reading them, and say which files you
  are skipping and why.
- A path that does not exist, is empty, or is not markdown → stop and print the path verbatim.
  Do not guess, do not repair the path.
- `--epic <id>` = attach the child tasks to an EXISTING epic instead of creating one; when set,
  ignore the H1.
- `--section "<heading>"` = split only that section (see §2c) and ignore the rest of the file.

## 2. Choose the split mode — measure the file first, do not split immediately

Count the `##` headings before doing anything else. There are **two** modes, and picking the
wrong one is the fastest way to dump garbage onto the board.

### 2a. The "this is documentation, not a spec" guard

STOP and ask the user to scope a section if **either** is true:

- The file has **more than 6** `##` headings, or
- Any `##` matches a familiar documentation section name: Install · Requirements · Settings ·
  Commands · License · Tech stack · Contributing · Development · Related projects · Roadmap ·
  What it does · Design system.

When you stop, print a table: each `##` with the **number of top-level bullets** inside it —
the section that is really a TODO list shows itself immediately. Measured on this repo's own
`README.md`: 13 `##` headings, and splitting it in spec mode would create beads named
`License`, `Tech stack`, and `Related projects`. Garbage on the board costs far more than one
question.

`--section "<heading>"` lets the user scope it up front so you never have to ask.

### 2b. Spec mode (the default — a file written to be split)

- `#` (the first H1) → the **epic**. Title = the H1 text, description = the prose before the
  first `##`. The H1 may be HTML, `<h1 …>…</h1>` — READMEs often use that to centre it; accept
  both forms.
- Each `##` → **one child task**. Title = the H2 text, description = everything up to the next `##`.

### 2c. Section mode (guard 2a fired, or `--section` was given)

- The scoped section → the **epic** (title = the heading text plus the file name, so it is
  distinguishable), unless `--epic` is set.
- **Top-level bullets** (`- ` / `* `) inside that section → **child tasks**. For the shape
  `- **Name** — description (link)`, the title is the bold part and the description is the rest,
  **including the link**.
- Bullets sitting under a bold sub-heading such as `**Planned**` / `**Exploring**`: ask the user
  which group to take; do not merge both — `Exploring` is usually an unsettled direction, and
  splitting it creates fake debt.

### 2d. Rules common to both modes

- `###` and deeper: **keep them inside the parent task's description**, do NOT split them into
  beads. The same goes for `- [ ]` checkboxes and nested bullets — they are the task's
  acceptance criteria, not separate beads.
- Two tasks with the same title in one file → stop and report it: the title-based dedupe in §5
  would be ambiguous.
- A file with no `##` and no bullets → skip that file, say so, and **do not create an empty epic**.
- Cannot determine the epic title (no H1, no `--epic`, no scoped section) → stop and ask. Do not
  use the file name as the epic title without asking.

## 3. Assign labels by MEASURING, one task at a time

For each task, measure inside the repo before concluding anything. Keep the command and its
result to put into the notes:

- Does the file or symbol the task names **exist**? → `rg` / `grep -n`, capture `file:line`.
- Are the closing conditions **reachable with tests in the repo**? → find the matching test and
  run it for real if it is fast; read the **exit code**, never trust `echo OK`.
- Does it need **real CI green / a real environment / credentials / external cost / a decision
  from the user**? → if the task mentions a release or publish, read `.github/workflows/*`.

Then assign: `auto-ok` (closable entirely inside the repo) · `auto-partial` (the code is doable,
the closing bar needs an external resource) · `needs-human` (needs a person).
**Not sure → `needs-human`.**

## 4. Emit a graph plan; do NOT loop `bd create`

Write the plan to `.beads/bead-split-plan.json` — **not to `/tmp`**: Git Bash maps `/tmp` onto
`%TEMP%` while Python on Windows reads `/tmp` as `C:\tmp`, so the write succeeds and then raises
`FileNotFoundError` on the very next line (the full reasoning is in §1 of `bead-loop`).

The schema below is measured on `bd 1.2.2` — unknown fields only produce a **warning and are
then dropped silently**, so use exactly these fields and add nothing:

```json
{
  "nodes": [
    {"key": "e", "title": "<H1>", "type": "epic", "priority": 2, "description": "<intro>"},
    {"key": "t1", "title": "<H2>", "type": "task", "priority": 2,
     "labels": ["auto-ok"], "description": "<the H2 body>", "parent_key": "e"}
  ],
  "edges": [{"from_key": "t2", "to_key": "t1", "type": "blocks"}]
}
```

- A node accepts: `key`, `title`, `type`, `priority`, `labels`, `description`, and either
  `parent_key` (another node in the plan) or `parent_id` (an existing bead — this is what
  `--epic` uses).
- An edge accepts: `from_key` | `from_id`, `to_key` | `to_id`, `type`.
- **`notes`, `acceptance`, `design`, `deps`, `depends_on`, and `blocked_by` are NOT in the
  schema** — passing them earns a warning and then they are lost entirely. Notes happen in §5.
- Only add `edges` when the markdown **states** a dependency order. Never infer one from heading
  order.

## 5. Preview (the default), and only then `--apply`

**Always** run this first:

```bash
bd create --graph .beads/bead-split-plan.json --dry-run
```

Plus your own table: `title | lane | the measurement (file:line / command + result)`.
That table is **mandatory**, not decoration: measured on `bd 1.2.2`, `--dry-run` prints only
`key / type / priority / title` and **does not print labels**. So it confirms the epic–task
structure but confirms NOTHING about the lanes. Your table is the only thing that proves the
lanes are right before anything is written.

Without `--apply` → **stop here** and print the exact command the user needs in order to apply it.

With `--apply`:

1. **Dedupe before writing.** For each title: `bd search "<title>" --status all --json` → if a
   title matches (compare after stripping whitespace), drop that node from the plan and report
   "skipped, already `<id>`". `--status all` is **mandatory**: by default `bd search` excludes
   closed beads, and without it you recreate the very bead that was closed last week.
2. `bd create --graph .beads/bead-split-plan.json` — keep the `key -> id` map it prints.
3. **Attach the notes to each new task** (the graph schema rejects `notes`, as measured):
   ```bash
   bd update <id> --notes "LANE <label> (<date>, HEAD <sha>): <the measured evidence>. Source: <file.md> § <heading>"
   ```
   Skipping this leaves a bead with a label and no reason — which `/bead-loop` is not allowed to
   trust.
4. Take `<sha>` from `git rev-parse --short HEAD`, so the next measurement knows the baseline.

## 6. Handoff

Before claiming anything is done, verify for real — follow a
`verification-before-completion` process (the skill of that name if your environment has
one) — then report:

- A table of the new beads: `id | type | lane | title`, plus the parent epic and the source file.
- How many nodes were skipped as duplicates, with the existing ids.
- A claim backed by a number: `unlabeled` **did not go up** — every child task carries exactly
  one of the three labels.
- The bead count per lane; for `needs-human` beads, **list each one and why** — no bare counts,
  no silence.
- The files you changed plus the suggested commit commands. **Never push or sync on your own**
  (conservative profile).

## Prohibited

- **Never `bd create --file <md>`.** Measured on `bd 1.2.2`: it **silently** ignores `--labels`,
  `--parent`, and `-p` (beads come out P2, with no labels and no parent), it accepts no per-issue
  metadata (everything after a `##` becomes the description verbatim and the type is always
  `task`), and `--dry-run` errors out when combined with `--file`. `--graph` is the only path
  that both assigns labels and parents and offers a preview. Do not "optimise" back to `--file`
  without re-measuring.
- No `bd close`, and no editing code, in this command — it only splits tasks.
- No todo tool and no markdown checkboxes as task tracking.
