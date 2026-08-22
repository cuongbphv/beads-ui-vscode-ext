---
name: bead-forecast
description: Use when the user asks when work will finish, for an ETA, velocity, or a delivery forecast from a Beads board.
---
<!-- beads-pm-kit v0.1.0 skill:bead-forecast surface:codex sha256:08514d83a0e9 -->

# Bead Forecast

The optional scope is supplied with `$bead-forecast` (`--epic <id>`, `--apply`). Empty means
every epic. A forecast is a measurement with error bars, and this skill refuses to draw bars
the history cannot carry.

## Definitions

Velocity is points closed per calendar day in a trailing window, read from size labels on
closed beads. Actual duration is `closed_at - started_at`, or `closed_at - created_at` when
`started_at` is empty — the second includes backlog wait, so always print which basis was
used. Remaining is the sum of points on unclosed beads; unsized beads are never counted as
zero and never defaulted, they are reported as a risk. The window widens 14 → 28 → 56 days
and stops at the first one with five or more distinct closing days, because dividing a
two-day burst by fourteen invents velocity out of calendar time.

## Compute

```bash
python3 .beads/pm/board.py forecast              # every epic
python3 .beads/pm/board.py forecast --epic <id>  # one epic
```

Run from the repository root or set `BEADS_DIR`. If the module is missing the kit is not
installed here; say so instead of reimplementing it.

## Regimes

`measured` (five or more sized closes) prints velocity plus optimistic, likely and
pessimistic dates. `provisional` (two to four) prints the same dates, labels them
provisional, widens the pessimistic band and names it as the planning date. `withheld` (fewer
than two) prints no date at all and states what would earn one: size the open beads, then
close five sized beads. Above twenty sized closes, switch to the 20th, 50th and 80th
percentile of weekly velocity and say so. No Monte Carlo — with this much history it would
dress a guess as statistics.

## Always name what widens the bands

Unsized open beads, which are absent from `remaining` so the real date is later; blocked
chains, naming the root the dates assume moves first; `needs-human` beads, to which no agent
velocity applies; a lead-time basis that overstates effort; and an uncalibrated hours-per-point
assumption. A forecast without these is a number pretending to be a plan.

## Record and calibrate

`forecast` prints a HOW THE LAST FORECAST DID section before the new numbers: points moved
since the last snapshot, whether the epic is on track against the likely date or past the
pessimistic one and by how many days, and whether velocity moved more than twice. It fetches
that per epic because `metadata` is absent from `bd list --json` and bd stores `pm.forecast` as
a JSON string inside the metadata object, needing two parses.

Your part is what the arithmetic cannot do: when a date slipped, name which listed reason
mattered; when velocity jumped, name the beads that caused it. With `--apply`, run the snapshot
commands the module prints — `--set-metadata pm.forecast='…'` plus a `FORECAST <date>` note. The
metadata holds only the newest snapshot; history lives in the notes. When the same bias appears
three runs running, record it once with `bd remember`.

This skill writes board metadata and notes only. Never push code or Beads data unless the
user explicitly asks.
