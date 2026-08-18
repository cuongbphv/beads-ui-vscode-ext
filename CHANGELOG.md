# Changelog

All notable changes to **Beads Dashboard** are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- The external roadmap sync commands (sync status report, export to roadmap, import
  roadmap tasks) and the roadmap seeding script. The capability moves to internal
  development; the extension stays a viewer with quick actions over `bd`.

## [0.1.2] — 2026-08-09

### Added

- **Roadmap timeline rebuilt as a frozen grid.** The task-name column stays put while the
  time axis scrolls, and the seam between them is a splitter you can drag — or nudge with
  the arrow keys, or double-click to send back to its default. The width is remembered
  per panel.
- **Time zoom** — Fit, Days, Weeks or Months. Fit still sizes the plan to the pane; the
  other three pin a fixed scale so two epics can be compared at the same pixels-per-day.
  Tick density follows the zoom, so an axis never crowds itself into unreadable labels.
- **Sorting** — by date, by priority, or by type, applied to both the timeline and the
  List shape so the two never disagree about order. The synthetic "No epic" group stays
  last regardless.
- **Reschedule by dragging a bar's edge.** Dropping it writes through `bd update`:
  `--due` for an issue that already has a due date, `--estimate` for one that does not.
  The bar shows as pending until `bd` confirms, and a rejected edit snaps back.
- **Undo on the confirmation toast.** A reschedule that lands somewhere you did not mean
  is one click from going back: the toast carries an **Undo** that writes the previous
  date or estimate, queued behind anything already in flight on that issue, and stays up
  long enough to be reached. An issue that had no estimate at all is the one case with no
  Undo — `bd update --estimate` stores a zero rather than clearing the field, so there is
  no call that puts it back.
- **A date axis over the timeline**, with a today marker aligned to one clock reading per
  render, so every bar agrees on where "now" is.
- **Resizable detail pane.** Same splitter, same keyboard contract, also remembered.
- Restored panel state is validated rather than trusted: a saved sort or zoom this build
  no longer offers falls back to the default instead of rendering an empty picker, and a
  saved width that is not a positive number falls back instead of reaching the layout as
  `NaNpx`.

### Changed

- **The filter bar is one quiet band instead of eleven controls.** The Epic, Type,
  Assignee and Priority pickers moved into a single **Filters** popover carrying a count
  of what is applied; the band itself is now the search box, that button, and the view
  controls, separated so narrowing the data reads differently from drawing it.
- **Applied filters are listed as chips** under the band and each one removes itself in a
  click, so a filter can no longer be forgotten inside a collapsed picker. "Clear all"
  drops every filter but leaves closed issues showing — clearing must not hide rows you
  asked to see.
- The `Closed` checkbox moved into the popover. What is on screen instead is the
  consequence: the Roadmap's "N closed hidden — show" pill when they are hidden, a
  `Closed shown` chip when they are not.
- Each picker in the popover now has a visible `<label>`. They previously carried an
  `aria-label` and no visible text, which read as four unlabelled boxes.

### Fixed

- An epic filter surviving the disappearance of its epic — after a delete, or a refresh
  that no longer carries it — left the picker looking unset while it went on hiding every
  row. It is now listed by id in the chip row, and removable from there.

## [0.1.1] — 2026-08-04

### Fixed

- Every image and repository link in the README is now an absolute URL pinned to the
  `main` branch. `vsce` rewrites relative paths to `.../raw/HEAD/...` at packaging
  time, and `HEAD` resolves to whatever the default branch happens to be when the
  page is viewed — so the screenshots and the demo GIF could render as broken images
  on the Marketplace listing.
- Dropped two links to a git-ignored directory, which therefore resolved on no
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
- Roadmap sync commands — status report, export to roadmap, import roadmap tasks
  (removed after 0.1.2).
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
