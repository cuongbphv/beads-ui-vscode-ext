/**
 * Best-effort recursive delete for throwaway test scratch directories
 * (`mkdtemp` + `bd init` isolated projects — see `bd-live.test.ts`'s
 * "dependency edges" describe block and the `bd-cwd-is-not-isolation` lesson
 * for why those exist).
 *
 * `node:fs/promises`' own `rm` already retries on `EBUSY`/`EMFILE`/`ENFILE`/
 * `ENOTEMPTY`/`EPERM` (per Node's docs: "Node.js will retry the operation
 * with a linear backoff wait of `retryDelay` ms longer on each try" — so the
 * worst-case total wait for `n` retries is `retryDelay * n * (n + 1) / 2`,
 * not `retryDelay * n`). That still isn't enough under heavy concurrent
 * load: many scratch `bd`/Dolt projects spinning up at once on the same
 * Windows machine (e.g. several bead-fleet batch agents each running their
 * own full `npm test`) can hold a file lock on a just-closed Dolt file
 * longer than a short retry budget covers, throwing `EBUSY` even though
 * every real test assertion in the suite already passed. See
 * beads-ui-vscode-ext-iy3.
 *
 * This wraps that retry with two things: a larger budget, and a safety net
 * — if the directory is STILL locked once the budget is exhausted, warn
 * instead of throwing. A leaked scratch directory in the OS temp dir is a
 * minor, self-cleaning annoyance; a spuriously red CI/gate run that hides a
 * real regression (and forces a manual isolated rerun to confirm the flake
 * every single time) is a much worse outcome for a cleanup step that runs
 * after every actual assertion has already reported its own pass/fail.
 */
import { rm } from 'node:fs/promises';

export interface RemoveScratchDirOptions {
  /** Passed straight through to `fs.rm`. @default 15 */
  maxRetries?: number;
  /** Passed straight through to `fs.rm`. @default 400 */
  retryDelay?: number;
  /** Injectable for tests; defaults to the real `node:fs/promises` `rm`. */
  rmFn?: typeof rm;
  /** Injectable for tests; defaults to `console.warn`. */
  warn?: (...args: unknown[]) => void;
}

/**
 * Removes `dir` recursively, retrying through transient Windows file locks,
 * and never throws: a failure after exhausting the retry budget is logged
 * with `warn` (visible, not silently swallowed) rather than propagated.
 */
export async function removeScratchDirBestEffort(
  dir: string,
  options: RemoveScratchDirOptions = {},
): Promise<void> {
  const { maxRetries = 15, retryDelay = 400, rmFn = rm, warn = console.warn } = options;
  try {
    await rmFn(dir, { recursive: true, force: true, maxRetries, retryDelay });
  } catch (error) {
    warn(
      `[scratch-cleanup] Failed to remove scratch directory "${dir}" after exhausting ` +
        `${maxRetries} retries (retryDelay=${retryDelay}ms). Likely a transient Windows file ` +
        `lock held under heavy concurrent load (e.g. many scratch bd/Dolt projects spinning up ` +
        `at once). Leaving the directory on disk for the OS to reclaim — this does NOT indicate ` +
        `a test failure.`,
      error,
    );
  }
}
