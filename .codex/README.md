# `.codex/` — Codex integration for the Beads workflow

This directory contains Codex-specific configuration. The reusable repository skills live
in `.agents/skills/`, which is the current Codex Agent Skills discovery path.

## Layout

| Path | Purpose |
|---|---|
| `.agents/skills/beads/SKILL.md` | Baseline Beads task-tracking workflow; `allow_implicit_invocation: true`. |
| `.agents/skills/bead-*/SKILL.md` | Five explicit Beads workflows: split, take, loop, fleet, and audit. |
| `.agents/skills/bead-*/agents/openai.yaml` | Codex UI metadata and `allow_implicit_invocation: false`. |
| `.codex/hooks.json` | Runs `bd codex-hook` on session, prompt, and compaction events. |
| `.codex/config.toml` | Enables Codex hooks. |

The deprecated `.codex/prompts/` format is intentionally not used. Repository custom
prompts are not the supported shared-skill mechanism; `.agents/skills/` is.

## Invocation

Codex discovers repository skills while running inside this repository. Use `$` to select
one explicitly, or open `/skills`:

```text
$bead-split docs/plan.md
$bead-take beads-123
$bead-loop --dry-run
$bead-fleet --batch 3
$bead-audit epic-123
```

All five workflow skills set `allow_implicit_invocation: false` in `agents/openai.yaml`
because they write to the real Beads board or create worktrees, so Codex must not select
them on its own. The baseline `$beads` skill sets it to `true` on purpose: its description is
written as a trigger, and it has to stay in the model's context for ordinary issue tracking.
The field defaults to `true` when omitted, so the value is spelled out on all six files
rather than left implicit — do not copy `false` onto the baseline.

## Workflows

| Skill | Use it when | Writes to the board? |
|---|---|---|
| `$bead-split` | Turn a markdown spec, plan, or roadmap into an epic and classified child tasks | Only with `--apply` |
| `$bead-take` | Claim and implement one specific bead in an isolated worktree | Yes |
| `$bead-loop` | Pick and deliver one ready self-workable bead | Yes |
| `$bead-fleet` | Coordinate several independent `auto-ok` beads in parallel | Yes |
| `$bead-audit` | Re-measure completion claims and reconcile the board against the repo | Yes, coordinator only |

The normal order is `$bead-split` → `$bead-loop` (or `$bead-fleet`) → `$bead-audit`.

## Classification contract

`.agents/skills/bead-loop/SKILL.md` is the source of truth for `auto-ok`,
`auto-partial`, and `needs-human`. Other skills reference it instead of duplicating the
contract. Never infer a label from a title. Every classification requires measurable
reasoning in the bead's own notes; uncertainty means `needs-human`.

## Runtime copies

The same five workflows have runtime-specific entry points:

```text
.claude/commands/<name>.md
.cursor/skills/<name>/SKILL.md
.agents/skills/<name>/SKILL.md
```

Keep their behavior aligned while preserving runtime syntax:

- Claude commands use `$ARGUMENTS`.
- Cursor skills use Cursor frontmatter and `.cursor` cross-references.
- Shared Agent Skills use `name` + `description`, `$skill-name` invocation, generic harness
  wording, and `.agents/skills` cross-references.

Validate all entry points:

```bash
python3 - <<'PY'
import glob, yaml
files = (
    glob.glob('.claude/commands/*.md')
    + glob.glob('.cursor/skills/*/SKILL.md')
    + glob.glob('.agents/skills/*/SKILL.md')
    + glob.glob('.agents/skills/*/agents/openai.yaml')
)
for path in sorted(files):
    try:
        text = open(path, encoding='utf-8').read()
        data = yaml.safe_load(text) if path.endswith('.yaml') else yaml.safe_load(text.split('---')[1])
        assert isinstance(data, dict)
        print('OK  ', path)
    except Exception as error:
        print('FAIL', path, error)
PY
```

## Git policy

The default profile is conservative. Skills report changed files and suggested commands;
they do not push code or run `bd dolt push` unless the user explicitly requests it.
