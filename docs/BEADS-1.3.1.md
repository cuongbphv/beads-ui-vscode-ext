# Beads 1.3.1 compatibility in Dashboard 0.1.7

Reviewed on 2026-10-03 against the tagged release, not upstream `main`:
[`v1.3.1`, `c1c4b642a`](https://github.com/gastownhall/beads/tree/v1.3.1).
The official macOS arm64 binary was downloaded separately and its SHA256 checked
against the release's `checksums.txt`. The initial isolated qualification kept the installed Beads 1.2.2 binary and
this repository's database unchanged. In the subsequent user-authorized upgrade,
Homebrew installed Beads 1.3.1 and its Dolt 2.4.0 dependency. The local workspace
was backed up first; Beads then auto-applied 13 deterministic schema migrations.
The database changes have not been pushed to the remote.

## Required fixes

| CLI contract | Dashboard change |
| --- | --- |
| `events tail` emits JSON Lines, including a single bare record; `--json` affects errors, not framing | `BdService.jsonLines` parses each nonblank line; the query validates increasing safe integer sequences |
| Disabled journal exits successfully with empty stdout | Check `config get events-journal --json` before journal reads, including its effective environment override; disabled journals use the watermark |
| Tail is oldest-first, so `--since 0 --limit 1` is not the current head | Capture the head before a full snapshot; do not refresh once per historical page |
| Retention can invalidate a cursor with `events_journal_truncated` | Preserve typed error metadata, re-baseline and force a full refresh; failures use the watermark |
| Journal reset, sync and SQL writes can evade events | Keep the 12-active-tick full resync and re-baseline the journal on that cycle |
| Direct server status omits `mode`; external status uses `running`/`version`; proxied status has `running`, `proxy_*`, `backend_managed`, `backend_running` | Recognize the direct server State payload and normalize liveness, version and proxy PID/port into the existing sync status model; a managed backend must also be running |
| `types` adds `system_types`; `custom_types` can be string names | Include system types and normalize custom names without hardcoding the vocabulary |

### Cursor acquisition and limits

Beads 1.3.1 has no `events head` CLI command. The extension first asks
`bd sql --readonly 'SELECT next_seq AS head FROM bd_events_seq WHERE id = 0' --json`.
The counter stores the last assigned sequence despite its `next_seq` name. This
is a read through the CLI; no Dolt files are opened by the extension.

Embedded mode does not support `bd sql`. There the extension drains up to ten
pages of 1,000 events to establish a baseline. If the initial cursor was pruned,
the typed refusal supplies the head. If it cannot finish within that budget or
the existing 16 MB subprocess output cap, it uses the watermark for the rest of
the session. These baseline reads never replay history as individual refreshes.

A successful baseline always requests a full snapshot, including when a newer
event arrives during detection. Capturing the cursor before that snapshot avoids
silently discarding a write that races with the read. Ordinary snapshot resets
retain the cursor. Changing `beadsDashboard.bdPath` restarts detection.

While events mode is active, each regular probe checks the effective config and
reads one journal page (up to 50 records). Turning the journal off mid-session
forces a snapshot immediately and then uses the watermark. The extension never
changes the journal setting itself. Watermark mode remains one list read per
ordinary tick after detection. The resync interval counts active ticks, not
wall-clock seconds; hidden/background views do not poll, and the existing
last-touched watcher can relax the timer cadence.

## Changes that do not need new extension features

- **Custom active statuses in `ready`:** the extension already uses the native
  `bd ready` set, rather than assuming that only `open` is ready. A live regression
  case verifies a `triaged:active` issue is included.
- **`BEADS_DIR` is authoritative:** extension subprocesses inherit the operator's
  environment. If set, it must identify the intended `.beads` directory, not its
  project root. The extension does not override an intentional redirect. The
  compatibility suite explicitly targets each temporary workspace's `.beads`.
- **`list --wisp-type` now needs `--include-ephemeral`:** the extension reads wisps
  through `mol wisp list`; it does not use the changed flag combination.
- **Partial batch close exits nonzero:** UI quick actions close one issue, so the
  changed batch summary does not require a new parser.
- **Proxy commit policies, backup, purge and server lifecycle fixes:** the
  dashboard does not perform those operations for users. `history` still reads
  committed Dolt snapshots; writes under `batch`/`off` need the operator's own
  commit before they appear in that timeline.
- **Additive typed proxy refusals:** existing error handling keeps the code and
  readable message; unsupported operations remain visible errors.

## Validation

Run the existing local gates with the installed CLI:

```bash
npm run verify
```

Then opt into the isolated journal qualification suite with an official 1.3.1
binary. The suite does not point that binary at this repository's database:

```bash
BEADS_COMPAT_BD=/absolute/path/to/bd npm test -- --run src/test/bd-events-live.test.ts
```

It exercises real disabled/active journals, multiple JSON Lines, history
baselining, mid-session disable, retention pruning/recovery, custom active
statuses, string custom types and dashboard reads. It also creates owned direct
server and proxied-server workspaces, checks their journal/status contracts, and
stops those temporary servers before cleanup. Those two cases require `dolt` on
PATH. Without `BEADS_COMPAT_BD`, a local run skips the suite. A dedicated Linux CI job
downloads the official 1.3.1 binary and Dolt, verifies both SHA-256 digests, then opts in.
Real CLI cases use a 30-second timeout, matching the existing `bd-live` suite,
since each test can spawn several Dolt processes under concurrent suite load.
Unit cases separately cover malformed output, fallback and page-budget bounds,
proxy backend health, CLI replacement, and the 12-tick backstop.

Local qualification ran on macOS, and the CI job runs on Linux. Windows and externally managed
shared proxies remain untested. Remote sync and raw SQL are deliberately outside
the journal; the periodic full snapshot remains necessary.

## Release tooling

The initial audit on the 0.1.6 lockfile reported 16 vulnerabilities. Compatible
lockfile updates resolved most. The remaining `braces` advisory has no patched
release, so the vulnerable dependency paths were removed: `@vscode/vsce` 4.0.0
uses a smaller scanning/globbing dependency tree, and an `@parcel/watcher` 2.6
override replaces its old micromatch/braces path. Node 22 already matches the
packager's new minimum. TypeScript, `@types/node` and `@types/vscode` retain their
existing locked versions. `npm run package` validates the packager upgrade.

Sources: [vsce 4.0.0](https://github.com/microsoft/vscode-vsce/releases/tag/v4.0.0),
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

## Operator upgrade notes

Beads 1.3.1 has no schema migration relative to 1.3.0. Upgrading from 1.2.2 or
older requires the 1.3.0 upgrade instructions first. In particular, follow
pull-first/migration guidance from Beads; the dashboard does not migrate or sync
a database for you. An explicit `BEADS_DIR` must point to `.beads` itself.

Sources: [1.3.1 release notes](https://github.com/gastownhall/beads/releases/tag/v1.3.1),
[1.3.0 release notes](https://github.com/gastownhall/beads/releases/tag/v1.3.0),
[tagged events CLI](https://github.com/gastownhall/beads/blob/v1.3.1/cmd/bd/events.go),
[tagged journal counter](https://github.com/gastownhall/beads/blob/v1.3.1/internal/storage/issueops/journal.go),
[tagged types CLI](https://github.com/gastownhall/beads/blob/v1.3.1/cmd/bd/types.go),
[tagged proxy status](https://github.com/gastownhall/beads/blob/v1.3.1/cmd/bd/dolt_proxied_lifecycle.go),
and [GitHub issue #18](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/18).
