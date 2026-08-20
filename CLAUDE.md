# beads-ui-vscode-ext — Beads Kanban UI

A **VSCode extension** that renders beads (`bd` CLI) task tracking as a Velox-style dashboard
(Overview / Roadmap / Board) plus a sidebar Epic → Task tree.

> Original work by the repository owner. Do not add third-party copyright lines or "forked from"
> notices to LICENSE or README. The build-out is tracked in
> `.velox/docs/roadmaps/M001..M004-ROADMAP.md`. Read
> **`.velox/docs/VELOX-CONTEXT.md`** before any task — it is the authoritative rule set.

## Tech Stack

- **Extension host:** VSCode Extension API (`engines.vscode` ^1.105), Node 22, TypeScript 6.0.3, CJS bundle
- **Webview UI:** React 19.2.8 + Tailwind CSS 4.3.3 (CSS-first `@theme`) + shadcn/Radix + dnd-kit
- **Data source:** `bd` CLI subprocess with `--json` — no database, no HTTP server, no auth
- **Bundler:** esbuild (dual target: `dist/extension.js` node/cjs + `dist/webview.js` browser/iife)
- **Build:** `npm run build`
- **Typecheck:** `npm run typecheck`
- **Test:** `npm test` (vitest; `@vscode/test-electron` for the activation smoke test)
- **Security gate:** `npm audit --audit-level=low` must report 0 vulnerabilities
- **Do not "upgrade" `typescript`, `@types/vscode`, or `@types/node`** — all three are pinned below
  latest on purpose. Read `.velox/docs/DECISIONS.md` DEC-006 first.

## Architecture rules

- Two bundles, one bridge. The extension host owns **all** I/O; the webview is pure presentation and
  never touches `child_process`, the filesystem, or the network.
- Call chain: `view → hook → bridge/rpc.ts → [postMessage] → panel router → bd/queries|mutations → BdService → bd`.
  Never skip a layer; a component never builds a `bd` argv.
- `src/shared/` is framework-free: it must not import `vscode` or `react`.
- Business logic lives in `src/extension/bd/` and `src/webview/lib/`, not in components or command handlers.
- UI colors come from `--vscode-*` CSS variables; responsiveness uses **container queries** (a webview
  panel's width is independent of the viewport).
- Every feature has a test.

## Cardinal sins (never do)

1. **Read `.beads/issues.jsonl` or the Dolt files directly.** It is an export with auto-refresh OFF by
   default and upstream declares direct readers incompatible. Always shell out to `bd --json`.
2. **Hardcode statuses, issue types, or kanban columns.** They are user-extensible in beads — load them
   at runtime via `bd statuses --json` / `bd types --json` and group columns by status *category*.
3. **Spawn `bd` outside `BdService`**, or call `acquireVsCodeApi()` outside `bridge/rpc.ts`.
4. **Run `bd init`, `bd dolt push/pull`, or any beads mutation the user did not ask for.**
5. **Ship a dependency with a known CVE**, or silently downgrade a package to dodge an advisory.
6. Import `vscode` from `src/shared/` or `src/webview/`.
7. Load remote assets (fonts, CDN scripts) in the webview — CSP forbids it and it breaks offline use.
8. No untested code paths. No business logic in command handlers or React components.
9. Hardcode secrets; skip or delete failing tests; use `--no-verify`; run git operations unasked.

## Quick reference

| Need | Path |
|------|------|
| Agent rules (read first) | `.velox/docs/VELOX-CONTEXT.md` |
| Current work state | `.velox/STATUS.md` |
| Task details | `.velox/docs/roadmaps/M001..M004-ROADMAP.md` |
| Architecture decisions | `.velox/docs/DECISIONS.md` |
| File navigation | `.velox/INDEX.md` |
| UI source of truth | `design-system/MASTER.md` (via the `ui-ux-pro-max` skill) |
| `bd` CLI flags | `C:\Users\CuongBPV\Workspace\AI\beads\docs\CLI_REFERENCE.md` |
| beads data model | `C:\Users\CuongBPV\Workspace\AI\beads\internal\types\types.go` |


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
