---
name: bead-split
description: Use when splitting a markdown specification, plan, roadmap, or directory of markdown files into Beads epics and classified child tasks.
---
<!-- beads-pm-kit v0.1.0 skill:bead-split surface:codex -->

# Bead Split

Parameters supplied with `$bead-split` are:
`<file.md | directory> [--apply] [--epic <id>] [--section "<heading>"]`.

Dry-run is the default. Without `--apply`, write nothing to the board; print a complete
preview and stop.

## Classification

Read the classification contract in `.agents/skills/bead-loop/SKILL.md` before assigning
labels. Every child task must carry exactly one of `auto-ok`, `auto-partial`, or
`needs-human`, plus a measurable reason in its notes. Epics need no classification label.
Never infer a label from a title.

## Resolve and inspect input

- Accept one `.md`/`.markdown` file or a directory of top-level markdown files sorted by
  name. Do not recurse.
- Print the file list and skipped files before processing.
- Reject missing, empty, or non-markdown paths without guessing a replacement.
- `--epic <id>` attaches tasks to an existing epic.
- `--section "<heading>"` limits splitting to one section.

Count level-two headings before splitting. If there are more than six, or the file resembles
general documentation rather than a work specification, stop and ask the user to choose a
section. With a scoped section, use its top-level bullets as tasks. Otherwise use the first
H1 as the epic and each H2 as one child task. Keep deeper headings, checkboxes, and nested
bullets inside the parent task's description.

Stop on duplicate task titles or when an epic title cannot be determined.

## Measure and plan

For every task, inspect the repository for named files/symbols, reachable tests, CI,
credentials, external environments, costs, and unresolved decisions. Record concrete
evidence, then assign the classification label. Uncertainty means `needs-human`.

Write the graph to `.beads/bead-split-plan.json`, never `/tmp`. Use only fields accepted by
`bd create --graph`: `key`, `title`, `type`, `priority`, `labels`, `description`,
`parent_key`/`parent_id`, and explicit dependency edges.

Always run:

```bash
bd create --graph .beads/bead-split-plan.json --dry-run
```

Also print `title | lane | evidence`, because the command's dry-run does not display labels.

## Apply

Only with `--apply`:

1. Dedupe every title using `bd search "<title>" --status all --json`.
2. Run `bd create --graph .beads/bead-split-plan.json`.
3. Attach notes to every new task with its lane, date, HEAD SHA, evidence, and source
   heading.
4. Verify every child has exactly one classification label and the board's unlabeled count
   did not increase.

Never use `bd create --file`; it silently loses required metadata on the supported Beads
version. This skill creates board tasks only—it does not implement or close them.

Report created and skipped ids, parent epics, lane totals, each `needs-human` reason, changed
files, and suggested next commands. Never push or sync without explicit permission.
