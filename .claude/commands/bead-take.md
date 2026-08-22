---
description: Take one bead, implement it in a dedicated worktree, close it with evidence
argument-hint: "<bead-id> [extra notes]"
---
<!-- beads-pm-kit v0.1.0 skill:bead-take surface:claude sha256:dc56038b79d1 -->

You are taking this bead: **$ARGUMENTS**

## 0. Read before you touch anything

- `bd show <bead-id>` — read the description AND the NOTES carefully: **the closing
  conditions live in the notes**, and the most recent RE-MEASURE note (if there is one)
  is a more trustworthy measurement than the description.
- Read `CLAUDE.md` / the repo's convention docs (if present). When the bead and the docs
  disagree: the bead wins until someone measures again.
- Bug → invoke the `superpowers:systematic-debugging` skill before changing anything.
  Feature or refactor → `superpowers:test-driven-development`.
- No `size:*` label on the bead → size it first with the `bead-estimate` skill; an
  unsized bead that gets claimed is a hole in every later report and forecast.

## 1. Claim, then a dedicated worktree

```bash
bd update <bead-id> --claim
git worktree add -b work/bead-<bead-id> ../wt-<bead-id> <BASE>
```

- `<BASE>` = **the project's integration branch**: whichever branch the user names, or
  the main tree's current branch (`git branch --show-current`). Do not default to
  `origin/main` when the project integrates somewhere else.
- The harness worktree tools (EnterWorktree…) are only safe when you are certain they
  branch from the right `<BASE>` — many harnesses default to branching from
  `origin/main` and so miss the integration branch's commits. When unsure, run `git
  worktree add` yourself as above.
- A fresh worktree has **none of the gitignored artefacts** (venv, `node_modules`, build
  caches). Install for real inside the worktree before trusting any build or test result.
- The main tree may have another session live in it: do not touch files outside this
  bead's scope.

## 2. Do the work

- Measure the current state BEFORE changing anything (grep / LOC / run the tests). If
  what you measure disagrees with the bead's notes, append the correction to the bead
  first, then carry on.
- Follow the repo's existing patterns (read `CLAUDE.md` / the architecture docs if
  present) — reuse first, invention second; a new abstraction needs ≥2 real callers
  today.
- Work you discover outside the scope → `bd create` immediately. Do NOT widen the
  current bead's scope, and do NOT use TodoWrite or markdown checkboxes.

## 3. Hand back — evidence first, claims second

Invoke the `superpowers:verification-before-completion` skill, then:

- Run the tests for real and read the **exit code** (never `echo OK`; `rc=0` with no
  output is a failure signal, not a pass). Record the command and its result. Read the
  verdict from the runner's **machine-readable** output (junitxml, a JSON reporter…)
  whenever one exists — the final summary line can be truncated when captured.
- A tripped snapshot or generated file → regenerate it **in the same commit**.
- Commit: `git add <exact paths>` immediately before committing, then
  `git commit --only <path>…` — never `git add -A`, never stage early.
- Close it: `bd close <bead-id> --reason "<evidence: file:line, the test you ran + its result, commit hash>"`.
  - Closing conditions not fully met → **do not close**:
    `bd update <bead-id> --append-notes "RE-MEASURE <date> (HEAD <sha>): …what is still missing, and why"`.
  - Remaining debt must be listed **item by item** in the reason or note — no silence,
    no bare counts.
- Handoff: report the files you changed, the verify command plus its output, the bead's
  status, and the suggested commit/push commands — **never push or sync on your own**
  (conservative profile).
