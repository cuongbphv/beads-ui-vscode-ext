---
description: Run a fleet of auto-ok beads in parallel until the queue is empty — one worktree per bead, rebase + ff-only onto the integration branch, then clean up
argument-hint: "[--batch N] [--include-partial] [--unattended]"
---

You are running the **fleet**, `/bead-fleet`. Parameters: **$ARGUMENTS**

**YOU ARE THE ORCHESTRATOR — you do not edit code yourself.** You: pick the batch, spawn
the agents, VERIFY what they claim, rebase → ff-only merge, write to the board, clean up
the worktrees. Repeat until `NO WORK LEFT`.

`--batch N` defaults to 4 (see §1c). `--unattended` turns on §5.
`<BASE>` = **the project's integration branch**: whichever branch the user names, or the
main tree's current branch (`git branch --show-current`) — settle it once, at the start of
the session.

## 0. Invariants — break one and you lose the whole night

- **Every write to beads** (`--claim`, `close`, `create`, `dep`, `--append-notes`) is run by
  **YOU**, in the main tree. Agents only READ. `bd list` / `bd show` from a worktree is
  measured to work (`.beads/metadata.json` is tracked). [Unverified] whether two concurrent
  `bd` writes are safe → do not try it.
- **No `git push`, no `bd sync`** unless the user allows it in this turn. As long as history
  stays linear (ff-only) and unpushed, `git reset --hard <the first sha>` in the morning
  undoes the entire night. That is the only safety net — do not destroy it with one push.
- **Trust no claim an agent makes.** Verify: grep at the exact `file:line` the agent cited ·
  re-run the exact test command the agent cited · read the real exit code. `rc=0` with no
  output is a FAILURE signal. Read the test verdict from machine-readable output
  (`--junitxml`, a JSON reporter…), NOT from the summary line — the summary line is measured
  to be truncated when captured under Git Bash.
- **Skipped ≠ passed.** After every batch, for every test file that batch touched, count
  `ran` / `skipped` / `FAIL` per file or classname in the machine-readable report. A new
  test that gets silently skipped looks exactly like rc=0 with it passing.

## 1. Pick the batch

Extract the §1 bash block from `.claude/commands/bead-loop.md` with `awk` and run it — do
not retype it (it is the single source of truth for the label rules and the blocker
filter). From the ready `auto-ok` queue, filter further:

a. **No dependency edges inside one batch** — `bd ready` already filters blockers, but check
   `bd dep tree <id>` between the beads sharing a batch as well.
b. **Disjoint file footprints.** Read the descriptions, guess which files get touched;
   overlapping files → different batches.
c. **At most ONE bead per batch may regenerate a shared generated file** (a golden file, an
   API-surface snapshot, a schema/enum export, a contract freeze…). Two agents regenerating
   the same file rebase cleanly as **text** while the content is WRONG — and no test catches it.
d. **Drop it from the fleet, report back to the user, decide NOTHING yourself** — any bead
   whose closing conditions contain a choice (`bd show` mentions a "decision", a "RE-SCOPE",
   a "propose … pick one", or two equally weighted options). The `auto-ok` label says *the
   code is doable*, not *the scope is settled*.

Print the chosen batch **and the reason each deferred bead was deferred**. No silent truncation.

## 2. Spawn — all of it in ONE message

```
git worktree add -b work/bead-<id> ../wt-<id> <BASE>
```
The harness worktree tools (EnterWorktree…) are only safe when you are certain they branch
from the right `<BASE>` — many harnesses default to branching from `origin/main` and miss the
integration branch's commits.

**A fresh worktree has NONE of the gitignored artefacts** (venv, `node_modules`, build
caches). Each stack has its own trap; do not conflate them:

- **Python:** if the repo uses a single venv in the main tree and that venv is an editable
  install pointing at the **main tree's** `src/`, running it from a worktree can import the
  package from the main tree ⇒ tests go green without testing any of the agent's work. Make
  the agent prove otherwise first (§B step 0).
- **JS/TS:** without `node_modules`, typecheck and tests cannot run at all. Run the **real**
  installer inside the worktree (`npm ci` / `pnpm install --frozen-lockfile` / …) — do NOT
  symlink or junction `node_modules` from the main tree: a junction is measured to make
  vitest fail en masse ("Vitest failed to find the current suite") even though the same test
  files and the same binary pass cleanly in the main tree — suspected dual module loading
  between the junction path and the real path. Installing needs the network and a few
  minutes; if it fails, that bead is NOT merged — mark it with `--append-notes` and never
  merge blind.
- **Toolchains with a per-user cache** (Gradle's `~/.gradle`, the pip cache, the cargo
  registry…) usually run from a worktree without reinstalling — check with one small build
  command before trusting it.

Then spawn one agent per bead using the brief in §B, filling in `<ID>`, the worktree path,
and the repo's toolchain details (python/venv paths, the package to import-prove, …).

## 3. Integration — SEQUENTIAL, one bead at a time, in exactly this order

The order is load-bearing: **rebase rewrites SHAs**, so `bd close` must come AFTER the
rebase, or the reason quotes a SHA that is no longer on the branch (only in the reflog,
until gc).

1. Verify the agent's claims (§0). Not satisfied → **do not merge**; go to §5.
2. In the worktree: `git rebase <BASE>`.
3. **AFTER the rebase**, in the worktree: re-run that bead's own tests plus every
   snapshot/contract gate plus the repo's fast lint. The post-rebase tree is a tree **no
   agent has tested**.
4. In the main tree: `git merge --ff-only work/bead-<id>`.
5. `bd close <id> --reason "<file:line · test name + real rc · the post-rebase commit>"`.
   An `auto-partial` bead → **do NOT close**; only
   `bd update <id> --append-notes "RE-MEASURE <date> (HEAD <sha>): what you did, which commit, what is still missing and WHY it needs a person"`.
   Closing it turns "not measured" into "passed" — the exact opposite of why it was
   classified that way.
6. `git worktree remove ../wt-<id>`, then `git branch -d work/bead-<id>` (`-d`, NOT `-D`).

## 4. Composite gate — ONCE after every batch

- Run the **repo's full gate**: lint + typecheck + the full test suite — take the commands
  from `CLAUDE.md` / the CI config / the scripts in `package.json` / `pyproject` /
  `Makefile`. Do not invent them.
- **Pin the tool versions CI uses before reading any lint or format result.** Changing the
  version changes the rule set: measured on one unchanged tree, the old version said "All
  checks passed!" while the new version reported thousands of errors. A number like that
  means you are measuring the *tool*, not the repo.
- Read the test verdict from machine-readable output (§0). For a large suite: emit
  `--junitxml` or JSON and read the counts. Read the runner's config before adding a flag —
  a flag that conflicts with existing config (say, disabling a plugin while `addopts` still
  passes its options) kills the runner before a single test runs.
- **Never run two suites in parallel** if they share filesystem, port, or database state.
- Red → §5. Green → back to §1.

## 5. Failure policy (mandatory under `--unattended`)

The goal: **make progress without a person**, and never merge anything unproven.

- A bead's tests are red → the agent gets at most **2** fix rounds. Still red → drop that
  bead from the batch, `--append-notes` with the *verbatim* error plus the reproduction
  command, remove the worktree, and **move on to another bead**.
- A rebase conflict in an **ordinary** file → resolve it in the worktree and re-run §3.3.
- A rebase conflict in a **generated file or snapshot** → do **NOT** resolve it yourself.
  Drop the bead and append notes. Resolving it wrong here produces a green snapshot whose
  content is false.
- The composite gate goes red after an ff-only merge → find the culprit with `git bisect`
  over exactly that batch's commit range; `git revert` that bead, `bd update
  --append-notes`, and reopen it with `bd update <id> --status open`. Do **not**
  `git reset --hard` (it would erase the other beads too).
- Newly discovered debt → `bd create` immediately (with `--parent <epic>` + a classification
  label + the measurable reason). If no epic fits, create one — do not park it in an
  unrelated "general debt" epic.
- **Stop outright and wait for a person** in exactly three cases: (a) a bead needs a scope
  decision (§1d) and no other bead is runnable; (b) the composite gate is red and bisect
  cannot name the culprit; (c) `bd` or `git` returns an error you have never seen — do not
  guess.

## 6. Stop, and the final cleanup

`NO WORK LEFT` → clean up properly:
- `git worktree list` · `ls -d ../wt-*` · `git worktree prune`
- `git branch --list`, looking for the agents' **orphaned** branches (merged, `ahead=0`, but
  with no directory left on disk ⇒ `git worktree list` does NOT show them, which is why
  earlier cleanups miss them). Delete those with `git branch -d`.

Final report, every item listed **one by one**, never as a bare count:
beads closed + SHA · `auto-partial` beads that only got append-notes + WHY · beads abandoned
mid-flight + the verbatim error · new beads from `bd create` + epic + label · remaining
`needs-human` + the reason for each · beads needing a user decision (§1d) + the options ·
the suggested `git push` / `bd sync` commands (do not run them).

---

## §B. The brief for each agent (fill it in, then spawn)

```
You are implementing bead `<ID>` in a dedicated worktree: `<WT>`. ONLY this bead.

## Step 0 — PROVE you are testing your own tree (do not skip this)
A worktree has none of the gitignored artefacts (venv, node_modules, …).
- Python (repo with an editable-install venv in the main tree): with cwd = `<WT>`, run:
      <VENV_PY> -c "import <PKG>; print(<PKG>.__file__)"
  The path it prints MUST be inside `<WT>`. If it is not, STOP and tell the orchestrator —
  do not "just try it and see", the tests will go green on code that is not yours.
- JS/TS: check that `node_modules` exists inside `<WT>` (a real install, NOT a symlink or
  junction from the main tree); if it is missing, tell the orchestrator, do not install it
  yourself.

## Step 1 — Read, then MEASURE, before changing anything
- `bd show <ID>`: the closing conditions are in the NOTES; the latest RE-MEASURE note is
  more trustworthy than the description. The bead beats the docs until someone re-measures.
- Read `CLAUDE.md` / the repo's convention docs (if present).
- Grep at the exact file:line the bead cites. If your measurement differs from the note,
  tell the orchestrator to append the correction BEFORE you change anything (line numbers
  in beads have been wrong before).
- Bug → the `superpowers:systematic-debugging` skill. Feature/refactor →
  `test-driven-development`.

## Step 2 — Do the work
- Reuse first, invention second. Grep for an existing owner in the repo (error type, path
  helper, config loader, HTTP client wrapper, validation, …) before writing a new one. A new
  abstraction needs ≥2 REAL callers today.
- Write guards as an ALLOWLIST, not `!= <bad value>`; pin them with a test that iterates the
  set of valid values. State maps must be exhaustive — no silent default.
- "Not measured" ≠ 0: `None` / `null` / an empty column, and keep that distinction across
  EVERY hop — a single `or []` one layer up is enough to erase the whole fix.
- Respect the repo's layer boundaries (router/service/store, UI/domain/data, …): logic goes
  in the right tier, and no importing against the dependency direction.

## Step 3 — TECHNICAL DEBT: two kinds, and this is the easiest place to get it wrong
DEBT YOUR OWN CHANGE CREATED → fix it cleanly in this worktree, in the same commit:
  lint + typecheck clean over the area you touched · every tripped snapshot or generated
  file regenerated IN THE SAME COMMIT · docs/docstrings your change made wrong → fix them
  now (a stale doc IS a bug) · a new field or API → update EVERY consumer in the repo in the
  same commit, or state explicitly WHY a given consumer does not need it · every new path
  needs a test · the repo's own conventions (registry, audit log, migration checklist, … —
  read CLAUDE.md) satisfied in full.
PRE-EXISTING, UNRELATED DEBT → tell the orchestrator to `bd create` it. Do NOT widen the
  scope, do NOT use TodoWrite, do NOT use markdown checkboxes.
EXCEPTION: if you make a branch that has NEVER RUN start running, you own it — the
  pre-existing bugs in it are yours too.

## Step 4 — Tests
- Run the tests with the repo's runner and config; emit a machine-readable report
  (`--junitxml=<file>.xml` for pytest, a JSON reporter for other runners) and read the
  verdict FROM THE REPORT — do NOT trust the summary line (measured to be truncated when
  captured).
- Read the runner's config before adding a flag — a flag conflicting with existing
  addopts/config kills the runner before a single test runs.
- A fix only counts as proven once you REPRODUCE the failing condition: back out your manual
  intervention, run it again, and confirm the CODE does it on its own.
- If the repo supports several operating systems, the code must be green on them: explicit
  `encoding="utf-8"` · never assert paths with a hardcoded separator · no unguarded
  POSIX-only APIs (`SIGKILL` / `fcntl` / …) · no raw NUL characters in source.

## Step 5 — Commit, then HAND BACK
You do NOT `bd close`, do NOT `bd update`, do NOT rebase, do NOT merge, do NOT push.
- `git add <exact paths>` immediately before committing, then `git commit --only <path>…`.
  Absolutely no `git add -A`, and never stage early: `git add <path> && git commit` still
  commits the ENTIRE index, and has swept another session's work-in-progress into someone
  else's commit before.
- Report back: the files you changed · the verify command + its **real exit code** + the
  report path · the commit SHA · the debt you fixed (item by item) · the debt you left for
  `bd create` (item by item) · which consumers you updated, or why they did not need it.
```
