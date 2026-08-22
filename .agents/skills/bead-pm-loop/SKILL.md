---
name: bead-pm-loop
description: Use when the user asks to run or manage a Beads board continuously with PM controls such as WIP limits, estimate gates and progress reporting.
---
<!-- beads-pm-kit v0.1.0 skill:bead-pm-loop surface:codex -->

# Bead PM Loop

The parameters are supplied with `$bead-pm-loop` (`--fleet N`, `--report-every N`,
`--include-partial`, `--dry-run`). This skill is policy, not selection: which bead is next
lives in `$bead-loop`, implementing one lives in `$bead-take`, and running several in parallel
lives in `$bead-fleet`. Read `.agents/skills/bead-loop/SKILL.md` for the classification
contract rather than restating it. One round ends the turn.

## Health gates before every round

```bash
python3 .beads/pm/board.py report
```

1. **WIP limit** (report and decide): at most one `in_progress` bead per assignee and no more
   than the fleet batch size across the board. Over the limit, finish or re-note what is in
   flight instead of claiming more.
2. **Estimate before claim** (stops that bead): the candidate needs exactly one `size:*` label
   of `size:L` or smaller. Unsized, run `$bead-estimate` on it inside this round and continue.
   `size:XL`, leave it with a `SPLIT-REQUIRED` note and take the next candidate.
3. **Staleness** (report and decide): `bd stale -d 7` plus anything `in_progress` for over
   three days, listed with assignee and last marker note. Never silently reassign.
4. **Scope creep** (stops the loop): when the module prints `SCOPE ALARM` — created points have
   outrun closed points for three consecutive weeks — stop creating non-bug beads and put the
   decision to the user. A loop cannot fix scope growth by running faster.
5. **Board invariants** (stop): a bead with no epic, a bead with no classification label, an
   epic carrying a size label, a bead with two size labels. Fix the invariant first; an average
   over a broken board is worse than no number.

## The round

Default: delegate one bead to `$bead-loop`, which delegates to `$bead-take`. With `--fleet N`,
delegate a batch of `auto-ok` beads to `$bead-fleet` instead. With `--dry-run`, run the gates,
print what the round would do, write nothing. In every mode: no `git push`, no `bd dolt push`.

## Cadence

Every close, compare actual against estimate and append a `CALIBRATE` note when the ratio falls
outside 0.5 to 2.0 — that feedback is what makes the next estimate better. Every five rounds and
at the end of the loop, run `$bead-report`. When an epic's remaining points change, run
`$bead-forecast` for it and say how the previous snapshot did before writing a new one. Three
`CALIBRATE` notes pointing the same way become one `bd remember` line.

## Stopping

Stop and report, never work around: `NO WORK LEFT` (listing every remaining `auto-partial` and
`needs-human` bead with its reason, never a bare count), any gate marked stop, a bead that needs
a decision rather than an implementation, or the same bead failing twice. Inside the harness's
automatic loop mode, stop the way that harness expects and do not schedule another round.

Close each round with six lines: which gates fired and what you did, the bead with its size and
before/after measurement and the verify command's real exit code, the board delta in points and
count, any change to the forecast, what now waits on a person and why, and the files changed plus
the commit and push commands you did not run.
