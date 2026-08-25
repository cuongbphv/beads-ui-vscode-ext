---
name: bead-loop
description: Use when working through a Beads board one ready, self-workable issue at a time, optionally including partial work or performing a dry run.
---
<!-- beads-pm-kit v0.1.0 skill:bead-loop surface:codex -->

# Bead Loop

Run one round per `$bead-loop` invocation. Parameters may include `--include-partial` and
`--dry-run`. One round handles exactly one bead.

## Classification contract

Every active non-epic bead must carry exactly one of:

- `auto-ok`: every closing condition can be completed and tested inside the repository;
- `auto-partial`: repository work is possible, but final closure requires an external
  resource or measurement;
- `needs-human`: closure requires a person, credentials, external cost, a long soak, a
  third party, or a user decision.

A bead with zero labels is unclassified; a bead with two or three labels is contradictory.
Neither is self-workable. Stop and report any bead whose intersection with the three
classification labels does not contain exactly one item. Never infer a label from the title;
every assigned label needs a measurable reason in the bead notes.

## Select one bead

Use `bd ready --json`, not `bd list`, to obtain blocker-aware candidates. Exclude epics,
assigned issues, and all labels except `auto-ok`. Include `auto-partial` only when
`--include-partial` is present. Do not use `bd ready --label-any`; filter the JSON labels
yourself.

Before selecting, inspect the whole active board with `bd list --all --json` and stop if any
non-epic active bead has anything other than exactly one classification label. Sort
candidates by ascending numeric priority (`P0` first), then ascending id. Print blocked
eligible work separately so "no work" is not confused with "work waiting on a dependency."

`--dry-run` prints the bead that would be selected and performs no claims or writes.

## Work one bead

Follow the `bead-take` skill with the selected id.

Additional loop rules:

1. Never close an `auto-partial` bead. Append a re-measurement note describing completed
   work and the external requirement that remains.
2. Commit code before `bd close`.
3. Never push code or Beads data without explicit user permission.
4. Multiple beads in one round require an explicit user request, one worktree per bead, and
   all Beads writes serialized through the coordinating session.

Create discovered work immediately in Beads with a parent epic, one classification label,
and measurable reasoning. Do not use a todo tool as durable tracking.

## End the round

Report the selected bead and label, changed files, verification command and real result,
whether the bead was closed or re-noted, remaining `auto-ok` work, and suggested next
commands. Then stop; do not take a second bead.
