# `.claude/` — the beads workflow for Claude Code

This directory holds five slash commands that close one loop over the beads board:
split → take → loop → run in parallel → audit.

## How Claude Code loads it

| File | What it does |
|---|---|
| `commands/<name>.md` | Becomes the slash command `/<name>`. The frontmatter needs `description` + `argument-hint`; the body uses `$ARGUMENTS` to receive whatever the user typed after the command. |
| `settings.json` | A `SessionStart` hook runs `bd prime --hook-json`, loading beads context at the start of every session so you never have to run `bd prime` yourself. |

## The five commands

| Command | Use it when | Writes to the board? |
|---|---|---|
| `/bead-split <file.md \| dir> [--apply] [--epic <id>] [--section "<h>"]` | A spec, plan or roadmap lives in markdown and needs to become an epic + tasks | **No**, unless `--apply` |
| `/bead-take <bead-id> [extra notes]` | Take exactly one bead, work it in a dedicated worktree, close it with evidence | Yes (`--claim`, `close`) |
| `/bead-loop [--include-partial] [--dry-run]` | You want the work chosen for you: each round picks exactly ONE workable bead and delivers it | Yes |
| `/bead-fleet [--batch N] [--include-partial] [--unattended]` | Several independent `auto-ok` beads, run in parallel, one worktree each | Yes |
| `/bead-audit [epic-id \| label \| bead-ids…]` | You suspect "already done" is not true: fan out agents to re-measure, then settle the debt centrally | Yes (main loop only) |

The usual order: `/bead-split` → `/bead-loop` (or `/bead-fleet`) → `/bead-audit`.

## The label contract — read this before editing any command

`commands/bead-loop.md` **§0** is the single source of truth for the
`auto-ok` / `auto-partial` / `needs-human` rules. The other commands point at it and
**never copy it**.

Those three labels are this extension's swimlanes: `src/webview/lib/board-swimlanes.ts`
groups the board's columns by them, and a bead carrying none of the three falls into the
`unlabeled` lane with a warning flag. So "an unclassified bead" is not an agent's internal
bookkeeping — it shows up as a red lane in the UI.

The rules that come with it: **never infer a label from a title**, a new label must carry a
measurable reason written into that bead's own notes, and anything you cannot measure is
`needs-human`.

## Three runtime surfaces that have to stay in sync

The same command set exists in three places, as **real files, not symlinks**:

```
.claude/commands/<name>.md          # the canonical copy; uses $ARGUMENTS
.cursor/skills/<name>/SKILL.md      # frontmatter is name + description + disable-model-invocation
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

Codex custom prompts under `.codex/prompts/` are deprecated. Codex loads the shared
repository skills from `.agents/skills/` and invokes them as `$bead-take`, `$bead-loop`,
and so on.

Check every command and skill file before committing:

```bash
python3 - <<'PY'
import glob, yaml
for f in sorted(glob.glob('.claude/commands/*.md') + glob.glob('.cursor/skills/*/SKILL.md')
                + glob.glob('.agents/skills/*/SKILL.md')):
    try: yaml.safe_load(open(f, encoding='utf-8').read().split('---')[1]); print('OK  ', f)
    except Exception as e: print('FAIL', f, e)
PY
```

The deliberate differences between the three copies (preserve them when adding a command):

- Cross-references point inside **their own** directory; never across.
- `.claude` names skills in full, `superpowers:<skill>`; the other two paraphrase to
  "the `<skill>` skill if your environment has one".
- `.claude` may name harness tools directly (`EnterWorktree`, `ScheduleWakeup`, `TodoWrite`,
  the `Explore` / `general-purpose` agent types) and may use the `[Unverified]` label. The
  other two describe the capability generically, because the harness is different there.
- Everything is written in **English** — this command set is used internationally.

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

The default profile is **conservative**: a command reports the files it changed plus the
suggested commit commands, and **never** runs `git push` or `bd dolt push` itself. See
`CLAUDE.md`, "Agent Context Profiles".
