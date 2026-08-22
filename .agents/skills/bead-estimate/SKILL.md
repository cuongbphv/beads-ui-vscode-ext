---
name: bead-estimate
description: Use when the user asks to estimate, size, or backfill estimates for issues on a Beads board.
---
<!-- beads-pm-kit v0.1.0 skill:bead-estimate surface:codex sha256:74aef53c1c45 -->

# Bead Estimate

The scope is supplied with `$bead-estimate`: a bead id, `--epic <id>`, or `--backfill`.
`--epic` and `--backfill` are dry-run unless `--apply` is given; a single bead id may be
written directly.

## The size scale

Every active non-epic bead carries exactly one `size:*` label, and the native
`estimated_minutes` field mirrors it: `size:XS` 0.5 pt / 30 min, `size:S` 1 pt / 60,
`size:M` 3 pt / 180, `size:L` 8 pt / 480, `size:XL` 13 pt / 780. The label is canonical; if
the two disagree, fix the minutes. `size:XL` is not claimable — it means a split is owed.

Epics are never sized directly; an epic's size is the sum of its children. Beads inherit a
parent's labels unless `--no-inherit-labels` is passed, so a size label on an epic would
corrupt every child's rollup.

## Estimate by reference class

Do these in order; the order is what prevents anchoring.

1. Read only the title, labels and type. Do not open the description or notes yet.
2. Run the scoring rather than eyeballing it: `python3 .beads/pm/board.py refclass` for every
   unsized bead, or `--id <bead>` for one. It weighs shared labels double, then title-token
   overlap, then same type, and keeps matches above a similarity floor of 1.5 — same type alone
   scores 1.0 and means nothing, since most beads are tasks.
3. Read the basis column, not the number. `refclass` means three or more real comparables and
   the proposal stands. `pert` means too few. `unusable` means the comparables were closed
   minutes after being filed, so their duration measures bookkeeping rather than work. Only
   `refclass` is an estimate; the other two go to the PERT step.
4. Sanity-check the named comparables against the bead. If they are not genuinely alike, treat
   it as PERT whatever the score said — the tool ranks similarity, only you can judge it.
5. With fewer than three comparables, use PERT instead: `(O + 4M + P) / 6` in points from
   the bead's own scope signals, tagged `basis:pert`.
6. Only now read the description and notes. New scope moves the estimate up a step; moving
   it down after reading prose is anchoring.
7. Anything that lands on XL gets a `SPLIT-REQUIRED` note instead of an estimate.

## Write and verify

```bash
bd update <id> --add-label size:M -e 180 \
  --append-notes "ESTIMATE <date>: M (3 pt) — ref-class <ids> median 2.6h (basis:lead); <why>"
```

Re-sizing removes the old label in the same command and appends `RE-ESTIMATE <date> (HEAD
<sha>): S→M — <measured reason>`. Then check both invariants and list any violation
individually: exactly one `size:*` per unclosed non-epic bead, and no `size:*` on any epic.

## Query hygiene

Read the board with `bd list --json -n 0 --include-gates --include-infra --include-templates`
— without those flags bd omits gate, infra and template beads and every percentage built on
the result is quietly wrong. Cross-check the count against `bd stats --json`. Compute through
`subprocess`, never by parsing `.beads/issues.jsonl`, and never by redirecting the board into
`/tmp`.

Report a table of `id | current | proposed | basis | ref-class | why`, the beads that need
splitting, and on a dry run the exact commands you did not run. This skill writes to the
board only; never push code or Beads data unless the user explicitly asks.
