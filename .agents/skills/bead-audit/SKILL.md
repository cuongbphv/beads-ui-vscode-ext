---
name: bead-audit
description: Use when auditing, reviewing, or verifying the Beads board, checking whether epics are genuinely finished, cleaning stale beads, or reconciling beads against the repository.
---
<!-- beads-pm-kit v0.1.0 skill:bead-audit surface:codex sha256:419c849a6641 -->

# Bead Audit

The scope is the text the user supplies with `$bead-audit` (epic id, label, or a list of
bead ids). Empty means the whole board.

Agents only measure and return evidence. Only the coordinating agent may close or edit a
bead. The repository is the source of truth; every "already done" claim must be
re-measurable.

## Establish the current state

- Run `bd ready`, `bd list --status in_progress`, and `bd show <epic>` for every epic in
  scope. Read notes, closing conditions, and previous measurements.
- Run `git fetch origin` and
  `git rev-list --left-right --count origin/<branch>...HEAD`. Record the HEAD SHA in every
  measurement note.
- For external environments, try one read-only access check before trusting a stale
  "no access" note.

## Measure in parallel

Group beads by front (code, UI, infrastructure, docs) and launch one read-only subagent per
group. Every prompt must include:

- bead ids and instructions to run `bd show`;
- prohibitions against editing files or updating/closing beads;
- `DONE`, `NOT DONE`, or `PARTIAL` per bead, backed by reproducible evidence;
- exact evidence such as file:line, LOC, query and row count, commit SHA, or a test command
  actually run with its result.

Missing reproducible evidence means `NOT DONE`. Verify deployments through real behavior or
symbols, not version strings or digests.

## Settle debt centrally

- `DONE`:
  `bd close <id> --reason "Verified <date> (agent re-measure): <decisive evidence>"`.
- `NOT DONE` or `PARTIAL`:
  `bd update <id> --append-notes "RE-MEASURE <date> (HEAD <sha>): <measurement> — still missing <requirement>"`.
- Fix repository docs that contradict source in the same pass.
- Append useful out-of-scope evidence to the relevant bead.
- Testimony without reproduction is `PARTIAL`, never `DONE`.

## Handoff

Report each closed bead with decisive evidence, each open bead with what remains, and each
epic's progress before and after. Emit self-contained parallel prompts only for independent
work an agent can perform. List decisions and human-only work separately.

Report changed files and suggested commit commands. Never push code or Beads data unless the
user explicitly asks.
