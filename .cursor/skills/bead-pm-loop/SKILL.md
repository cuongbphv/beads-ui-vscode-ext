---
name: bead-pm-loop
description: "Runs the beads board continuously as a project manager would: WIP limits, an estimate-before-claim gate, staleness and scope-creep alarms and board invariants checked before every round, then one round delegated to bead-loop or a batch to bead-fleet, estimate-versus-actual calibration on every close, and a report and forecast on a fixed cadence. Use when the user runs /bead-pm-loop or asks to manage, run, or drive the board continuously like a PM."
disable-model-invocation: true
---
<!-- beads-pm-kit v0.1.0 skill:bead-pm-loop surface:cursor -->

# bead-pm-loop

You are running the board as its PM, one round at a time. **The parameters are the text the
user typed after the command** (`[--fleet N] [--report-every N] [--include-partial] [--dry-run]`).

This command is **policy, not selection**. It never re-implements which bead to take:
that lives in the `bead-loop` skill, and taking one lives in the `bead-take` skill. What
it adds is the part a board needs to stay manageable over many rounds — limits, gates,
cadence, and an explicit refusal to keep going when something needs a person.

**One round ends the turn.** Run the gates, do one unit of work, report, stop. A loop that
tries to be clever across rounds is a loop with a stale picture of the board.

## 0. Division of labour

| Concern | Where it lives |
|---|---|
| classification labels (`auto-ok` / `auto-partial` / `needs-human`) | the `bead-loop` skill §0 — the single source of truth, never copied |
| which bead is next | the `bead-loop` skill §1 |
| implementing one bead | the `bead-take` skill |
| several beads in parallel | the `bead-fleet` skill |
| the size scale and note markers | the `bead-estimate` skill §0 |
| the numbers | `scripts/pm/board.py`, via the `bead-report` skill and the `bead-forecast` skill |

If any of those say something different from this file, they win on their own subject.

## 1. Health gates — before every round

Run all five. Two of them stop the round; three of them get reported and the round continues.

```bash
python3 scripts/pm/board.py report --json > /dev/null && python3 scripts/pm/board.py report
```

1. **WIP limit** *(report and decide)* — at most one `in_progress` bead per assignee, and no
   more than the fleet batch size across the board. Over the limit: finish or re-note what is
   already in flight instead of claiming more. Never claim past the limit to look busy.
2. **Estimate before claim** *(stops the round for that bead)* — the candidate must
   carry exactly one `size:*` label, and it must be `size:L` or smaller. No size → run
   /bead-estimate on that bead inside this round and carry on; sizing costs minutes and
   skipping it costs the forecast. `size:XL` → leave it, append `SPLIT-REQUIRED`, and
   take the next candidate.
3. **Staleness** *(report and decide)* — `bd stale -d 7` plus anything `in_progress` for more
   than 3 days. List them with their assignee and the last marker note from each. Never
   silently reassign or reopen someone else's work.
4. **Scope creep** *(stops the loop)* — when created points have outrun closed points for
   three consecutive 7-day windows, the module prints `SCOPE ALARM`. Stop creating further
   non-bug beads and put the decision to the user: cut scope, extend the date, or accept the
   slip. A loop cannot fix scope growth by running faster.
5. **Board invariants** *(stop)* — the four the module checks: a bead with no epic, a bead with
   no classification label, an epic carrying a size label, a bead carrying two size labels.
   Fix the invariant before working the board; an averaged number over a broken board is worse
   than no number.

## 2. The round itself

- Default: delegate one bead to the `bead-loop` skill and let it delegate to the
  `bead-take` skill. Do not second-guess its pick.
- `--fleet N`: delegate a batch of N `auto-ok` beads to the `bead-fleet` skill instead.
  Use it when the ready queue has several beads with disjoint file footprints — that
  judgement is already written down in the `bead-fleet` skill §1.
- `--dry-run`: run the gates, print what the round would do, write nothing.
- Whatever the mode: no `git push`, no `bd dolt push`. Linear unpushed history is the only
  thing that makes a bad night recoverable.

## 3. Cadence — what happens on which round

- **Every round**: the gates in §1, then the round, then §5.
- **Every close**: compare actual against estimate. Outside [0.5, 2.0] → append a `CALIBRATE`
  note to that bead. This is the feedback loop that makes the next estimate better; skipping it
  turns estimating back into guessing.
- **Every `--report-every N` rounds (default 5) and at the end of the loop**: run
  /bead-report.
- **When an epic's remaining points changed**: run /bead-forecast for that epic, and say
  how the previous snapshot did before writing a new one.
- **Three `CALIBRATE` notes pointing the same way**: one `bd remember` line, so the bias
  survives this session.

## 4. Escalation and stopping

Stop the loop and report — do not work around any of these:

- `NO WORK LEFT` from the `bead-loop` skill: report how many `auto-partial` and
  `needs-human` beads remain **with each one's reason**, never a bare count.
- A gate from §1 marked *stop*.
- A bead that needs a decision rather than an implementation: leave it, name the decision.
- The same bead failing twice: stop taking it, append what you measured, and say what a person
  would have to decide.

Inside the harness's automatic loop mode, stop the loop the way that harness expects and do
not schedule another round.

## 5. End-of-round report

Six lines, every round, so consecutive rounds are comparable:

1. the gates: which passed, which fired, and what you did about each one
2. the bead: id, size, what was measured before and after, the verify command with its real
   exit code
3. the board delta: closed / created / re-noted this round, in points and in count
4. what the round changed about the forecast, if anything
5. what is now waiting on a person, with reasons
6. the files you changed and the commit and push commands you did **not** run
