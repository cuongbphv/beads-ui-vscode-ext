---
description: Forecast delivery from measured velocity with honest bands, refusing to print a date the history cannot support
argument-hint: "[--epic <id>] [--apply]"
---
<!-- beads-pm-kit v0.1.0 skill:bead-forecast surface:claude -->

You are forecasting delivery from measured history. Scope: **$ARGUMENTS**

A forecast is a measurement with error bars, not a promise. The whole job is to be honest
about the bars — and to refuse to draw them when the history cannot carry them.

## 0. Definitions this command will not bend

- **Velocity** is points closed per calendar day inside a trailing window, counted from the
  size labels on closed beads. Not beads per day, not estimated minutes.
- **Actual duration** is `closed_at − started_at` where `started_at` exists and
  `closed_at − created_at` otherwise. The second one silently includes backlog wait, so the
  basis is always printed alongside the number.
- **Remaining** is the sum of points on unclosed beads. Unsized beads are **never** counted
  as zero and never given a default — they are reported as a risk that widens the bands.
- **The window widens, it does not stretch.** 14 days, then 28, then 56, stopping at the
  first window with 5 or more distinct days on which something closed. A board that closed
  everything in two bursts has 2 days of history, not 14, and dividing by 14 would invent
  velocity out of calendar time.

## 1. Compute

```bash
python3 scripts/pm/board.py forecast                 # every epic
python3 scripts/pm/board.py forecast --epic <id>     # one epic
python3 scripts/pm/board.py report --json            # the same numbers, for your own reasoning
```

Run it from the repository root or with `BEADS_DIR` set. Missing file → the kit is not
installed here; say so instead of reimplementing the measurement.

## 2. The three regimes — and the refusal

| Regime | Sized closes in the window | Output |
|---|---|---|
| `measured` | ≥ 5 | velocity, ETA optimistic (v × 1.25) / likely (v) / pessimistic (v × 0.6) |
| `provisional` | 2–4 | the same three dates, labelled provisional, pessimistic named as the planning date; the band is deliberately wider (v × 0.35) because the sized sample may not represent the unsized closes |
| `withheld` | 0–1 | **no dates at all**, plus the two things that would earn one: size the open beads, close five sized beads |

Once 20 or more sized closes exist, switch the bands from fixed factors to the 20th, 50th and
80th percentile of weekly velocity samples, and say that you did. Below that, percentiles of
four numbers are theatre.

**No Monte Carlo.** With this much history a simulation would put a confidence interval
around a guess and make it look like statistics.

## 3. Name what makes the bands wide

Every forecast ends with the reasons, each one a fact from the board rather than a caveat:

- unsized open beads — they are absent from `remaining`, so the real date is later
- blocked chains — the dates assume the root moves first; name the root
- `needs-human` beads — no agent velocity applies to them at all
- lead-time basis — the actuals include time beads spent waiting, overstating effort
- uncalibrated hours per point — fewer than 10 sized closes means 1 pt ≈ 1 h is assumed

A forecast without this list is a number pretending to be a plan.

## 4. Record the snapshot (only with `--apply`)

The module prints the exact commands. They are the only writes this command makes:

```bash
bd update <epic> --set-metadata pm.forecast='{"date":"…","remaining_pts":…,"velocity_ppd":…,"eta_opt":"…","eta_likely":"…","eta_pes":"…","basis":"measured"}' \
  --append-notes "FORECAST <date>: remaining <n> pt, v=<x> pt/d, ETA likely <d> (opt <d> / pes <d>, <regime>)"
```

`pm.forecast` holds only the newest snapshot; the history lives in the `FORECAST` notes. That
split is what makes §5 possible.

## 5. Calibrate the last forecast before making a new one

`forecast` prints a **HOW THE LAST FORECAST DID** section before the new numbers, because a
forecast nobody scored is a ritual. It fetches the previous snapshot per epic — `metadata` is
absent from `bd list --json`, and bd stores `pm.forecast` as a JSON *string* inside the
metadata object, so it has to be parsed twice — and reports:

- how many points moved since that snapshot, closed or added;
- whether the epic is on track against the likely date, past it but inside the pessimistic, or
  past the pessimistic and by how many days;
- whether velocity moved more than 2× between runs.

Your job is the part the arithmetic cannot do: when a date slipped, say **which** of the §3
reasons turned out to be the one that mattered. When velocity jumped, name the beads that
caused it — a batch of tiny beads or one huge one is a change in what the board holds, not a
trend.

When the same bias shows up three runs in a row, record it once so later sessions inherit it:

```bash
bd remember "PM forecast bias: <what> ran <x>× the estimate (n=<k>, <date>)"
```

## 6. Handoff

Report the table, the reasons, the calibration of the previous forecast, and — on a dry run —
the snapshot commands you did not execute. This command writes board metadata and notes only:
never git, never `bd dolt push`.
