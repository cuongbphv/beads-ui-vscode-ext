---
name: bead-take
description: Use when the user asks to take, claim, or implement one specific issue from a Beads board.
---
<!-- beads-pm-kit v0.1.0 skill:bead-take surface:codex -->

# Bead Take

The bead id and optional notes are supplied with `$bead-take`. Treat optional notes as
additional user constraints; they do not override the bead's acceptance criteria or
repository safety rules. If no id is supplied, run `bd ready --json`, propose the
highest-priority bead, and ask before claiming it.

## Read first

- Run `bd show <id>` and read the description, acceptance criteria, and notes. The newest
  re-measurement is more trustworthy than an older description.
- Read repository instructions such as `AGENTS.md`.
- For a bug, use systematic debugging before editing. For a feature or refactor, use TDD.

## Claim and isolate

```bash
bd update <id> --claim
git worktree add -b work/bead-<id> ../wt-<id> <BASE>
```

`<BASE>` is the user-specified integration branch or the main tree's current branch. Do not
assume `origin/main`. A new worktree has no ignored dependencies or build artifacts; install
them inside that worktree before trusting tests.

## Implement

- Measure the current state before changing it. If evidence contradicts the bead notes,
  append a correction first.
- Follow existing architecture and reuse existing owners before adding abstractions.
- Record unrelated discovered work with `bd create`; do not widen the current bead.
- Use Beads rather than markdown TODO lists for durable follow-up work.

## Verify and hand back

- Run relevant tests and record the command, real exit code, and machine-readable result
  when available. A zero exit with no evidence that tests ran is not sufficient.
- Regenerate changed snapshots or generated files in the same commit.
- Stage exact paths immediately before committing; never use `git add -A`.
- Commit before closing the bead only when the active repository profile or current user
  explicitly authorizes commits. Otherwise stop before commit/close and hand the verified
  work back with the exact commands the user can approve.
- If every closing condition is met:
  `bd close <id> --reason "<file:line; test and result; commit sha>"`.
- Otherwise leave it open and append a re-measurement note stating exactly what remains.

Report changed files, verification evidence, bead status, and suggested commit or push
commands. Never push code or Beads data unless the user explicitly asks.
