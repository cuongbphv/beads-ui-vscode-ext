# Troubleshooting

Four states are degraded on purpose. [`src/extension/extension.ts:4`](../src/extension/extension.ts)
names them at the top of activation — *no workspace folder, no `.beads` directory, no `bd` on
`PATH`, or a `bd` that runs but refuses* — and the rule attached to them is that none of the four
may throw out of `activate()`, because that leaves the view container empty with nothing to read.

So the extension is never *broken* in these states; it is idle, or it is showing you the last thing
it knew plus a message. This page says which of the four you are in, what the code does about it on
its own, and what you have to do.

Everything below is anchored to the code path that produces it. `Beads: Show bd Output Log` is the
same log in all four cases.

## Which one is it?

| What you see | State |
|---|---|
| "No beads workspace detected here." in the sidebar, and `Beads: Open Dashboard` answers with a warning instead of a panel | [No workspace folder](#no-workspace-folder) or [no `.beads` directory](#no-beads-directory) |
| `Beads: Could not run "bd"…` with an **Open Settings** button | [`bd` is not on your PATH](#bd-is-not-on-your-path) |
| `Beads: no beads database found` with a **Show Log** button | [No `.beads` directory](#no-beads-directory) — bd's own verdict |
| Any other `Beads:` / `bd:` error with a **Show Log** button | [`bd` runs but refuses](#bd-runs-but-refuses) |
| The board still has issues on it, but the status bar shows ⚠ Beads | [`bd` runs but refuses](#bd-runs-but-refuses) — the last good snapshot is being kept |

## No workspace folder

**What you see.** The **Epics & Milestones** view shows the welcome content contributed for
`beadsDashboard.tree` — *"No beads workspace detected here. This folder has no `.beads` directory,
or the `bd` CLI is not on your PATH."* with **Open the Beads Dashboard** and **Check Setup** links
(`package.json:77-82`). `Beads: Open Dashboard` answers with a warning toast instead of a panel:
*"No .beads directory found in this workspace. Run `bd init` in a terminal first."*
([`extension.ts:32-36`](../src/extension/extension.ts)). The extension declares one activation
event, `workspaceContains:.beads` (`package.json:44-46`), so in a window with nothing matching it
there may be no `bd` activity to see at all.

**Why it happens.** `findBeadsFolders()` reads `vscode.workspace.workspaceFolders ?? []`
([`workspace.ts:22`](../src/extension/workspace.ts)). With no folder open that list is empty, there
are no candidates, and `resolveBeadsFolder` returns `undefined`
([`workspace.ts:38`](../src/extension/workspace.ts)).

**What the extension does.** It stops before constructing anything
([`extension.ts:26-41`](../src/extension/extension.ts)): no store, no tree, no `bd` process, no
polling. It sets the `beadsDashboard.hasWorkspace` context key to `false`, registers exactly two
commands so that `Beads: Open Dashboard` and `Beads: Show bd Output Log` give you a real message
rather than "command not found", writes `No workspace folder contains a .beads directory — staying
idle.` to the output channel, and returns.

**How to fix it.** Open a folder that has a `.beads` directory in it. The folder is resolved once,
at activation ([`extension.ts:26`](../src/extension/extension.ts)), and nothing listens for
workspace folders being added afterwards — so run **Developer: Reload Window** after adding one to a
window that is already open.

## No `.beads` directory

**What you see.** The same two things as above — the welcome content and the warning toast — because
both causes land in the same branch. There is a second, later face of this state: if a `.beads`
directory exists but `bd` cannot open a database in it, the first refresh fails and you get an error
toast reading `Beads: no beads database found` with a **Show Log** button
([`extension.ts:153-163`](../src/extension/extension.ts)).

**Why it happens.** `hasBeadsDir` stats `<folder>/.beads` and requires the result to *equal*
`FileType.Directory`; any error is swallowed and read as "not here"
([`workspace.ts:12-19`](../src/extension/workspace.ts)). A file named `.beads`, a path the editor
cannot stat, or a `.beads` that is not exactly a directory all count as absent. If your `.beads` is
a symlink and the folder is not being detected, that strict equality is the first place to look.

For the later face: `bd` exits non-zero and prints its own explanation, and `classify()` matches the
wording — *no beads database*, *no embedded database*, *not a beads*, *no .beads*, or any message
mentioning `bd init` — onto the `no-workspace` error kind
([`BdService.ts:121-129`](../src/extension/bd/BdService.ts)). Matching on text is deliberate and
documented there: bd exits `1` for every refusal, so the exit code cannot tell "you have no
workspace" from "that status does not exist". The fixture strings are pinned against real bd 1.1.2
output in [`src/test/degradation.test.ts:47-83`](../src/test/degradation.test.ts), so a wording
change fails a test instead of silently downgrading to a generic error.

**What the extension does.** Same as the state above when the directory is missing at activation
time. When it is bd that refuses, the failure is logged with its kind, message and raw stderr
([`store.ts:221-227`](../src/extension/store.ts)) and the last good snapshot — if there was one —
stays on screen.

**How to fix it.** Run `bd init` in the folder you want tracked, then reload the window. In a
multi-root workspace, `Beads: Select Beads Folder…` switches between the folders that do have one
([`workspace.ts:64-96`](../src/extension/workspace.ts)); it tells you when there is nothing to pick
rather than showing a one-item list, and reloads the window on your confirmation so every view
picks the new folder up ([`extension.ts:117-129`](../src/extension/extension.ts)).

## `bd` is not on your PATH

**What you see.** An error toast — *Could not run "bd". Install the beads CLI, or set
`beadsDashboard.bdPath` to its full path.* — with an **Open Settings** button that lands directly on
`beadsDashboard.bdPath` ([`extension.ts:157-160`](../src/extension/extension.ts)). Alongside it:
the **Epics & Milestones** view carries the description `bd unavailable`
([`extension.ts:146`](../src/extension/extension.ts)), the tree collapses to a single error row
([`BeadsTreeProvider.ts:158-159`](../src/extension/tree/BeadsTreeProvider.ts)), the status bar item
becomes `⚠ Beads` with the message as its tooltip
([`status-bar.ts:46-51`](../src/extension/status-bar.ts)), and the dashboard shows the message as an
alert plus one extra line: *Set `beadsDashboard.bdPath` in settings if bd is installed somewhere
unusual.* ([`App.tsx:212-227`](../src/webview/App.tsx)).

**Why it happens.** `BdService` spawns `beadsDashboard.bdPath`, defaulting to plain `bd`
([`BdService.ts:147`](../src/extension/bd/BdService.ts)), and `execFile` raises `ENOENT` when that
name resolves to nothing. The `PATH` being searched is the editor's own environment — the spawn
inherits `process.env` ([`BdService.ts:226`](../src/extension/bd/BdService.ts)) — which is not
necessarily your login shell's. `bd` working in a terminal is therefore not proof that the editor
can see it.

**What the extension does.** It retries once through a shell before believing you
([`BdService.ts:220-249`](../src/extension/bd/BdService.ts)): on Windows an npm-installed `bd` is a
`.cmd` shim that `execFile` cannot launch directly. If the shell retry works, the answer is
remembered so later calls skip the failed attempt. If the shell also reports the command missing —
exit `127`, exit `9009`, "command not found", "is not recognized as an internal or external
command", "is not recognized as the name of a cmdlet"
([`BdService.ts:103-111`](../src/extension/bd/BdService.ts)) — the original `ENOENT` is re-thrown
rather than the shell's wording, and becomes the `bd-not-found` error kind with the message above
([`BdService.ts:193-201`](../src/extension/bd/BdService.ts)). `bd-not-found` is the only kind that
gets **Open Settings** instead of **Show Log**, because the fix is a setting.

**How to fix it.** Install the [`bd` CLI](https://github.com/steveyegge/beads) and make sure the
editor can see it, or set `beadsDashboard.bdPath` to the absolute path of the binary — the button on
the toast opens that setting.

Then **reload the window**. `bdPath` is read once, when the store is constructed at activation
([`store.ts:117-121`](../src/extension/store.ts)), and the settings listener only reacts to
`pollIntervalSeconds` and `issueLimit` ([`store.ts:143-146`](../src/extension/store.ts)) — so
`Beads: Refresh` on its own will keep spawning the old path.

## `bd` runs but refuses

**What you see.** An error toast carrying bd's own sentence, with a **Show Log** button — `Beads: …`
when the first refresh on activation failed
([`extension.ts:157-163`](../src/extension/extension.ts)), `bd: …` when a quick action failed
([`commands.ts:28-39`](../src/extension/commands.ts)). The status bar switches to `⚠ Beads`
([`status-bar.ts:46-51`](../src/extension/status-bar.ts)) and the dashboard shows the message as an
alert ([`App.tsx:212-219`](../src/webview/App.tsx)). Typical sentences: an unknown status name, an
issue id that does not exist, a routing misconfiguration.

**Why it happens.** bd ran, understood the request, and said no. The message is pulled out of
whatever bd printed: bd is not consistent about it — verified on 1.1.2, `bd ready --json` emits a
JSON object with an `error` key while `bd list --json` emits a plain `Error: …` line — so both
shapes are parsed into the same result ([`BdService.ts:66-93`](../src/extension/bd/BdService.ts)).
Anything whose wording is not one of the no-workspace phrases becomes the `bd-error` kind
([`BdService.ts:128`](../src/extension/bd/BdService.ts)). A close relative is `bad-output`: bd
succeeded but printed something that is not JSON, which is reported as such with the first 2000
characters kept for the log rather than crashing
([`BdService.ts:155-163`](../src/extension/bd/BdService.ts)).

**What the extension does.** It keeps the board up. A failed refresh sets the error but does not
clear the snapshot, so a transient failure does not blank what you were looking at
([`store.ts:221-227`](../src/extension/store.ts)); the tree only degrades to a bare error row when
there was never a snapshot to keep
([`BeadsTreeProvider.ts:158-161`](../src/extension/tree/BeadsTreeProvider.ts)). Every invocation is
logged with its argv and duration, and every failure with its exit code and message
([`BdService.ts:186-212`](../src/extension/bd/BdService.ts)). Failures of the background change
probe are logged and otherwise ignored — `refresh()` owns error reporting, and a transient failure
must not spam the log or blank the board every tick
([`store.ts:258-264`](../src/extension/store.ts)).

**How to fix it.** Open `Beads: Show bd Output Log`, take the argv from the `FAILED` line, and run
that exact command in a terminal in the same folder. bd's own output says what it objected to.
Status vocabulary is the usual answer: this extension derives columns from your project's own status
*categories* at runtime and never hardcodes a vocabulary, so a status bd does not recognise came
from somewhere else.

## Error kinds, end to end

Every failure below `bd` is normalised into one `RpcError` so that the toast, the tree, the status
bar and the webview all say the same thing. The kinds are defined in
[`src/shared/protocol.ts:139-149`](../src/shared/protocol.ts):

| Kind | Means | Where it comes from |
|---|---|---|
| `bd-not-found` | `bd` is not installed or not on `PATH` | `ENOENT`, after the shell retry failed too |
| `no-workspace` | No `.beads` database — nobody has run `bd init` | bd's own wording, matched by `classify()` |
| `bd-error` | bd ran and refused | any other non-zero exit |
| `bad-output` | bd printed something we could not parse | `JSON.parse` failed |
| `unknown` | anything else | `toRpcError` fallback |

## Still stuck

`Beads: Show bd Output Log` records every argv and every failure. Paste the relevant lines into an
issue together with your `bd --version`, editor and OS — the bug template asks for exactly that. See
[CONTRIBUTING.md](../CONTRIBUTING.md#reporting-a-bug).
