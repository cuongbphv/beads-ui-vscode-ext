---
name: bead-report
description: Use when the user asks for board status, progress, completion rate, or a PM report on a Beads board.
---
<!-- beads-pm-kit v0.1.0 skill:bead-report surface:codex -->

# Bead Report

The optional scope is supplied with `$bead-report` (an epic id, or `--json`). Empty means the
whole board. This skill reads and prints; it never claims, closes, labels, commits or pushes.

## Measure with the installed module

```bash
python3 scripts/pm/board.py report          # full text report
python3 scripts/pm/board.py report --json   # same numbers, machine-readable
```

Run it from the repository root, or set `BEADS_DIR`, because `bd` resolves its workspace from
the working directory. If the file is missing the kit was never installed here — say so and
stop rather than writing a second implementation of the same measurement.

The module reads the board with `--include-gates --include-infra --include-templates` and
prints the `bd list` versus `bd stats` delta, takes blocked beads from `bd blocked` because
`bd list --json` has no `is_blocked` field and leaves them at status `open`, groups blocked
beads under the root bead that gates them, and lists violations of four invariants: beads with
no epic, beads with no classification label, epics carrying a size label, and beads carrying
two size labels.

## Report contract

Six sections, always in this order and never renamed: `BOARD`, `COMPLETION`, `FLOW`,
`VELOCITY`, `RISKS/ASKS`, `NEXT`. A section with nothing to say prints `— none`. Keys stay in
English; write the prose in the user's language. No bare counts — name the beads or name the
command that lists them. When the points figure excludes unsized beads, say how many on the
same line.

## Read the numbers like a PM

Completion by count far ahead of completion by points means the easy work went first and what
remains is heavier than the percentage suggests. A long blocked chain behind one root is the
highest-leverage item on the board regardless of priority fields. Created points outrunning
closed points for three windows is scope growth, and the fix is a decision rather than more
velocity. An epic with no points is unmeasured, not at zero percent.

## Forecast regimes

The module labels its own velocity and the report repeats that label: `measured` (five or more
sized closes) may state dates; `provisional` (two to four) states them as provisional and names
the pessimistic date as the planning date; `withheld` (fewer than two) states no date at all
and says what would earn one. Never supply a date the regime withholds.

Close with at most three next actions, each a command the user could paste, ordered by
leverage: the root of the longest blocked chain, `$bead-estimate --backfill` when unsized work
is blocking the forecast, a scope decision stated as a question, or `$bead-fleet` when the
ready queue is full. Never push code or Beads data unless the user explicitly asks.
