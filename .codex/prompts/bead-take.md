---
description: Take one bead, implement it in a dedicated worktree, close it with evidence
argument-hint: "<bead-id> [extra notes]"
---


# bead-take

You are taking the bead **the user typed after `/bead-take`** (`<bead-id> [extra notes]`).
No id given → run `bd ready --json`, propose the highest-priority bead, and ask before claiming.

## 0. Read before you touch anything

- `bd show <bead-id>` — read the description AND the NOTES carefully: **the closing
  conditions live in the notes**, and the most recent RE-MEASURE note (if there is one)
  is a more trustworthy measurement than the description.
- Read the repo's convention docs (`CLAUDE.md` / `AGENTS.md` / … if present). When the
  bead and the docs disagree: the bead wins until someone measures again.
- Bug → follow a systematic debugging process (the `systematic-debugging` skill if your
  environment has one) before changing anything. Feature or refactor → TDD (the
  `test-driven-development` skill if available).

## 1. Claim, then a dedicated worktree

```bash
bd update <bead-id> --claim
git worktree add -b work/bead-<bead-id> ../wt-<bead-id> <BASE>
```

- `<BASE>` = **the project's integration branch**: whichever branch the user names, or
  the main tree's current branch (`git branch --show-current`). Do not default to
  `origin/main` when the project integrates somewhere else.
- The harness's automatic worktree tool is only safe when you are certain it branches
  from the right `<BASE>` — many harnesses default to branching from `origin/main` and
  so miss the integration branch's commits. When unsure, run `git worktree add`
  yourself as above.
- A fresh worktree has **none of the gitignored artefacts** (venv, `node_modules`, build
  caches). Install for real inside the worktree before trusting any build or test result.
- The main tree may have another session live in it: do not touch files outside this
  bead's scope.

## 2. Do the work

- Measure the current state BEFORE changing anything (grep / LOC / run the tests). If
  what you measure disagrees with the bead's notes, append the correction to the bead
  first, then carry on.
- Follow the repo's existing patterns (read the architecture docs if present) — reuse
  first, invention second; a new abstraction needs ≥2 real callers today.
- Work you discover outside the scope → `bd create` immediately. Do NOT widen the current
  bead's scope, and do NOT use a todo tool or markdown checkboxes in place of the board.

## 3. Hand back — evidence first, claims second

Before claiming anything is done, verify for real — follow a
`verification-before-completion` process (the skill of that name if your environment
has one) — then:

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
