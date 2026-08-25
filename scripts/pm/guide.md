<!-- beads-pm-kit v0.1.0 skill:guide-en surface:doc -->

# Working the loop

[Tiếng Việt](guide.vi.md) · [简体中文](guide.zh-cn.md)

Nine skills, one cycle. You write a spec, the board fills up, the work gets done, and the board
tells you where you stand and when it will land. Then you write the next spec and go round again.

```
       a spec in markdown
                │
                ▼
         bead-split ──────────► epic + children on the board
                │
                ▼
        bead-estimate ────────► every child carries a size
                │
                ▼
        bead-pm-loop ─────────► gates, then one round of work
           │      │              (bead-loop → bead-take, or bead-fleet)
           │      └───────────► bead-report    where we stand
           │                    bead-forecast  when it lands
           ▼
        bead-audit ───────────► is "done" actually done?
                │
                └─────────────► new work found → back to bead-split
```

Every skill in that diagram is named the same way on every harness. In Claude Code and Cursor
you type `/bead-report`; in Codex it is `$bead-report`. Nothing else changes.

If you only remember one thing: **the loop is allowed to stop you.** Half of what these skills do
is refuse to continue when the board is in a state where continuing would produce a confident
wrong answer. When one of them stops, that is the skill working, not failing.

## Before the first round

You need the `bd` CLI, a board, and the kit installed. `doctor` tells you which of the three is
missing and prints the fix, so run it first and read what it says:

```bash
cd ~/Projects/beads-pm-kit
bin/bd-kit doctor  --into ~/Projects/my-project
bin/bd-kit install --into ~/Projects/my-project
bin/bd-kit doctor  --into ~/Projects/my-project   # again: should end in 0 failures
```

`install` refuses to write anything if `bd` is not on PATH or the project has no `.beads`
directory — installing skills into a repo that cannot run them just leaves instructions nobody
can follow. It prints the install commands and `bd init` instead. `--force` overrides that if you
know what you are doing.

Two of the installed files matter enough to know by name. `.beads/PRIME.md` overrides `bd prime`,
which is what carries the label and size conventions into every session on every harness whether
or not a skill happens to be loaded. `scripts/pm/board.py` is where the numbers come from — both
`bead-report` and `bead-forecast` call it, which is the only reason they cannot disagree with each
other.

## 1. Fill the board — `bead-split`

You have a spec, a roadmap, or a plan sitting in a markdown file. This turns it into one epic plus
its children, and classifies each child by whether an agent can finish it.

```
/bead-split docs/plan.md                          # preview, writes nothing
/bead-split docs/plan.md --section "Phase 2"       # just one heading
/bead-split docs/plan.md --apply                  # actually create them
```

It runs as a preview by default, and you should look at the preview. A wrong label costs one line
to fix here and becomes silent debt the moment it is on the board. If the file is documentation
rather than a spec, the skill stops and asks instead of splitting a README into fake tasks.

Each child gets exactly one classification label, and this is the contract the whole loop rests
on:

| Label | What it means | What an agent may do |
|---|---|---|
| `auto-ok` | everything needed to close it is code and tests in this repo | all of it, including closing the bead |
| `auto-partial` | the code is doable here, but closing needs something outside — real CI, a real environment | write the code, then stop and leave a note; **not** close it |
| `needs-human` | closing needs a person: credentials, a cost, a third party, a decision | leave it alone |

Anything that cannot be measured is `needs-human`. Never guess a label from a title — an
unmeasured bead is not a small bead.

## 2. Make it measurable — `bead-estimate`

A bead with no size is invisible to every later number. This is the step that stops your progress
report from being a lie of omission.

```
/bead-estimate --backfill                # preview sizes for everything unsized
/bead-estimate --backfill --apply        # write them
/bead-estimate beads-abc123              # one bead, written directly
/bead-estimate --epic beads-xyz789       # one epic's children
```

Sizes are points, stored as a label so you can see them on the board, and mirrored into `bd`'s own
`estimated_minutes` so scripts do not have to parse strings:

`size:XS` 0.5 pt · `size:S` 1 pt · `size:M` 3 pt · `size:L` 8 pt · `size:XL` 13 pt

`size:L` is the largest thing anyone may claim. `size:XL` is not an estimate, it is a note saying
nobody has understood this work yet — the skill refuses to make it claimable and tells you to split
it. Epics are never sized directly; an epic's size is the sum of its children. That is partly a
principle and partly self-defence: `bd` copies a parent's labels onto new children, so one size
label on an epic would quietly corrupt every rollup underneath it.

The estimate itself comes from history, not from feel. The skill reads only the title, labels and
type first, on purpose, because descriptions contain other people's guesses and a number you have
already seen is very hard to un-see. Then it scores closed beads for similarity and prices the new
one off how long those actually took:

```bash
python3 scripts/pm/board.py refclass                 # every unsized bead
python3 scripts/pm/board.py refclass --id beads-abc  # just one
```

Read the `basis` column, not the number. `refclass` means it found three or more genuinely similar
closed beads and the proposal stands. `pert` means it did not, so the estimate has to come from the
bead's own scope. `unusable` means the only matches were beads that got closed minutes after they
were filed, so their duration measures bookkeeping rather than work.

That last one is worth dwelling on, because it happened on the first real board this was run
against: seventeen unsized beads all came back `size:XS` with confident medians, off comparables
that matched on nothing but issue type. A reference class of coincidences is worse than admitting
there is none, so there is now a similarity floor and a plausibility floor, and the tool says "no
usable reference class" instead of inventing one.

## 3. Do the work — `bead-pm-loop`

This is the round you actually run, over and over.

```
/bead-pm-loop                      # one bead, with the gates
/bead-pm-loop --fleet 4            # four independent beads in parallel instead
/bead-pm-loop --dry-run            # run the gates, do nothing
/bead-pm-loop --report-every 3     # report every third round instead of every fifth
```

It does not decide which bead is next — `bead-loop` does that, and `bead-take` does the work in a
dedicated git worktree. What `bead-pm-loop` adds is everything a board needs to stay manageable
across many rounds, and it checks all of it before each round:

- **WIP limit.** One in-progress bead per assignee. Over the limit, finish what is in flight
  instead of claiming more to look busy.
- **Estimate before claim.** The candidate needs exactly one size label, `size:L` or smaller. No
  size means it gets sized inside this round rather than skipped — sizing costs minutes, and
  skipping it costs every forecast afterwards.
- **Staleness.** Anything untouched for seven days, or in progress for three, gets listed with its
  assignee. It is never silently reassigned.
- **Scope creep.** If created points have outrun closed points three weeks running, the loop stops
  and asks you to decide: cut scope, move the date, or accept the slip. A loop cannot fix scope
  growth by running faster, and pretending otherwise is how a project dies quietly.
- **Board invariants.** A bead with no epic, a bead with no classification label, an epic carrying
  a size label, a bead carrying two. These stop the round, because a number averaged over a broken
  board is worse than no number.

You can run the pieces directly when you want to. `/bead-take <id>` for one specific bead,
`/bead-loop` for one round without the gates, `/bead-fleet --batch 4` for a parallel batch. Use
`bead-fleet` when several ready `auto-ok` beads touch different files; it gives each one its own
worktree, verifies what each agent claims rather than believing it, then rebases and fast-forwards
them in one at a time.

## 4. See where you stand — `bead-report`

```
/bead-report                        # the whole board
/bead-report beads-xyz789           # one epic
python3 scripts/pm/board.py report   # the same thing, straight from the module
```

Six sections, always in the same order, so this week's report can be compared with last week's:
board counts, completion, flow, velocity, risks, next actions. A section with nothing to say prints
`— none` rather than disappearing.

The parts worth reading closely:

**Completion has two numbers and a coverage figure.** By count and by points, and then how many of
your open beads are actually sized. When coverage is under 60% the report says outright that the
points figure describes finished work and says almost nothing about what is left. On the first
board this ran against it read *100% by points* with zero of seventeen open beads sized — true, and
useless without the caveat next to it.

**Blocked work is grouped by what is actually blocking it.** "5 blocked" is not something you can
act on. "These 5 are all waiting behind `beads-7pi`, which is `auto-ok` and unclaimed" is, and it
is usually the highest-leverage thing on the board regardless of what the priority fields say.

**Velocity comes with a regime, not just a number.** Five or more sized closes in the window and it
is `measured`. Two to four and it is `provisional`, with a deliberately wider band and the
pessimistic date named as the one to plan on. Fewer than two and there is no date at all, just what
it would take to earn one. This exists because the first run produced 5.86 points a day out of
three closed beads, which is nonsense with a decimal point on it.

## 5. See when it lands — `bead-forecast`

```
/bead-forecast                          # every epic
/bead-forecast --epic beads-xyz789      # one
/bead-forecast --apply                  # record the snapshot on the epic
```

Three dates per epic — optimistic, likely, pessimistic — and then, always, the list of what makes
the bands that wide: unsized beads missing from the remaining total, blocked chains and which bead
the dates assume moves first, `needs-human` work that no agent velocity applies to, and whether the
duration basis includes time beads spent sitting in the backlog. A forecast without that list is a
number pretending to be a plan.

With `--apply` it writes the snapshot to the epic as metadata plus a note, and that is the only
thing this skill writes. The point of recording it is the next run: `forecast` starts by scoring
its own last prediction — how many points moved, whether the epic is on track against the likely
date or past the pessimistic one and by how many days, and whether velocity jumped by more than
double. The arithmetic can tell you a date slipped. Only you can say which of the listed reasons
turned out to be the one that mattered, and that sentence is the whole value of the exercise.

## 6. Check the claims — `bead-audit`

```
/bead-audit                          # the whole board
/bead-audit beads-xyz789             # one epic
/bead-audit auto-partial             # everything with one label
```

Use this when "already done" has started to feel optimistic. It fans out read-only agents to
re-measure, each returning DONE, NOT DONE or PARTIAL with concrete evidence — a file and line, the
command it ran, the exit code it got. Missing evidence counts as NOT DONE. Testimony counts as
PARTIAL.

Only the main loop then closes or edits anything. That split matters: an agent that can both judge
and close has every incentive to judge generously.

What comes out is a before-and-after progress table per epic, a set of self-contained prompts for
the debt an agent can clear, and a separate list of what needs a person. That last list is where
the next `bead-split` usually comes from, and the loop closes.

## When a skill stops instead of running

| It says | What is actually true | What to do |
|---|---|---|
| unclassified bead found | someone created a bead without a lane | label it with a measured reason, or `needs-human` |
| `size:XL`, split required | the estimate is a confession that the work is not understood | split it into children, then size those |
| forecast withheld | fewer than two sized closes; any date would be invented | size the open beads, close five, ask again |
| low coverage | most open work is unsized, so the points column describes the past | `/bead-estimate --backfill` |
| SCOPE ALARM | three straight weeks of taking on more than you finished | a decision from you: cut, move, or accept |
| epic carries a size label | the rollup underneath it is corrupted | remove it, size the children |
| this looks like documentation | you pointed `bead-split` at a README | point it at a spec, or name the section |

None of these are errors. Every one is the skill declining to give you a confident answer it cannot
support, which is the only reason to trust the answers it does give.

## Quick reference

| Skill | For | Writes to the board? |
|---|---|---|
| `bead-split` | markdown spec → epic + sized, classified children | only with `--apply` |
| `bead-estimate` | size beads from measured history | a single id yes; `--backfill` and `--epic` only with `--apply` |
| `bead-take` | one bead, one worktree, closed with evidence | yes |
| `bead-loop` | one ready bead per round | yes |
| `bead-fleet` | a parallel batch, one worktree each | yes |
| `bead-pm-loop` | the same rounds with gates and cadence | yes |
| `bead-report` | where we stand | no |
| `bead-forecast` | when it lands | only with `--apply`, and only metadata plus a note |
| `bead-audit` | is "done" true? | yes, main loop only |

None of them run `git push` or `bd dolt push`. They report the files they changed and the commands
they did not run. That is deliberate: as long as history stays linear and unpushed, one
`git reset --hard` undoes an entire unattended night, and that is the only safety net any of this
has.

## Changing a skill

The files under `.claude/`, `.cursor/` and `.agents/` are generated. Each carries a stamp line, and
editing one in place means `bd-kit update` will refuse to overwrite it rather than silently throwing
your fix away. Edit the kit instead:

```bash
cd ~/Projects/beads-pm-kit
$EDITOR skills/bead-report/skill.md         # the one authored copy
node tools/sync-codex.js bead-report        # after re-reading codex.md against it
npm test && bin/bd-kit check
node tools/fixed-point.js ../my-project     # nothing changed that should not have
bin/bd-kit install --into ../my-project
```

`docs/authoring.md` covers the token vocabulary and per-surface fields. `docs/transforms.md` lists
every way the three surfaces differ — if a difference is not on that list, the surfaces do not
differ that way and anything you find in an installed copy is drift.

## What has actually been run

Worth being straight about, since a guide that overstates its own testing is worse than no guide.

Measured against a live 75-bead board while this kit was written: `board.py report`, `forecast` and
`refclass` in every mode, a real `pm.forecast` snapshot written and read back through the
calibration path, and `bd-kit install`, `diff`, `doctor` and `uninstall`. The three refusals
described above — the velocity regimes, the coverage caveat, the reference-class floors — exist
because that board produced a wrong confident answer first, and each one is covered by a test
against a fixture that reproduces the case.

Not re-run in that session: `bead-split`, `bead-take`, `bead-loop`, `bead-fleet` and `bead-audit` as
end-to-end flows. Those five predate the kit and had been used in practice on this board; the kit
lifted them in unchanged except for two one-line additions and six wording normalizations, and
`tools/fixed-point.js` compares every generated surface against the pre-kit file to prove exactly
that. So treat their step-by-step behaviour as documented rather than as freshly measured, and read
`docs/migration.md` if you want to see precisely what changed.
