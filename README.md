<p align="center">
  <img src="media/icon.png" alt="Beads UI" width="128" />
</p>

<h1 align="center">Beads UI for VS Code</h1>

<p align="center">
  Kanban, roadmap and epic tracking for the <a href="https://github.com/steveyegge/beads">Beads</a> git-native issue tracker — inside your editor.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" />
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.105-007ACC" alt="VS Code ^1.105" />
</p>

---

## What it does

Beads UI reads your local beads database through the `bd` CLI and renders it three ways:

- **Overview** — totals, a status breakdown, epic progress, and the two lists that matter on
  arrival: what is ready to start, and what is blocked.
- **Roadmap** — Epic → Task drill-down with progress bars and per-epic counts.
- **Board** — a kanban board whose columns are derived from your project's status *categories* at
  runtime. Drag a card to change its status.

Plus an **Epics & Tasks** sidebar with a "Needs You" section, and quick actions (status, priority,
assignee, claim, close) available from the tree, the board and the detail pane.

Everything is read and written through `bd --json`. The extension never reads `.beads/issues.jsonl`
or the Dolt files directly — that export has auto-refresh off by default, and upstream declares
direct readers incompatible.

## See it in action

**Overview** — totals, status split, priority mix and a burn-up of everything closed so far:

![Overview tab showing 46 issues, a 98% done donut, priority and issue-type breakdowns, and a cumulative burn-up chart](docs/screenshots/overview.png)

**Roadmap** — milestones as a timeline, each epic with its own progress count:

![Roadmap tab showing milestones M001 11/11, M002 10/10 and M003 9/9 as Gantt rows with per-task bars](docs/screenshots/roadmap.png)

**Board** — columns derived from your status categories, drag a card to move it:

![Kanban board with Open, In Progress, On Hold and Done columns, cards carrying issue id, title, labels and priority](docs/screenshots/board.png)

**Detail pane** — the full issue without leaving the board:

![Detail pane for task T105 showing status, priority, assignee, estimate, due date, description, design and acceptance criteria](docs/screenshots/roadmap-detail.png)

**Sidebar** — Epic → Task, with a "Needs You" section on top:

![Epics and Tasks sidebar tree with a Needs You section and milestone epics expanded to show their child tasks](docs/screenshots/sidebar-tree-expanded.png)

## Requirements

- The [`bd` CLI](https://github.com/steveyegge/beads) on your `PATH` (or set `beadsUi.bdPath`).
- A workspace folder containing a `.beads` directory. The extension activates only when it finds one.

## Install

Not on the Marketplace yet — build and install locally:

```bash
npm install
npm run install:local     # build → package → install; then reload the window
```

`install:local` auto-detects `code`, `code-insiders`, `cursor`, `windsurf` or `codium`. Force one
with `npm run install:local -- --cli cursor`, or set `VSCODE_CLI`. To produce a `.vsix` without
installing it, pass `-- --skip-install`.

After it finishes: **Ctrl+Shift+P → "Developer: Reload Window"**, then open the Beads icon in the
Activity Bar.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `beadsUi.bdPath` | `bd` | Path to the `bd` executable. |
| `beadsUi.defaultTab` | `overview` | Tab the dashboard opens on. |
| `beadsUi.issueLimit` | `2000` | Issues loaded per refresh. |
| `beadsUi.pollIntervalSeconds` | `0` | Automatic refresh interval. `0` disables polling. |
| `beadsUi.showClosed` | `true` | Include closed issues in the board and tree. |

Nothing polls by default — one `bd` process per poll is not free. The views refresh on activation,
on demand, and after every change you make from the extension.

## Commands

| Command | Where |
|---|---|
| `Beads: Open Dashboard` | Palette, view title |
| `Beads: Refresh` | Palette, view title |
| `Beads: Show bd Output Log` | Palette — every argv and every failure lands here |
| Change status / priority / assignee, Claim, Close, Copy ID | Tree context menu, detail pane |

## Development

```bash
npm run watch        # rebuild both bundles on change
npm run verify       # lint + typecheck + test + build + npm audit
npm test             # vitest
npm run capture      # refresh docs/screenshots/ from a real editor
npm run preview      # render the dashboard in Chromium at 420/900/1440px
```

`capture` and `preview` both drive live `bd --json` output, so they need the `bd`
CLI and a `.beads` workspace. That is why they run locally and not in CI.

### Releasing

Tag a commit and push it — [`.github/workflows/release.yml`](.github/workflows/release.yml) builds the
`.vsix` and attaches it to a GitHub Release. The tag must match `version` in `package.json` or the
workflow fails before building. Nothing is published to the Marketplace.

```bash
npm run verify       # the workflow cannot run the bd-backed tests; do it here
git tag v0.1.0
git push origin v0.1.0
```

Architecture, decisions and the task roadmap live in [`.velox/`](.velox/); the agent rule set is
[`.velox/docs/VELOX-CONTEXT.md`](.velox/docs/VELOX-CONTEXT.md).

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

Design decisions are not ad-hoc — read [design-system/MASTER.md](design-system/MASTER.md) before
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

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Bùi Phan Viết Cường.
