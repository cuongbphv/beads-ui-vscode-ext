---
description: Size beads in points by reference class over closed work, dual-writing the size label and estimated_minutes with the evidence
argument-hint: "<bead-id> | --epic <id> | --backfill [--apply]"
---
<!-- beads-pm-kit v0.1.0 skill:bead-estimate surface:claude sha256:d85afe27800e -->

You are sizing beads. Parameters: **$ARGUMENTS**

**DRY-RUN IS THE DEFAULT for `--epic` and `--backfill`.** Without `--apply`, write nothing:
print the proposal table and stop. A single bead named by id may be written directly.

An estimate is a measurement, not an opinion. Everything below exists to keep it one.

## 0. The size scale and how it is stored

Every active non-epic bead carries exactly one `size:*` label. The label is canonical; the
native `estimated_minutes` field mirrors it so scripts that already hold a `--json` row do
not have to parse strings.

| Label | Points | `-e` minutes | What it means for an agent |
|---|---|---|---|
| `size:XS` | 0.5 | 30 | one file, an obvious change |
| `size:S` | 1 | 60 | small, a pattern that already exists in the repo |
| `size:M` | 3 | 180 | several files, tests have to be written |
| `size:L` | 8 | 480 | the largest unit anyone may claim |
| `size:XL` | 13 | 780 | **not claimable** — a marker that a split is owed |

Write both in one command: `bd update <id> --add-label size:M -e 180`. If the label and the
minutes ever disagree, the label wins and the minutes get fixed — every script derives
points from the label. The minute mapping is a unit convention, not a promise about
duration; what an hour of points really costs is measured, see calibration below.

**Epics are never sized directly.** An epic's size is the sum of its children, open and
closed. This is also what keeps the numbers honest: `bd` copies a parent's labels onto new
children unless `--no-inherit-labels` is passed, so a `size:*` on an epic would leak into
every child and corrupt the rollup. If a sized task later grows children, remove its size
label and size the children instead. An epic carrying a `size:*` label is a stop condition,
exactly like an unclassified bead.

Anything sized `size:XL` must be decomposed before it can be claimed. Splitting a 13 into
real children is the whole point: an estimate that large is a statement that nobody has
understood the work yet.

## Note markers

All of them are appended with `bd update <id> --append-notes`, and they extend the same
grammar the board already uses for `RE-MEASURE`:

- `ESTIMATE <date>: M (3 pt) — ref-class <id>,<id>,<id> median 2.6h (basis:lead); <reason>`
  — written when a bead is first sized.
- `RE-ESTIMATE <date> (HEAD <sha>): S→M — <measured reason>` — written whenever the size
  label changes, in the same command that changes the label and the minutes.
- `CALIBRATE <date>: est M (3 pt), actual 6.8h lead — ratio 2.3x` — written at close when
  actual/estimate falls outside [0.5, 2.0].
- `FORECAST <date>: remaining 21 pt, v=1.4 pt/d, ETA likely 2026-09-06 (opt 09-02 / pes 09-16)`
  — written on an epic by the forecast.
- `SPLIT-REQUIRED <date>: sized > L — must be decomposed before any claim`.

## What "actual" means, and calibration

`actual_hours = closed_at − started_at` when `started_at` is set, and
`closed_at − created_at` (lead time) when it is not. Boards where work is claimed and closed
by agents frequently have no `started_at` at all, so the lead-time fallback is the normal
case, not the exception — tag which one you used (`basis:cycle` or `basis:lead`) in the note,
because lead time silently includes the days a bead sat in the backlog.

Calibrated hours per point = the median of `actual_hours / points` over closed sized beads.
Use it only once at least 10 such beads exist; below that, assume 1 pt ≈ 1 h and say so.
When three or more `CALIBRATE` notes point the same way for the same kind of work, record it
once so future sessions inherit it:

```bash
bd remember "PM calibration: <area> beads run ~<x>x their estimate (n=<k>, <date>)"
```

## The one metadata key

`pm.forecast` on an epic holds the latest forecast snapshot as JSON — `date`,
`remaining_pts`, `velocity_ppd`, `eta_opt`, `eta_likely`, `eta_pes`, `basis`. Written with
`--set-metadata`, read with `bd show <id> --json` or `bd list --metadata-field`. History
lives in the `FORECAST` notes; the metadata holds only the newest, so the next forecast can
report how the last one did. No other `pm.*` key exists — actuals are derivable, and a
board does not need a sprint field to be managed.

## Query hygiene for every metric

- Read the board with `bd list --json -n 0 --include-gates --include-infra --include-templates`.
  Without those flags `bd list` quietly omits gate, infra and template beads: measured on a
  62-bead board, `bd stats` reported 42 closed while `bd list` returned 36. Any percentage
  built on the short list is wrong and looks fine.
- Cross-check the row count against `bd stats --json` and print the delta. A mismatch is a
  warning in the report header, never a silent adjustment.
- Compute in a python heredoc reading `bd` through `subprocess`. Do not redirect the board
  into `/tmp` (Git Bash maps `/tmp` onto `%TEMP%` while Python on Windows reads it as
  `C:\tmp`), and never parse `.beads/issues.jsonl` — it is a passive export, not the board.
- Set `BD_JSON_ENVELOPE=1` when scripting, and read `schema_version` if the output is
  wrapped: bd 2.0 makes the envelope the default.
- Reporting and forecasting read the board. They never `git push` and never `bd dolt push`.

## 1. Resolve the scope

| Parameters | Scope |
|---|---|
| `<bead-id>` | that one bead; write immediately |
| `--epic <id>` | every unclosed non-epic child of that epic that has no `size:*` label |
| `--backfill` | every unclosed non-epic bead on the board with no `size:*` label |
| nothing | run `--backfill` in dry-run and say so |

Read the board once, with the include flags from §0, and keep it in memory. Also pull the
closed beads in the same pass — they are the reference class, and re-querying per bead turns
a backfill into hundreds of subprocess calls.

## 2. Estimate by reference class, in this order

The order matters more than the arithmetic. Steps 1–5 happen **before** you read the bead's
prose, because free text carries other people's guesses and anchoring is the classic way an
estimate goes wrong.

1. **Anchor-free first pass.** Read only `title`, `labels` and `issue_type` from the bead.
   Do not open the description or the notes yet.
2. **Build the reference class.** The scoring is a command, not a judgement call, so two runs
   on the same board agree:

   ```bash
   python3 .beads/pm/board.py refclass                # every unsized open bead
   python3 .beads/pm/board.py refclass --id <bead-id> # just this one
   ```

   It scores each closed bead
   `2 × (shared labels, taxonomy and size excluded) + Jaccard(title tokens) + (1 if same issue_type)`
   and keeps the top 5 **above a similarity floor of 1.5**. That floor matters: same
   `issue_type` alone scores 1.0, and most beads on a board are tasks, so without it the
   "reference class" is a set of coincidences wearing the costume of evidence.
3. **Read the basis column rather than the number.** Three outcomes, and only the first is an
   estimate:
   - `refclass` — 3+ comparables above the floor; the proposed size comes from their median
     actual duration.
   - `pert` — too few comparables. Go to step 5; do not use the table's number.
   - `unusable` — the comparables were closed minutes after they were filed, so their duration
     measures bookkeeping, not work. Also go to step 5.
4. **Sanity-check the proposal** against the comparables the table names. If they are not
   genuinely like this bead, treat it as `pert` no matter what the score said — the tool ranks
   similarity, only you can judge it. Record the comparable ids either way: an estimate whose
   reference class is not written down cannot be argued with later.
5. **PERT fallback**, only when the reference class is too thin: estimate optimistic, most
   likely and pessimistic in points from the bead's own scope signals (how many files it
   names, whether a test can reach the change, whether it depends on anything outside the
   repo), then `E = (O + 4M + P) / 6`, snapped to the scale. Tag the note `basis:pert` so a
   later calibration knows this one was never grounded in history.
6. **Now read the description and the notes.** If the prose reveals scope the size cannot
   cover, move one step up the scale and write down what you found. Moving *down* after
   reading prose is anchoring — only a measurement justifies that.
7. **Stop at XL.** `size:XL` is not claimable: append `SPLIT-REQUIRED` and leave the bead
   unclaimable rather than writing an estimate nobody can act on. Say in the handoff which
   beads need splitting, and with what suggested children.

## 3. Write it

One command per bead, so the label, the minutes and the reason can never drift apart:

```bash
bd update <id> --add-label size:M -e 180 \
  --append-notes "ESTIMATE <date>: M (3 pt) — ref-class <id>,<id>,<id> median 2.6h (basis:lead); <what makes it M>"
```

Re-sizing an already-sized bead removes the old label in the same command:

```bash
bd update <id> --remove-label size:S --add-label size:M -e 180 \
  --append-notes "RE-ESTIMATE <date> (HEAD <sha>): S→M — <the measurement that changed it>"
```

Then verify the two invariants the board now depends on, and report any violation item by
item rather than as a count:

- every unclosed non-epic bead carries **exactly one** `size:*` label;
- **no epic** carries a `size:*` label.

## 4. Calibrate on close

This step is what turns estimating into measuring. It runs from the `bead-pm-loop` skill
after every close, and can be run by hand over a date range:

- Compute `actual_hours` and compare it with `points × calibrated_hours_per_pt`.
- Ratio outside [0.5, 2.0] → append a `CALIBRATE` note to that bead.
- Three or more `CALIBRATE` notes pointing the same way for the same kind of work → one
  `bd remember` line, so the next session starts with the bias already known.

## 5. Report

- A table: `id | current | proposed | basis | ref-class ids | why`.
- The beads that came out `size:XL`, each with the split you suggest.
- On a dry run, the exact `bd update` commands you would run, and nothing written.
- On `--apply`, the invariant check from §3, then the suggested commit command — this
  command writes to the board only, never to git, and never pushes or syncs on its own.
