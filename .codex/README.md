# `.codex/` — the beads workflow for Codex

The Codex copy of five prompts that close one loop over the beads board:
split → take → loop → run in parallel → audit.

## What is in here

| File | Contents |
|---|---|
| `prompts/<name>.md` | The prompt behind `/<name>`. Frontmatter is `description` + `argument-hint`; the body does **not** use a `$ARGUMENTS` variable — it spells it out: "the parameters are the text the user typed after the command". |
| `hooks.json` | Four hooks calling `bd codex-hook <event>`: `SessionStart` (startup\|resume\|clear), `UserPromptSubmit`, `PreCompact`, `PostCompact` — loading and refreshing beads context. |
| `config.toml` | `[features] hooks = true`, which enables the hooks above. |

Project-level loading is confirmed: the maintainer verified on 2026-08-19 that the Codex CLI
picks these prompts up from `.codex/prompts/` in this repo, so no copy into
`~/.codex/prompts/` is needed.

## The five prompts

| Command | Use it when | Writes to the board? |
|---|---|---|
| `/bead-split <file.md \| dir> [--apply] [--epic <id>] [--section "<h>"]` | A spec, plan or roadmap lives in markdown and needs to become an epic + tasks | **No**, unless `--apply` |
| `/bead-take <bead-id> [extra notes]` | Take exactly one bead, work it in a dedicated worktree, close it with evidence | Yes |
| `/bead-loop [--include-partial] [--dry-run]` | Each round picks exactly ONE workable bead and delivers it | Yes |
| `/bead-fleet [--batch N] [--include-partial] [--unattended]` | Several independent `auto-ok` beads, run in parallel, one worktree each | Yes |
| `/bead-audit [epic-id \| label \| bead-ids…]` | You suspect "already done" is not true: fan out agents to re-measure, then settle the debt centrally | Yes (main loop only) |

The usual order: `/bead-split` → `/bead-loop` (or `/bead-fleet`) → `/bead-audit`.

## The label contract — read this before editing any prompt

`prompts/bead-loop.md` **§0** is the single source of truth for the
`auto-ok` / `auto-partial` / `needs-human` rules. The other prompts point at it and **never
copy it**.

Those three labels are this extension's swimlanes: `src/webview/lib/board-swimlanes.ts`
groups the board's columns by them, and a bead carrying none of the three falls into the
`unlabeled` lane with a warning flag. An unclassified bead shows up as a red lane in the UI;
it is not an agent's internal bookkeeping.

The rules that come with it: **never infer a label from a title**, a new label must carry a
measurable reason written into that bead's own notes, and anything you cannot measure is
`needs-human`.

## Three mirrors that have to be edited together

The same prompt set exists in three places, as **real files, not symlinks**:

```
.claude/commands/<name>.md          # the canonical copy; uses $ARGUMENTS
.codex/prompts/<name>.md            # this one
.cursor/skills/<name>/SKILL.md      # frontmatter is name + description + disable-model-invocation
```

The `.codex` and `.cursor` bodies are nearly identical; measured: `bead-take` and
`bead-audit` were byte-for-byte the same, and `bead-loop` and `bead-fleet` differed only in
the cross-reference paths. Preserve those differences when adding a prompt:

- Cross-references point at `.codex/prompts/…`, never across into `.claude` or `.cursor`.
- Refer to a sibling as "the `<name>` process" (the `.cursor` copy says "skill").
- Paraphrase superpowers skills as "the `<skill>` skill if your environment has one" rather
  than using the `superpowers:<skill>` name the `.claude` copy uses.
- Describe harness capabilities generically — "the harness's automatic worktree tool", "a
  read-only subagent", "a todo tool" — because the harness differs here.
- Everything is written in **English**; this prompt set is used internationally.

Editing one copy and forgetting the other two is how bugs survive longest in this repo.
Check the frontmatter of all fifteen files before committing:

```bash
python3 - <<'PY'
import glob, yaml
for f in sorted(glob.glob('.claude/commands/*.md') + glob.glob('.cursor/skills/*/SKILL.md') + glob.glob('.codex/prompts/*.md')):
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

And one that hurts especially on Codex under Windows/Git Bash: **never write temp files to
`/tmp`**. Git Bash maps `/tmp` onto `%TEMP%` while Python reads `/tmp` as `C:\tmp`, so
`bd … > /tmp/board.json` succeeds and then raises `FileNotFoundError` on the very next line.
Write into `.beads/`, or read `bd` through `subprocess`.

## Git

The default profile is **conservative**: a prompt reports the files it changed plus the
suggested commit commands, and **never** runs `git push` or `bd dolt push` itself. See
`AGENTS.md`, "Agent Context Profiles".
