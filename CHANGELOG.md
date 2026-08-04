# Changelog

All notable changes to **Beads Dashboard** are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-08-04

### Fixed

- Every image and repository link in the README is now an absolute URL pinned to the
  `main` branch. `vsce` rewrites relative paths to `.../raw/HEAD/...` at packaging
  time, and `HEAD` resolves to whatever the default branch happens to be when the
  page is viewed — so the screenshots and the demo GIF could render as broken images
  on the Marketplace listing.
- Dropped two links to `.velox/`, which is git-ignored and therefore resolves on no
  branch at all.

## [0.1.0] — 2026-08-04

First public release.

### Added

- **Overview** — totals, ready/blocked/overdue counters, status donut, priority mix,
  issue-type breakdown, workload per assignee, and a cumulative burn-up.
- **Roadmap** — Epic → Task timeline with a today marker, per-epic progress rollups,
  and a List shape for plans too short to draw as a timeline.
- **Board** — kanban columns derived at runtime from your project's status
  *categories*, so a custom status lands in the right column instead of a
  hardcoded one. Drag a card to change its status.
- **Sidebar** — a "Needs You" view for issues assigned to you, and an
  "Epics & Milestones" view carrying the plan plus an Unassigned triage queue.
- **Detail pane** — description, design, acceptance criteria, dependencies, parent,
  estimate and due date, with status, priority and assignee editable in place.
- **Live refresh** — changes made outside the editor, by an agent or a teammate or
  your own terminal, appear on their own within a few seconds. Each check is a
  single `bd list --limit 1`; the full reload runs only when something changed, and
  nothing is checked while every Beads view is hidden or the window is in the
  background. Set `beadsDashboard.pollIntervalSeconds` to `0` to switch it off.
- **Velox sync commands** — status report, export to roadmap, import roadmap tasks.
- Settings: `bdPath`, `defaultTab`, `issueLimit`, `pollIntervalSeconds`, `showClosed`,
  `assignee`.

### Notes

- Everything is read and written through `bd --json`. The extension never reads
  `.beads/issues.jsonl` or the Dolt files directly — that export has auto-refresh off
  by default and upstream declares direct readers incompatible.
- Colours come from your theme's `--vscode-*` variables, including the categorical
  chart palette; nothing is hardcoded and no remote asset is loaded.
- Requires the [`bd` CLI](https://github.com/steveyegge/beads) on your `PATH` and a
  workspace folder containing a `.beads` directory.
