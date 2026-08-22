---
name: bead-report
description: "Produces a fixed-section PM progress report from the beads board: completion percentage by count and by points, per-epic progress, blocked chains grouped by their root, staleness and scope growth, velocity with the confidence regime that decides whether a date may be shown at all. Read-only. Use when the user runs /bead-report or asks for board status, progress, completion rate, a PM report, or how the project is tracking."
disable-model-invocation: true
---
<!-- beads-pm-kit v0.1.0 skill:bead-report surface:cursor -->

# bead-report

You are the PM reporting on the board. **The scope is the text the user typed after the
command** (`[epic-id] [--json]`). Empty = the whole board.

**This command changes nothing.** It reads the board, computes, prints. It does not claim,
close, label, commit or push. If a number looks wrong, the fix is a measurement, not an edit
made while reporting.

## 0. The report contract

Every run must be comparable with the last one, so the structure is fixed:

- The six section keys — `BOARD`, `COMPLETION`, `FLOW`, `VELOCITY`, `RISKS/ASKS`, `NEXT` —
  never change name or order, and a section with nothing to say prints `— none` rather than
  disappearing.
- Keys and labels stay in English; write the surrounding prose in whatever language the user
  is writing in.
- No bare counts. "5 blocked" is not a report; "5 blocked behind `<id>`, which is `auto-ok`
  and unclaimed" is. Every number that names beads lists them, or names the command that
  does.
- Never round a percentage into a story. If the points figure excludes unsized beads — it
  always does — say how many it excluded on the same line.

## 1. Measure

The arithmetic lives in one installed module so the report and the forecast cannot disagree
about what a point or a percentage means:

```bash
python3 .beads/pm/board.py report          # the full text report
python3 .beads/pm/board.py report --json   # the same numbers, machine-readable
```

Run it from the repository root, or with `BEADS_DIR` pointing at `.beads` — it shells out to
`bd`, and `bd` resolves its workspace from the working directory.

If the file is missing, the kit was never installed here: say so and stop, rather than
improvising a second implementation of the same measurement. `bd-kit install --into .` puts
it back; `bd-kit doctor --into .` says what else is missing.

What the module does on your behalf, and why each one is not optional:

- Reads the board with `--include-gates --include-infra --include-templates`, then prints the
  `bd list` versus `bd stats` delta. Without those flags bd silently omits three issue types.
- Takes blocked beads from `bd blocked`, not from the board rows: `bd list --json` carries no
  `is_blocked` field and leaves blocked beads at status `open`. Measured on a real board, a
  report built from `bd list` alone said zero blocked while five were blocked.
- Groups blocked beads by the **root** bead that gates them, because the root is the one
  worth working next.
- Refuses to print a date when the sized history cannot support one. See §3.
- Checks four board invariants and lists every violation: beads with no epic, beads with no
  classification label, epics carrying a size label, beads carrying two size labels.

## 2. Read the numbers like a PM, not like a dashboard

Look for these before writing a word of prose:

- **Completion by count far ahead of completion by points** means the easy beads went first.
  The remaining work is heavier than the percentage suggests; say so.
- **A long blocked chain behind one root** is the single highest-leverage item on the board,
  whatever its priority field says.
- **`created` outrunning `closed` for three windows** is scope growth, not slow delivery, and
  the fix is a decision, not more velocity. The module raises `SCOPE ALARM` for exactly this.
- **A `needs-human` queue with stale reasons** is the PM's own debt: each of those beads is
  waiting on a person, and the report is where that becomes visible with its reason attached.
- **An epic at 0/0 points** is not at 0% progress — it is unmeasured. Never present unsized
  work as though it were unstarted.

## 3. What may and may not be forecast

The module classifies its own velocity, and the report repeats the classification verbatim:

| Regime | Sized closes in the window | What the report may say |
|---|---|---|
| `measured` | ≥ 5 | velocity, and optimistic / likely / pessimistic dates |
| `provisional` | 2–4 | the same dates, labelled provisional, with the **pessimistic** date named as the planning date |
| `withheld` | 0–1 | no date at all, plus what it would take to earn one |

Do not "help" by producing a date the regime withholds. A confident wrong date is the most
expensive thing this report can emit.

## 4. NEXT — three actions, with their commands

Close the report with at most three concrete next actions, each as a command the user could
paste, ordered by leverage rather than by priority field. Typical shapes:

- the root of the longest blocked chain → `/bead-take <root-id>`
- unsized work blocking every forecast → `/bead-estimate --backfill`
- a scope alarm → the decision you need from the user, stated as a question
- a full queue of ready `auto-ok` beads → `/bead-fleet --batch 4`

Then hand off: the report itself, the files you did not change (none), and the commands you
did not run. This command never pushes and never syncs.
