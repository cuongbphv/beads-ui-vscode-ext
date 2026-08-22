---
description: Audit the beads board as PM — fan out agents to measure evidence, settle the debt centrally, emit parallel prompts
argument-hint: "[epic-id | label | list of bead-ids] (empty = the whole board)"
---
<!-- beads-pm-kit v0.1.0 skill:bead-audit surface:claude sha256:c1aa5a845619 -->

You are the PM auditing the beads board for this scope: **$ARGUMENTS**

The principle that governs everything below: **agents only MEASURE and return evidence;
only the PM (you, in the main loop) may close or edit a bead.** The repo is the truth —
every "already done" claim has to be re-measurable.

## 1. Establish the current state

- `bd ready`, `bd list --status in_progress`, and `bd show <epic>` for each epic in scope
  — read the NOTES too: the closing conditions and the previous measurement live there.
- `git fetch origin` plus `git rev-list --left-right --count origin/<branch>...HEAD` —
  another machine may already have pushed the fix; record the HEAD sha in every
  measurement note.
- For a bead that needs an external environment (a cluster, a database, staging…), try
  one **read-only** command to check real access before believing a note that says "no
  access" — that note may be stale.

## 2. Fan out agents to measure (in parallel, read-only)

Group the beads by front (code / UI / infrastructure / docs) — one agent per group
(`Explore` for repo-only work, `general-purpose` when it has to touch an external
environment), all running in parallel. Every agent's prompt MUST carry:

- The list of bead-ids plus the `bd show` command, so the agent reads the closing
  conditions itself.
- The prohibitions: **do NOT close or update a bead, do NOT edit any file**; on an
  external environment, **read-only** operations only, and restart nothing.
- The return format: one verdict per bead — **DONE / NOT DONE / PARTIAL** — plus concrete
  evidence (file:line, the LOC it measured, the query plus the row count, a commit hash,
  the name of the test it **actually ran** plus its result). Missing evidence = NOT DONE,
  and say exactly what is missing. Precision over optimism.
- Verify a deployed build through real behaviour or real symbols in the running
  environment (import the new module, call the new endpoint) — never through a digest or
  a version string.

## 3. Settle the debt centrally (main loop only)

Reconcile the agents' reports and handle each bead:

- **DONE** → `bd close <id> --reason "Verified <date> (agent re-measure): <the decisive evidence>"`.
  Any leftover debt (the part that could not be verified…) must be **spelled out in the
  reason** — no silence.
- **NOT DONE / PARTIAL** → `bd update <id> --append-notes "RE-MEASURE <date> (HEAD <sha>): <the new measurement> — still missing <what> before this can close"`.
  A bead whose earlier measurement was incomplete or wrong → **correct it** right there
  in the note.
- Docs in the repo that contradict the source → fix them **in place, in the same pass**;
  do not create a new dated file.
- Evidence an agent happened to measure for a bead **outside** the scope → append a note
  to that bead as well.
- A verdict backed only by testimony (prose in a commit or a bead, not reproducible) →
  PARTIAL, do not close.

## 4. PM handoff

- A summary table: which beads closed (with the decisive evidence), which stay open (with
  what is still missing), and each epic's progress before and after.
- For remaining debt an **agent can do by itself**: emit parallel prompts to the template
  — each prompt self-contained, carrying the latest measurement (file:line), the closing
  conditions, the dedicated-worktree rule
  (`git worktree add -b work/bead-<id> ../wt-<id> <BASE>`, where `<BASE>` = the project's
  integration branch — see `bead-take`), `bd update --claim`, `git commit --only`, and
  `bd close` with evidence. Only pair beads in parallel when they **do not touch the same
  files** — state explicitly which pairs conflict and in what order they must merge.
- For beads that need a PERSON to decide (an IA/UX call, a re-scope, anything touching
  identity or an external system, meaningful running costs) → **emit no self-running
  prompt**; list them separately and wait for the decision.
- Report the files you changed plus the suggested commit commands; **never push or sync
  beads on your own** unless asked.
