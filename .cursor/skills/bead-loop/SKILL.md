---
name: bead-loop
description: Loops the beads board one ready auto-workable issue at a time, claiming it and delivering it with measured evidence. Use when the user runs /bead-loop or asks to work through the beads board one self-workable task at a time.
disable-model-invocation: true
---
<!-- beads-pm-kit v0.1.0 skill:bead-loop surface:cursor -->

# bead-loop

You are running one round of `/bead-loop`. **The parameters are the text the user typed
after the command** (`[--include-partial] [--dry-run]`).

**One round = ONE bead.** When it is done, end the turn; do not take a second bead in the
same round — a ballooning context is the surest way to make the next round misread the board.

## 0. Classification labels — the single source of truth

Every non-epic bead on the board must carry exactly one of these three labels (assigned
from that bead's description + notes + acceptance, with the measurable reason recorded in
its notes):

| Label | Meaning | What the loop may do |
|---|---|---|
| `auto-ok` | Every closing condition is reachable with code + tests inside the repo | Do all of it, **may** `bd close` |
| `auto-partial` | The code part is doable in the repo, but the closing bar needs an external resource (real CI green, a real environment) | Do the code part, **do NOT** `bd close` — stop at `--append-notes` |
| `needs-human` | The closing bar needs a person: real infrastructure, human-role credentials, external cost, a third party, a multi-hour soak, or a decision from the user | **Do not touch it** |

**A bead carrying none of those three labels is UNCLASSIFIED, not "self-workable".** When
you hit one, stop and report it; never infer the label from the title — unmeasured is not
zero. A new label must come with a measurable reason written into that bead's own notes.

## 1. Pick the bead

Substitute this round's exact parameter string for `<args>`. Four details have been
measured, and dropping any one of them makes the script wrong **silently**:

- `ARGS=` must arrive through the **environment** — a `python - <<PY` heredoc receives no
  `sys.argv`, so without it `--include-partial` becomes a no-op that reports nothing.
- **Never write the board to `/tmp`.** Git Bash maps `/tmp` onto `%TEMP%`, while Python on
  Windows reads `/tmp` as `C:\tmp` — `bd … > /tmp/board.json` succeeds and then Python
  raises `FileNotFoundError` on the very next line. Reading `bd` through `subprocess`
  settles it.
- **Candidates must come from `bd ready`, not `bd list`.** `bd list` knows nothing about
  dependencies: measured on a real board, a filter built on `bd list` picked an `open`
  bead with the right label and no assignee while another bead was blocking it — wrong
  dependency order, reported by nothing. `bd ready` is the only blocker-aware option (its
  own help: "Excludes in_progress, blocked, deferred, and hooked issues").
- **`bd ready --label-any` does NOT filter** — measured: it returns beads that do not
  carry the requested label at all, `needs-human` ones included. The AND form
  `--label <x>` does work. Because `--include-partial` needs an OR of two labels, **filter
  the labels in Python** — one code path, not one that depends on a flag measured to be
  broken. Do not "optimise" it back to `--label-any` without re-measuring on the `bd`
  version in use.

```bash
ARGS="<args>" PYTHONIOENCODING=utf-8 python - <<'PY'
import json,os,subprocess
def bd(*a):
    r=subprocess.run(['bd',*a],capture_output=True,text=True,encoding='utf-8')
    if r.returncode: print('bd %s failed rc=%d'%(' '.join(a),r.returncode),r.stderr[:400]); raise SystemExit(1)
    return json.loads(r.stdout)
CLS={'auto-ok','auto-partial','needs-human'}
# (1) The "unclassified" guard must read the WHOLE board: bd ready deliberately hides in_progress/blocked/deferred.
alls=bd('list','--all','--json')
non=[i for i in alls if i['status'] in ('open','in_progress','deferred','blocked') and i['issue_type']!='epic']
unlabeled=[i['id'] for i in non if not (set(i.get('labels') or []) & CLS)]
if unlabeled: print('STOP - unclassified beads:',unlabeled); raise SystemExit(1)
# (2) Candidates: bd ready is blocker-aware; --exclude-type/--unassigned are MEASURED to work.
want={'auto-ok'} | ({'auto-partial'} if '--include-partial' in os.environ.get('ARGS','') else set())
ready=bd('ready','--json','--exclude-type','epic','--unassigned','-n','0')
c=[i for i in ready if set(i.get('labels') or []) & want]
c.sort(key=lambda x:(x['priority'],x['id']))
# (3) Right label but BLOCKED: print them. Never let them vanish silently ("no silent caps").
rid={i['id'] for i in ready}
held=[i['id'] for i in non if (set(i.get('labels') or []) & want) and i['id'] not in rid
      and i['status']=='open' and not (i.get('assignee') or '')]
if held: print('BLOCKED (right label, not ready):',held)
if not c: print('NO WORK LEFT'); raise SystemExit(0)
i=c[0]; print('PICK',i['id'],'P%d'%i['priority'],sorted(set(i['labels'])&CLS),i['title'])
print('REMAINING',len(c)-1,[x['id'] for x in c[1:]])
PY
```

Five filter conditions, all of them load-bearing:

- **No open blocker** — `bd ready` handles this. It is the easiest one to forget, because
  a blocked bead looks *exactly* like a free one in `bd list`.
- `status == 'open'` — excludes `in_progress` (another session or agent is on it),
  `deferred` (deferred **on purpose**; un-deferring is the user's decision), and
  `blocked`. `bd ready` already drops all four; the "unclassified" guard still has to read
  `bd list --all` itself, because it needs to see **every** active bead, including the ones
  `ready` deliberately hides.
- `assignee` empty — a bead someone already claimed is off limits **regardless of label**
  (a `needs-human` bead can still be claimed in another worktree or on another machine).
- `issue_type != 'epic'` — an epic is a container, closed when its children are; it is not
  implementation work. Never `/bead-take` an epic.
- Carries a label in `want` — `auto-ok` only, by default. Filter it in Python (see above).

The `BLOCKED` line is not decoration: it is the only way to tell "no work left" apart from
"there is work, but it is queued behind another bead". `NO WORK LEFT` alongside a long
`BLOCKED` list means you should work the blocking bead, not stop the loop.

`NO WORK LEFT` → stop the loop:
- Inside the harness's automatic loop mode: stop the loop the way that harness expects;
  do not schedule another round.
- Report how many `auto-partial` and `needs-human` beads remain **with the reason for each
  one** (read the notes), so the user knows exactly what is waiting on them — never a bare
  count.

`--dry-run` → print the bead you would pick, then stop: no claim, no changes.

## 2. Work the bead

Invoke the `bead-take` skill with the id you picked. It already carries the whole
procedure: read `bd show` closely (the closing conditions are in the NOTES, and the
latest RE-MEASURE note beats the description), a dedicated worktree branched from
`<BASE>` (the project's integration branch — defined in `bead-take`), TDD or
systematic-debugging depending on the bead type, measure before changing, `git commit
--only <path>`, close with evidence.

Four things `/bead-loop` adds on top, for loop mode only:

1. **An `auto-partial` bead may not be `bd close`d.** Finish with
   `bd update <id> --append-notes "RE-MEASURE <date> (HEAD <sha>): <what you did, which commit, what is still missing and WHY it needs a person>"`.
   Closing it converts "not measured" into "passed" — the exact opposite of why it was
   classified that way.
2. **Commit the code BEFORE `bd close`.** Whether `bd close` generates its own commit by
   sweeping the working tree depends on each repo's `bd` configuration; it is not a
   contract `bd` guarantees. Committing first is *cheap and harmless*, while assuming the
   opposite costs you a wrong commit before you notice.
3. **Never `git push`, never `bd sync` on your own.** Conservative profile: report the
   suggested commands and let the user run them.
4. **Working several beads in one round is an exception, only on the user's request** — and
   then it is one worktree per bead
   (`git worktree add -b work/bead-<id> ../wt-<id> <BASE>`; `git worktree add … <BASE>`
   **without** `-b` is refused by git when that branch is checked out in the main tree).
   Two measurements for this mode: `bd` **reads** correctly from a worktree — it resolves
   the board through `.beads/metadata.json`, a **tracked** file, so the worktree has it,
   and it returns the real board; but **concurrent writes** from several worktrees have not
   been measured, so keep every `bd update` / `bd close` in **one** place (the main tree),
   run by the coordinating session.

## 3. Work discovered along the way

`bd create` immediately, with `--parent <epic>` **and** a classification label plus its
measurable reason. No todo tool, no markdown checkboxes, and no widening the scope of
the bead you are on.

The board has an invariant: **every active bead traces up to an epic**. If no existing
epic fits a new bead, create one — do not park it in an unrelated "general debt" epic.
Check the invariant:

```bash
PYTHONIOENCODING=utf-8 python - <<'PY'
import json,io,subprocess
d=json.loads(subprocess.run(['bd','list','--all','--json'],capture_output=True,text=True,encoding='utf-8').stdout)
by={i['id']:i for i in d}
def anc(i):
    out=[];cur=i;seen=set()
    while (p:=cur.get('parent')) and p not in seen:
        seen.add(p);out.append(p);cur=by.get(p) or {}
    return out
bad=[i['id'] for i in d if i['status']!='closed' and i['issue_type']!='epic'
     and not any(by.get(c,{}).get('issue_type')=='epic' for c in anc(i))]
print('NO EPIC:',bad or 'none')
PY
```

## 4. End-of-round report

One short block, then end the turn:

- the bead you worked, and its label
- the files you changed
- the verify command you ran plus its **real exit code** (`rc=0` with no output is a
  failure signal, not a pass; `rc=$?` belongs to the LAST command in a pipe — do not read
  `tail`'s)
- **the test verdict read from machine-readable output, not from the summary line.**
  Measured on Windows/Git Bash: a runner's final summary line **is cut** from captured
  output, so an empty `grep passed` does **not** mean red, and `rc=0` alone does **not**
  prove any test ran. Two approaches measured to work: emit a machine-readable report
  (`--junitxml=<file>` for pytest, `--reporter=json` or equivalent for other runners) and
  read the `tests/failures/errors/skipped` counts, or count the progress characters on the
  progress lines. Also: **read the test runner's config before adding a flag** — a flag
  that conflicts with existing config (say, disabling a plugin while `addopts` still
  passes that plugin's options) kills the runner before a single test runs.
- whether the bead was `close`d or only `append-notes`d, and why
- how many `auto-ok` beads are left in the queue
- the suggested commit/push commands (do not run them)
