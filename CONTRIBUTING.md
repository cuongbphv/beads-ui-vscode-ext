# Contributing

Thanks for looking. This is a small extension with a narrow job — read a local beads database
through the `bd` CLI and draw it — so most of what follows is about staying inside that job.

Issues tagged [`good first issue`](https://github.com/cuongbphv/beads-ui-vscode-ext/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
are scoped to one file or one workflow and say what "done" looks like.
[`help wanted`](https://github.com/cuongbphv/beads-ui-vscode-ext/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)
is everything nobody has claimed. The [Roadmap](README.md#roadmap) explains where each one sits.

## Three rules that decide whether a PR can be merged at all

1. **The `bd` CLI with `--json` is the only interface** (including JSON Lines for `bd events tail`). Never read `.beads/issues.jsonl`, the Dolt files or
   `.beads/last-touched`'s *contents*. That export has auto-refresh off by default and upstream
   declares direct readers incompatible; the watcher may use the file as a *signal*, never as data.
2. **The call chain is one-directional and no layer may be skipped:**
   `view → hook → bridge/rpc.ts → [postMessage] → panel router → bd/queries|mutations → BdService → bd`.
   Only `src/extension/` may import `vscode` or spawn a process. `src/webview/` never touches
   `child_process`, `fs` or the network, and `src/shared/` imports neither side.
3. **[`design-system/MASTER.md`](design-system/MASTER.md) is binding for anything visual.** Read it
   before touching UI code. The rules broken most often: no remote fonts or CDN assets (the CSP
   blocks them), no hardcoded hex colours (map to `--vscode-*`), container queries instead of media
   queries, four things on a card and no more, never colour alone for status or priority, icons from
   `lucide-react` only.

## Setup

You need **Node ≥ 22** and the [`bd` CLI](https://github.com/steveyegge/beads) on your `PATH`.

```bash
npm install
npm run watch     # rebuilds the extension and webview bundles on change
```

Then **F5** in VS Code (`Run Extension`, or `Run Extension (watch)`) to launch an Extension
Development Host. `npm run install:local` is the other route — build, package, install into your real
editor, reload the window.

### You need a workspace with beads in it

The extension asks `bd context` which database a workspace uses. That can be a local `.beads`
directory, a worktree redirect, or `BEADS_DIR`. **This repo's own `.beads/` is gitignored** —
cloning gets you no database. To try the extension in isolation:

```bash
npm run demo:seed    # builds the throwaway "Harbor" demo workspace in your temp dir, 5 epics / 46 issues
```

…then open that folder in the Extension Development Host. Or run `bd init` in a scratch folder of
your own and create a few issues. Don't add a `.beads/` to this repo in a PR.

## Before you open a PR

```bash
npm run verify    # lint + typecheck + test + build + npm audit
```

`verify` has to pass locally. The ordinary PR test job excludes the shared-project live CLI suite.
Part of the suite
([`src/test/bd-live.test.ts`](src/test/bd-live.test.ts)) drives the real `bd` binary and cross-checks
every read against raw `bd --json` output, so PR CI uses `npm run test:ci`; another CI job runs the
isolated pinned Beads 1.3.1 journal suite. The release workflow builds and publishes. If you change anything under `src/extension/bd/`, say in the PR that `bd-live` passed
and which `bd` version you ran.

For changes to journal handling, also run the opt-in suite against a Beads 1.3.1
binary downloaded from the official release (verify its published checksum):

```bash
BEADS_COMPAT_BD=/absolute/path/to/bd npm test -- --run src/test/bd-events-live.test.ts
```

This suite creates its own temporary git/Beads workspace and tests disabled and
active journals, JSON Lines, retention recovery, custom active statuses, runtime
vocabulary and dashboard reads. It also tests owned server/proxy workspaces
(requires `dolt` on PATH) and stops those temporary servers. It does not migrate this repository's database.
Without `BEADS_COMPAT_BD`, these tests are explicitly skipped.
Run `npm run test:e2e:workbench` for the isolated editor flow through Ready, Claim and a human gate.

Other useful runs:

| Command | What it does |
|---|---|
| `npm test` | vitest only — the suite under [`src/test/`](src/test/) |
| `npm run test:webview` | launches a real VS Code in a throwaway profile and reads the *rendered* webview DOM |
| `npm run test:electron` | activation smoke test in a real VS Code (~150 MB download on first run) |
| `npm run preview` | renders the dashboard in Chromium at 420 / 900 / 1440px — the three responsive tiers |
| `npm run capture:demo` | reseeds the demo project and re-takes every image in `docs/screenshots/` |

`test:webview` and `test:electron` both point a real editor at **this repo's** folder, so they need a
`.beads/` here — `bd init` once and they work; without one they cannot activate the extension.

Screenshots in the README are always generated by `capture:demo` / `gif`, never posed by hand. If
your change alters what a tab looks like, regenerate rather than crop.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with the area as the
scope — `feat(board):`, `fix(readme):`, `test(bd-live):` — matching the existing history.

## What tends to get declined

- Reading beads data anywhere except through `bd --json`.
- New hex colours, remote assets, emoji as icons, or a fifth thing on a board card.
- Hardcoding a status vocabulary. Columns are derived from the project's own status *categories* at
  runtime, because every beads project can define its own.
- Making the extension an orchestrator. It is a viewer with quick actions; running work belongs to
  `bd` and to whatever fleet tooling you drive it with.
- A feature with no way to see it working. Attach a screenshot from the dev host, or a test.

## Reporting a bug

`Beads: Show bd Output Log` records every argv and every failure — paste the relevant lines, with
your `bd --version`, editor and OS. The bug template asks for exactly that.
