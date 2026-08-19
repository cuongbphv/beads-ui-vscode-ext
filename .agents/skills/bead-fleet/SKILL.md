---
name: bead-fleet
description: Use when coordinating several independent auto-ok Beads issues in parallel, one isolated worktree per issue, until the ready queue is empty.
---

# Bead Fleet

Parameters supplied with `$bead-fleet` may include
`--batch N`, `--include-partial`, and `--unattended`. Batch size defaults to four.

The coordinating agent selects work, launches agents, verifies evidence, integrates commits,
updates Beads, and cleans worktrees. Worker agents never write to Beads.

This workflow requires worker commits and ff-only merges. Before dispatching, confirm the
current user request or active repository profile authorizes commits. If it does not, stop
and request that authorization; never infer it from general permission to edit files.

## Invariants

- Serialize every `bd update`, `bd close`, and `bd create` in the main tree.
- Never push code or Beads data without explicit user permission.
- Trust no worker claim until its cited file lines and tests are independently verified.
- A skipped test is not a pass. Prefer machine-readable test reports.
- `<BASE>` is the user-specified integration branch or the main tree's current branch, fixed
  once at the start.

## Select a batch

Before selecting anything, read `.agents/skills/bead-loop/SKILL.md` and apply its
classification, exactly-one-label, ordering, and blocker rules. Do not rely on the
`bead-loop` description alone. Select ready `auto-ok` beads, plus `auto-partial` only when
explicitly requested.

Within one batch:

- no dependency edge may connect two selected beads;
- predicted file footprints must be disjoint;
- at most one bead may regenerate any shared generated file;
- exclude every bead whose closing conditions require an unresolved decision.

Print every selected bead and the reason every candidate was deferred.

## Isolate and dispatch

Create one worktree per bead:

```bash
git worktree add -b work/bead-<id> ../wt-<id> <BASE>
```

Each worker prompt must require it to:

1. prove imports, dependencies, and tests resolve inside its own worktree;
2. run `bd show <id>`, read repository instructions, and measure before editing;
3. use systematic debugging for bugs and TDD for features/refactors;
4. stay within scope and report unrelated debt to the coordinator;
5. run repository tests with machine-readable output where available;
6. commit exact paths only;
7. never update Beads, rebase, merge, or push;
8. return changed files, test command/result, report path, commit SHA, and remaining debt.

Launch independent workers in one parallel batch.

## Integrate sequentially

For each completed worker:

1. Verify its evidence independently.
2. In its worktree, run `git rebase <BASE>`.
3. Re-run its tests, snapshots/contracts, and fast lint after the rebase.
4. In the main tree, run `git merge --ff-only work/bead-<id>`.
5. Close an `auto-ok` bead with post-rebase evidence and SHA.
6. Never close `auto-partial`; append a re-measurement note stating what remains.
7. Remove its worktree and delete the merged branch with `git branch -d`.

After each batch, run the repository's full documented gate. Do not invent commands or run
state-sharing suites concurrently.

## Failure policy

- Give a failing worker at most two focused fix rounds, then record the verbatim failure,
  remove its worktree, and continue.
- Resolve ordinary rebase conflicts only with full re-verification. Do not manually resolve
  conflicts in generated files or snapshots.
- If the composite gate fails, identify and revert only the culprit; reopen and re-note that
  bead.
- Stop for an unresolved decision with no other runnable work, an unattributable composite
  failure, or an unfamiliar `bd`/git error.

## Finish

When no ready work remains, clean merged worktrees and orphaned merged branches. Report every
closed, partial, abandoned, created, and human-blocked bead individually, with SHA or reason.
Suggest push/sync commands but do not run them.
