# `.cursor/` — the beads workflow for Cursor

The Cursor copy of five skills that close one loop over the beads board:
split → take → loop → run in parallel → audit.

## What is in here

```
.cursor/skills/<name>/SKILL.md
```

Each skill is one `SKILL.md`, with three frontmatter keys:

| Key | Meaning |
|---|---|
| `name` | The skill name; matches the directory name. |
| `description` | The trigger sentence — what the skill does, then "Use when the user runs /`<name>` or asks to …" followed by the natural phrasings that mean the same thing. This is what decides whether the skill gets recognised, so write it in terms of user intent rather than as a summary of the body. |
| `disable-model-invocation: true` | The skill runs **only when the user asks for it**; the model never triggers it on its own. All five have it, because every one of them either writes to the real board or creates worktrees — not the kind of thing that should fire in the middle of an unrelated question. |

There is **no** `.cursor/rules/` here. The beads baseline (the `bd` rules, the session-close
protocol, the git profile) lives in `AGENTS.md` at the repo root.
[Inference] Cursor reads `AGENTS.md`, so that baseline applies — based on the layout the
maintainer set up. Unlike the skill loading below, this particular claim has not been
confirmed.

Project-level loading is confirmed: the maintainer verified on 2026-08-19 that Cursor picks
these skills up from `.cursor/skills/` in this repo.

## The five skills

| Invoke | Use it when | Writes to the board? |
|---|---|---|
| `/bead-split <file.md \| dir> [--apply] [--epic <id>] [--section "<h>"]` | A spec, plan or roadmap lives in markdown and needs to become an epic + tasks | **No**, unless `--apply` |
| `/bead-take <bead-id> [extra notes]` | Take exactly one bead, work it in a dedicated worktree, close it with evidence | Yes |
| `/bead-loop [--include-partial] [--dry-run]` | Each round picks exactly ONE workable bead and delivers it | Yes |
| `/bead-fleet [--batch N] [--include-partial] [--unattended]` | Several independent `auto-ok` beads, run in parallel, one worktree each | Yes |
| `/bead-audit [epic-id \| label \| bead-ids…]` | You suspect "already done" is not true: fan out agents to re-measure, then settle the debt centrally | Yes (main loop only) |

The usual order: `/bead-split` → `/bead-loop` (or `/bead-fleet`) → `/bead-audit`.

Because of `disable-model-invocation: true`, saying "go audit the board" will **not** run
`/bead-audit` — you have to name the skill.

## The label contract — read this before editing any skill

`skills/bead-loop/SKILL.md` **§0** is the single source of truth for the
`auto-ok` / `auto-partial` / `needs-human` rules. The other skills point at it and **never
copy it**.

Those three labels are this extension's swimlanes: `src/webview/lib/board-swimlanes.ts`
groups the board's columns by them, and a bead carrying none of the three falls into the
`unlabeled` lane with a warning flag. An unclassified bead shows up as a red lane in the UI;
it is not an agent's internal bookkeeping.

The rules that come with it: **never infer a label from a title**, a new label must carry a
measurable reason written into that bead's own notes, and anything you cannot measure is
`needs-human`.

## Three runtime surfaces that have to stay in sync

The same procedures exist in three places, as **real files, not symlinks**:

```
.claude/commands/<name>.md          # the canonical copy; uses $ARGUMENTS
.cursor/skills/<name>/SKILL.md      # this one
.agents/skills/<name>/SKILL.md      # condensed portable copy + agents/openai.yaml
```
The `.agents/skills/<name>/SKILL.md` surface is **deliberately condensed** — roughly a
third the length, with the embedded scripts and the deeper measurements described in prose
instead. Do not "fix" it by expanding it back to full length. It pairs each skill with an
`agents/openai.yaml` carrying `policy.allow_implicit_invocation: false`, the `.agents`
equivalent of `disable-model-invocation`, and it addresses skills as `$bead-take` rather than
`/bead-take`. Facts that live **only** in the long copies: the two runnable python blocks in
`bead-loop`, the `/tmp` Git-Bash reasoning, the `node_modules` junction/vitest finding, the
truncated-summary-line measurement, the tool-version-changes-the-ruleset measurement, and the
`bd 1.2.2` version pin. Treat `.agents` as an entry point, never as the complete record.

Codex custom prompts under `.codex/prompts/` are deprecated. Codex loads the condensed
repository skills from `.agents/skills/`. Preserve these runtime differences:

- Cross-references point at `.cursor/skills/<name>/SKILL.md`, never across.
- Refer to a sibling as "the `<name>` skill".
- Paraphrase superpowers skills as "the `<skill>` skill if your environment has one" rather
  than using the `superpowers:<skill>` name the `.claude` copy uses.
- The body does **not** use a `$ARGUMENTS` variable — spell it out: "the parameters are the
  text the user typed after the command".
- Describe harness capabilities generically — "the harness's automatic worktree tool", "a
  read-only subagent", "a todo tool".
- Everything is written in **English**; this skill set is used internationally.

Check the frontmatter of every command and skill file before committing:

```bash
python3 - <<'PY'
import glob, yaml
for f in sorted(glob.glob('.claude/commands/*.md') + glob.glob('.cursor/skills/*/SKILL.md')
                + glob.glob('.agents/skills/*/SKILL.md')):
    try: yaml.safe_load(open(f, encoding='utf-8').read().split('---')[1]); print('OK  ', f)
    except Exception as e: print('FAIL', f, e)
PY
```

## Anti-patterns measured on `bd 1.2.2`

All three below **fail silently**: they run, exit 0, and give the wrong result.

- `bd create --file <md>` ignores `--labels`, `--parent`, and `-p` **without saying so**:
  the beads come out P2, with no labels and no parent. Its markdown batch format accepts no
  per-issue metadata either (everything after a `##` becomes the description verbatim, and
  the type is always `task`), and `--dry-run` errors out when combined with `--file`. That
  is why `/bead-split` uses `bd create --graph` instead.
- `bd ready --label-any` **does not filter** — it returns beads without the requested label,
  `needs-human` ones included. The AND form `--label <x>` works. Filter labels in Python.
- `bd search` excludes closed beads by default — a dedupe without `--status all` recreates
  the bead you just closed.

And one that is not a `bd` bug: **never write temp files to `/tmp`**. Git Bash maps `/tmp`
onto `%TEMP%` while Python on Windows reads `/tmp` as `C:\tmp`, so the write succeeds and
then raises `FileNotFoundError` on the very next line. Write into `.beads/`, or read `bd`
through `subprocess`.

## Git

The default profile is **conservative**: a skill reports the files it changed plus the
suggested commit commands, and **never** runs `git push` or `bd dolt push` itself. See
`AGENTS.md`, "Agent Context Profiles".
