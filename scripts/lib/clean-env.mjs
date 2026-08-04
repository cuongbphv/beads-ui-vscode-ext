/**
 * Strips the environment VS Code injects into its own child processes.
 *
 * Anything launched from the integrated terminal — or from an agent running in
 * the extension host — inherits `ELECTRON_RUN_AS_NODE=1` and a set of
 * `VSCODE_*` variables. A nested `Code.exe` then boots as a bare Node runtime
 * and rejects every editor flag ("bad option: --user-data-dir", exit 9), so any
 * harness that launches a second editor has to scrub them first.
 */

/** Variables that must not reach a nested editor. */
function isInherited(key) {
  return key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_');
}

/** A copy of `process.env` with the inherited editor variables removed. */
export function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!isInherited(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * Same, applied in place. `@vscode/test-electron` launches the editor with the
 * ambient `process.env`, so the only way to fix its child is to fix ours.
 * Returns the names it removed, for logging.
 */
export function scrubProcessEnv() {
  const removed = Object.keys(process.env).filter(isInherited);
  for (const key of removed) delete process.env[key];
  return removed;
}
