<p align="center">
  <img src="https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/media/icon.png" alt="Beads Dashboard" width="128" />
</p>

<h1 align="center">Beads Dashboard for VS Code</h1>

<p align="center">
  Kanban, roadmap and epic tracking for the <a href="https://github.com/steveyegge/beads">Beads</a> git-native issue tracker — inside your editor.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" />
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.105-007ACC" alt="VS Code ^1.105" />
</p>

<p align="center">
  <b>English</b> | <a href="https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/README.vi.md">Tiếng Việt</a> | <a href="https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/README.zh-cn.md">中文</a>
</p>

---

![Beads Dashboard: the sidebar, the roadmap, dragging a card across the board, and the board updating itself when an agent files and starts an issue from the terminal](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/demo.gif)

> The last few seconds are the point: nothing is clicked. An agent runs `bd create`
> and `bd update` outside the editor, and the board follows on its own.

## What it does

Beads Dashboard reads your local beads database through the `bd` CLI and renders it six ways:

- **Overview** — totals, a status breakdown, epic progress, and the two lists that matter on
  arrival (what is ready to start, with inline Claim and Show more, and what is blocked), plus an on-demand **Project health**
  drawer: press "Run checks" for stale/orphaned/lint/dependency-cycle tiles, each degrading on
  its own instead of blanking the other three, with a drill-down into each check's findings.
- **Roadmap** — Epic → Task drill-down with progress bars and per-epic counts. A shape toggle
  swaps the same data into **Graph** view: an issue's blocked-by dependencies as a dependency
  DAG, auto-laid-out, draggable node by node, and — in **Link mode** — click two nodes to add a
  dependency edge between them (a rejected cycle surfaces as a toast, never a crash).
- **Board** — a kanban board whose columns are derived from your project's status *categories* at
  runtime. Filter to Beads' native Ready set or claim the selected ready issue, drag a card to change its status, toggle swimlanes to group the columns by taxonomy
  label (`auto-ok` / `auto-partial` / `needs-human`), or use a column's "+ Add issue" row to
  create one directly in that status.
- **Molecules** — a viewer onto `bd mol`: the running molecules as cards, a detail view with its
  step list, parallel groups and gate badges, a wisp strip with a heuristic TTL countdown, and
  gate cards with an inline Resolve action for gates a human can clear. View-only by design — no
  pour/wisp/burn/squash/bond from the UI.
- **Fleet** — Claude Code and Codex sessions against this workspace, their worktrees and branches,
  and (click a worker) its live transcript. See
  [Fleet monitor](#fleet-monitor) below.

Every issue can be created, edited and linked without leaving the editor: a **Create Issue…**
command (palette or the sidebar's plus-button), a full create form in the detail-pane slot, and
board quick-add all produce a real issue; the detail pane's title, description and other text
fields edit inline with a save/cancel affordance; labels add and remove as chips; dependencies
add and remove from an issue picker or from Graph link mode; and **Defer / Undefer / Close /
Reopen** cover the rest of an issue's lifecycle.

Plus an **Epics & Tasks** sidebar with a "Needs You" section — open gates alongside your assigned
issues, each with an inline Resolve action — and quick actions (status, priority, assignee, claim,
close, reopen) available from the tree, the board and the detail pane, all three converging on the
same result. A board card and a Fleet worker row both carry a lease/claim liveness badge (live /
stale heartbeat / expired) whenever `bd` reports lease data for a claim, and render nothing on the
common case where it does not. A detail pane also shows a **blocker inspector** (the full
transitive "Blocked by" chain, not just direct blockers) and a **Change history** timeline built by
diffing consecutive committed `bd history` revisions; recent uncommitted edits may be absent. The
header shows the last successful refresh and marks retained data stale if the backend fails. Once a workspace grows past `beadsDashboard.issueLimit`,
the board's search box falls back to a server-side `bd search` so issues outside the loaded window
are still findable.

A read-only **sync status** chip on the Overview header reports `bd dolt status` (mode, and
ahead/behind counts when `bd` provides them) and offers a "copy suggested sync command" button —
it copies the command to your clipboard and never runs `bd dolt push`/`pull` itself. An opt-in
**notifications** setting can toast when a gate opens ("N gate(s) need you.") or, one step further,
when an issue assigned to you becomes blocked — off by default, and each gate/issue notifies at
most once per window session.

Everything is read and written through `bd --json`. The extension never reads `.beads/issues.jsonl`
or the Dolt files directly — that export has auto-refresh off by default, and upstream declares
direct readers incompatible.

## See it in action

Every shot below is a real editor against the same mid-flight demo project — five
epics, 54 issues, four people and an agent. It is generated, not curated: `npm run
capture:demo` seeds it and re-takes every image.

**Overview** — totals, status split, priority mix, workload per person, and a
burn-up of everything closed so far:

![Overview tab: 54 issues, 18 ready, 7 blocked, 2 overdue, a 29% done donut, priority and issue-type breakdowns, a rising burn-up over seven weeks, and workload per assignee](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview.png)

**Overview, sync status and health checks** — both the header's sync-status chip
and the **Project health** drawer fetch nothing until you act: this is the chip
right after a manual Refresh, and the drawer right after **Run checks**, not
either one's default empty state:

![Overview tab with the header's sync-status chip showing embedded mode after a manual refresh, and the Project health drawer expanded after Run checks showing Stale 2, Orphans 0, Lint 20 and Dep cycles 0](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview-health.png)

**Roadmap** — a real timeline with today marked, each epic carrying its own
progress count. Closed work is folded away behind a count you can click:

![Roadmap tab: five epics as Gantt rows with per-task bars across eleven weeks, a today line, and a "15 closed hidden — show" chip](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap.png)

**Board** — columns derived from your status *categories* at runtime, so a custom
status lands in the right column. Done starts folded:

![Kanban board with Open 23, In Progress 10, On Hold 4 and a folded Done 15; cards carry type, id, title, labels, priority, due date and assignee](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board.png)

**Board, swimlanes on** — the same board, one toggle away from grouped by taxonomy
label instead of one long column: `auto-ok`, `auto-partial` and `needs-human`, four
issues apiece in this project:

![Board with Swimlanes toggled on: three taxonomy lanes — auto-ok, auto-partial, needs-human — each showing 4 issues, columns still split by status inside every lane](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board-swimlanes.png)

**Graph** — an issue's blocked-by dependencies as a DAG. Nodes are dragged to a
preferred spot, nudged with the arrow keys, or sent back with **Reset layout**; blocked
issues are flagged red wherever they sit in the layout:

![Graph tab: a layered dependency DAG with several blocked issues outlined in red, zoom and reset-layout controls in the toolbar, and the sidebar's Gates(2) entry alongside it](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/graph.png)

**Molecules** — `bd mol` molecules as cards with live progress, and open gates
surfaced right alongside them:

![Molecules tab: a Gates (2) section listing two open human gates, and a molecule card for "ssepatch" showing 1/5 steps done (20%), an ETA, and its current step "Wire backoff into client"](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/molecules.png)

**Molecules, a step list expanded** — one molecule, five visually distinct step
states: done, current, ready, pending and gated:

![Molecule detail step list for "ssepatch" grouped into a parallel cluster: a Ready step tagged with a gate: human badge, an In progress step, another Ready step, and a Done step struck through, plus a Pending step outside the group blocked by one of the ready steps](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/molecules-detail.png)

**Fleet** — one orchestrator, one worker running against a real `wt-*` git
worktree, streamed straight from the same JSONL transcript Claude Code itself
writes. See [Fleet monitor](#fleet-monitor) below:

![Fleet tab: orchestrator demo-orc with one running worker on harbor-201, its spawn brief naming the bead and the wt-201 worktree path](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet.png)

**Fleet, a worker's transcript** — text and thinking blocks rendered through
the hand-rolled markdown renderer: headings, bold, inline code, a fenced code
block, and a `✓ PASSED` result, drawn as React elements, never
`dangerouslySetInnerHTML`:

![Fleet worker transcript: a Thinking chip, a Read tool call and its result, then an assistant summary with bold text, two inline-code file paths, a fenced ts code block, and a bold PASSED result line](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet-transcript.png)

**Detail pane** — the full issue without leaving the board. Status, priority and
assignee apply as you set them, and comments plus an append-only notes composer sit
below the fields, present even with zero comments so far:

![Detail pane for a blocked bug showing status and priority selects, an assignee field that applies on Enter, estimate, due date, parent epic, an Append note link, and what blocks it](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap-detail.png)

**Sidebar** — what needs you on top, then the plan. An open gate now outranks even
your own assigned issues, since it blocks real work until someone clears it:

![Sidebar with a Needs You section topped by a Gates(2) entry and a Resolve action, four issues assigned to you below it, then Epics & Milestones expanded to show child tasks with type icons and priorities; the status bar reads 17 ready and a shield icon with 2](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/sidebar-tree-expanded.png)

## Requirements

- The [`bd` CLI](https://github.com/steveyegge/beads) on your `PATH` (or set `beadsDashboard.bdPath`).
- A workspace whose database `bd context` can resolve. A local `.beads`, a worktree redirect,
  or `BEADS_DIR` can provide it; the header shows the resolved database location.

Something not behaving? [docs/TROUBLESHOOTING.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/docs/TROUBLESHOOTING.md) covers the four degraded states the
extension handles on purpose — no workspace folder, unresolved Beads database, no `bd` on your `PATH`,
and a `bd` that runs but refuses — what each one shows, why it happens, and how to clear it.

## Install

Search **Beads Dashboard** in the Extensions view, or:

```bash
code --install-extension cuongbphv.beads-dashboard
```

Using **Cursor**, **Windsurf** or **VSCodium**? Those cannot reach Microsoft's Marketplace, so the
same build is published to [Open VSX](https://open-vsx.org/) and their own Extensions view finds it.
Every release also carries a `.vsix` on the
[Releases page](https://github.com/cuongbphv/beads-ui-vscode-ext/releases) for offline install.

<details>
<summary>Build and install from source instead</summary>

```bash
npm install
npm run install:local     # build → package → install; then reload the window
```

`install:local` auto-detects `code`, `code-insiders`, `cursor`, `windsurf` or `codium`. Force one
with `npm run install:local -- --cli cursor`, or set `VSCODE_CLI`. To produce a `.vsix` without
installing it, pass `-- --skip-install`.

After it finishes: **Ctrl+Shift+P → "Developer: Reload Window"**, then open the Beads icon in the
Activity Bar.

</details>

## Settings

| Setting | Default | What it does |
|---|---|---|
| `beadsDashboard.bdPath` | `bd` | Path to the `bd` executable. |
| `beadsDashboard.defaultTab` | `overview` | Tab the dashboard opens on: `overview`, `roadmap`, `board`, `fleet` or `molecules`. |
| `beadsDashboard.issueLimit` | `2000` | Issues loaded per refresh. |
| `beadsDashboard.pollIntervalSeconds` | `5` | How often to check for changes made outside the editor. `0` disables it. |
| `beadsDashboard.showClosed` | `true` | Include closed issues in the board and tree. |
| `beadsDashboard.assignee` | `""` | Who you are, for **Needs You**. Empty means the identity `bd` itself would use. |
| `beadsDashboard.notifications` | `off` | Toast when a gate opens or (one step further) when your own issue becomes blocked: `off`, `gates` or `gates-and-blocked`. Opt-in — it only evaluates snapshots the dashboard already fetched, never spawns `bd` on its own. |

Changes made outside the editor — by an agent, a teammate, or your own terminal —
trigger a reload when the next active probe detects them. With Beads 1.3 and an
already-enabled events journal, the extension checks the effective journal setting
and reads `bd events tail` as JSON Lines. Otherwise it uses `bd list --limit 1`.
It also performs a full resync every 12 active probe ticks, since sync and raw SQL
writes are not journaled. Nothing is checked while every Beads view is hidden or
the window is in the background. Set `pollIntervalSeconds` to `0` to disable checks.
The extension never enables a journal or upgrades your database automatically.
See [Beads 1.3.1 compatibility](docs/BEADS-1.3.1.md) for verification and limits.

## Commands

| Command | Where |
|---|---|
| `Beads: Open Dashboard` | Palette, view title |
| `Beads: Create Issue…` | Palette, view title (the tree's plus-button) |
| `Beads: Refresh` | Palette, view title |
| `Beads: Show bd Output Log` | Palette — every argv and every failure lands here |
| Change status / priority / assignee, Claim, Close, Reopen, Copy ID | Tree context menu, detail pane |
| `Beads: Resolve Gate…` | Inline on a "Needs You" gate row (the Molecules tab's gate cards resolve the same way from inside the webview, not through this command) |

## Fleet monitor

The **Fleet** tab answers "what is my agent fleet doing to this workspace right now?" for
Claude Code and Codex sessions. It pairs discovered sessions and workers with git worktrees
and groups worktrees whose worker link is unknown as **Unassociated worktrees**. Click a worker or orchestrator to follow
its transcript live from the agent's own JSONL store. Text and thinking
render through a small hand-rolled markdown renderer — headings, lists, code fences, tables,
bold/italic, no third-party dependency — parsed to a plain-data AST and drawn as React elements
directly, never `dangerouslySetInnerHTML`; a transcript is an agent/tool-controlled channel, so
that renderer is the security boundary, not an afterthought.

![Fleet worker transcript: a Thinking chip, a Read tool call and its result, then an assistant summary with bold text, two inline-code file paths, a fenced ts code block, and a bold PASSED result line](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet-transcript.png)

Where the data comes from:

- **Sessions and workers** — Claude Code comes from `~/.claude/projects/<mangled-cwd>`;
  Codex comes from `~/.codex/sessions` (or `CODEX_HOME/sessions`). Both are matched to this
  workspace and their transcript paths stay inside their expected stores.
- **Worktrees and their git status** — `git worktree list --porcelain`, then `git status` /
  `git diff --numstat` per worktree, matched to a bead id from a worker's spawn brief when known.
  An unmatched worktree appears under **Unassociated worktrees — worker link unknown**; that label
  does not assert whether an agent is still working. ([#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11))
- **Discovery cadence** — a 5-second poll is the visible Fleet baseline. A filesystem watcher on
  Claude Code's `~/.claude/projects` store is a fast path when the OS reports a change sooner. The
  poll never goes away: a watcher is inherently best-effort (a fresh watcher can miss an event in
  the moment right after it starts watching — measured, not assumed, against a real Extension
  Development Host), so the worst case is exactly as fast as polling alone, never slower or silently
  stuck.
- **Degraded, not broken** — no `~/.claude/projects` on this machine, an empty one, a `git` that
  fails, or one bad worktree all render a clear empty state or an inline error instead of a crash or
  a blank panel.

Nothing here is `bd` data, so none of it goes through `BdService` — `src/extension/fleet/` is a
third, deliberate place outside `BdService` that spawns a process (after `actor.ts`'s read-only
`git config user.name` probe): every spawn here is read-only, bounded by a timeout, and a single
worktree's failure never blanks the rest of the snapshot. It is its own module rather than folded
into `actor.ts` or `BdService` because it answers a different question (what is on disk and in
Claude Code's own transcript store) than either of those — see the doc comments atop
`src/extension/fleet/FleetService.ts` and `src/extension/fleet/worktree-git.ts` for the reasoning.

## Roadmap

This distinguishes shipped behavior from checks still needed for the next release.

**Shipped** — done, and in the extension today:

- **Keyboard-movable cards** — space picks a card up, the arrow keys move it column by column and
  swimlane by swimlane, space drops it and escape puts it back. A screen reader hears the column
  name rather than the droppable id. ([#7](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/7))
- **Fleet monitor** — the worktrees and `work/bead-*` branches on disk, lined up against the beads
  they are carrying, so a stale one is visible, plus live transcript following per worker. See
  [Fleet monitor](#fleet-monitor) above. ([#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11))
- **Molecule progress** — a **Molecules** tab: `bd mol` molecules as cards, a step-list detail
  view, a wisp strip with a TTL countdown, and gate cards you can resolve inline — see
  [What it does](#what-it-does) above. ([#10](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/10))
- **Pull-request CI** — lint, typecheck, build and unit tests run on PRs; a separate job verifies
  pinned Beads 1.3.1 and Dolt binaries before running the isolated live compatibility suite.
  ([#9](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/9))

**Still to verify** — the `.cmd` shim fallback and Git-Bash paths have test coverage, but a fresh
Windows smoke run is needed before claiming the full v0.2.0 workflow works on Windows.
([#12](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/12))

**Exploring** — a direction, not a commitment. Nothing is designed and no issue is open yet.

A `human` gate in beads is already a "wait for a person" primitive, which makes remote approval
possible without changing beads core: an agent fleet stops on a gate, and whoever is on the hook
sees it, reads the context, and resolves it — not necessarily at their desk. The opt-in
`beadsDashboard.notifications` toast (see [Settings](#settings)) already covers "sees it" while the
editor is open; the still-unbuilt half of this direction is resolving from *outside* the editor
entirely — a phone notification, a Slack message — with no desk required at all. Arguing with that
direction is useful; open an issue and say so.

**Not planned:** orchestrating work. This is a viewer with quick actions — it shows what `bd` knows
and writes back through `bd`. What runs next is `bd`'s business, and that of whatever drives it.

## Contributing

[CONTRIBUTING.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/CONTRIBUTING.md) has the setup, the three rules a PR has to respect,
and how to run each suite. The short version: `npm install`, `npm run watch`, **F5** — then
`npm run demo:seed` for something to point the dev host at, because this repo's own `.beads/` is
gitignored and cloning gets you no database.

Unclaimed work is tagged [`help wanted`](https://github.com/cuongbphv/beads-ui-vscode-ext/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22); the entries scoped to one file or one workflow are
[`good first issue`](https://github.com/cuongbphv/beads-ui-vscode-ext/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). Bugs want the output of `Beads: Show bd Output Log` and your
`bd --version` — the issue template asks for exactly that.

## Development

```bash
npm run watch        # rebuild both bundles on change
npm run verify       # lint + typecheck + test + build + npm audit
npm test             # vitest
npm run demo:seed    # build the throwaway "Harbor" demo workspace
npm run capture:demo # seed it, then refresh docs/screenshots/ from a real editor
npm run gif          # seed it, then record docs/screenshots/demo.gif
npm run preview      # render the dashboard in Chromium at 420/900/1440px
```

Every image in this README comes from `capture:demo` / `gif`, never from a hand-posed editor.
The demo project is a fixture in [`scripts/lib/demo-project.mjs`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/scripts/lib/demo-project.mjs),
seeded through `bd import` into a throwaway workspace in your temp directory — the extension's own
tracker is nearly all closed, and screenshots taken against it make a live tool look finished. The
unit suite asserts the fixture stays mid-flight rather than drifting back into a graveyard.

These, `capture` and `preview` drive live `bd --json` output, so they need the `bd` CLI
locally. CI runs the isolated Beads 1.3.1 compatibility suite; the editor E2E and screenshot
tools remain local. `gif` also needs `ffmpeg` on your `PATH`.

### Releasing

Tag a commit and push it — [`.github/workflows/release.yml`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/.github/workflows/release.yml) builds the
`.vsix`, attaches it to a GitHub Release, then publishes that exact file to the VS Code Marketplace
and to Open VSX. The tag must match `version` in `package.json` or the workflow fails before
building.

```bash
npm run verify
npm run test:e2e:workbench
npm run package
# Tag v<package.json version> only after the checks and release review pass.
```

Publishing needs two repository secrets. Each publish step is skipped with a warning when its token
is missing, so a fork still gets a working `.vsix` release:

| Secret | Where it comes from |
|---|---|
| `VSCE_PAT` | An Azure DevOps PAT with the **Marketplace: Manage** scope. The `publisher` in `package.json` must exist first at [Manage Publishers](https://marketplace.visualstudio.com/manage). |
| `OVSX_PAT` | An [Open VSX access token](https://open-vsx.org/user-settings/tokens). Create the namespace once with `npx ovsx create-namespace cuongbphv -p <token>`. |

The call chain is one-directional, and no layer may be skipped:

```
view → hook → bridge/rpc.ts → [postMessage] → panel router → bd/queries|mutations → BdService → bd
```

```
src/extension/   Extension host — the only place that spawns bd or imports `vscode`
  bd/            BdService (spawn), queries (reads), mutations (writes)
  panel/         DashboardPanel (CSP + nonce) and the RPC router
  tree/          Epic → Task sidebar
src/shared/      Framework-free: types, RPC protocol, and the model derivations
src/webview/     React UI. Never touches child_process, fs, or the network
  bridge/rpc.ts  The single caller of acquireVsCodeApi()
media/           Extension icon and activity-bar glyph
```

`src/shared/` is the only code both sides import, so "what counts as done" means the same thing in
the sidebar and on the board.

## Design system

Design decisions are not ad-hoc — read [design-system/MASTER.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/design-system/MASTER.md) before
touching UI code. The rules that most often get violated:

- **No remote fonts or CDN assets.** The webview CSP blocks external hosts; use
  `var(--vscode-font-family)`.
- **No hardcoded hex colors.** The user's theme is the source of truth; map to `--vscode-*`.
- **Container queries, not media queries.** A panel can be 400px wide in a 2560px window.
- **Card content budget** — a card shows exactly four things: id, truncated title, type icon,
  priority dot. Status is the column it sits in, not a badge.
- **Never color alone** for status or priority — always color *plus* icon or text.
- **Icons from `lucide-react` only.** No emoji as icons.

## Tech stack

VS Code Extension API · TypeScript 6 · React 19 · Tailwind CSS 4 (CSS-first `@theme`) · `dnd-kit` ·
`lucide-react` · esbuild (dual bundle) · vitest

## Related projects

- **[Beads CLI](https://github.com/steveyegge/beads)** — the git-native issue tracker this UI wraps

## License

MIT — see [LICENSE](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/LICENSE). Copyright (c) 2026 Bùi Phan Viết Cường.
