# Troubleshooting

The extension needs a workspace folder whose Beads database resolves through `bd context`.
It also needs the `bd` CLI. If setup fails, open `Beads: Show bd Output Log` for the command
output. The extension keeps the last successful issue snapshot when a later refresh fails.

## No Beads workspace

If the sidebar says "No Beads workspace detected here," check the folder in your editor.
From that folder, run `bd context` in a terminal. A local `.beads` directory, a worktree
redirect, or `BEADS_DIR` can identify the database. If this is a new project, run `bd init`.
The welcome view also links to the dashboard and output log.

The extension checks each workspace folder with `bd context` and verifies that the returned
`beads_dir` is a directory. If no folder passes, `Beads: Open Dashboard` shows a warning
instead of opening an empty panel. After adding a workspace folder or initializing Beads,
run **Developer: Reload Window**. See [`workspace.ts`](../src/extension/workspace.ts) and
[`extension.ts`](../src/extension/extension.ts).

In a multi-root workspace, `Beads: Select Beads Folder…` lets you choose among folders
whose databases resolve. It asks to reload the window after a new selection.

## The editor cannot run `bd`

A first refresh can show `Could not run "bd"` with an **Open Settings** action. Install the
[`bd` CLI](https://github.com/steveyegge/beads) in the editor's `PATH`, or set
`beadsDashboard.bdPath` to the executable's absolute path. The editor's environment can
differ from your terminal's. Changing `bdPath` retargets the service and triggers a refresh;
you do not need to reload the window. See [`BdService.ts`](../src/extension/bd/BdService.ts)
and [`store.ts`](../src/extension/store.ts).

On Windows, the service retries through a shell when it cannot launch a command directly.
If that also fails, the error is reported as `bd-not-found`.

## `bd` returns an error

A first-refresh error other than `bd-not-found` offers **Show Log**. Open it and inspect the
failed command and `bd`'s message. Run the same command from the tracked workspace folder
to check the database and CLI configuration. Errors about an unresolved database may point
to `bd init`, `BEADS_DIR`, or the folder that `bd context` selected.

A later failed refresh leaves the last successful snapshot visible and marks it stale.
The status bar shows `⚠ Beads` while an error is present. A successful refresh clears the
error. See [`store.ts`](../src/extension/store.ts) and
[`status-bar.ts`](../src/extension/status-bar.ts).

## Error kinds

| Kind | Meaning |
|---|---|
| `bd-not-found` | The configured executable could not be launched. |
| `no-workspace` | `bd` returned a recognized missing-database message. |
| `bd-error` | `bd` ran and returned another error. |
| `bad-output` | A command succeeded but its output could not be parsed. |
| `unknown` | Another error reached the fallback handler. |

For a bug report, include the relevant lines from `Beads: Show bd Output Log`, your
`bd --version`, editor and OS. See [CONTRIBUTING.md](../CONTRIBUTING.md#reporting-a-bug).
