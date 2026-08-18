/**
 * The decision half of live refresh, kept free of `vscode` so it can be tested
 * without an editor.
 *
 * Two questions, both cheap to get wrong:
 *
 *   1. Should a timer be running at all? (`pollingEnabled`)
 *   2. Given a fingerprint from the change probe, is a full reload warranted?
 *      (`PollGate`)
 *
 * The subtle one is (2). A refresh makes the data current, so the fingerprint it
 * leaves behind is *ours*, not evidence of someone else's edit — reading it back
 * as a change would refresh forever. The gate models that as "unknown": after a
 * refresh the next fingerprint is adopted silently, and only a move away from an
 * adopted value counts as news.
 */

/** Probe ticks between forced full refreshes. See `FULL_RESYNC_TICKS` in store.ts. */
export const DEFAULT_RESYNC_TICKS = 12;

/**
 * Is a poll timer worth running?
 *
 * @param seconds   the configured interval; `0` (or less) disables polling
 * @param observers how many Beads views are currently on screen
 * @param focused   whether the window has focus
 */
export function pollingEnabled(seconds: number, observers: number, focused: boolean): boolean {
  return seconds > 0 && observers > 0 && focused;
}

/**
 * The fallback poll cadence relaxes to this multiple of the configured
 * interval once the `.beads/last-touched` watcher has proven it fires — see
 * `effectivePollSeconds`.
 */
export const WATCHER_ACTIVE_CADENCE_MULTIPLIER = 6;

/**
 * The interval the plain `setInterval` fallback should actually run at.
 *
 * The watcher is the fast path once it is known to work (an event fires the
 * probe immediately), so the timer only needs to be a backstop at that point
 * — six times slower rather than the original headline cadence. `0` (or
 * less) still means "never poll", watcher or not: that is the one setting
 * that must stay an absolute off switch.
 *
 * @param configuredSeconds the user's `pollIntervalSeconds` setting
 * @param watcherActive     whether the file watcher has fired at least once
 */
export function effectivePollSeconds(configuredSeconds: number, watcherActive: boolean): number {
  if (configuredSeconds <= 0) return configuredSeconds;
  return watcherActive ? configuredSeconds * WATCHER_ACTIVE_CADENCE_MULTIPLIER : configuredSeconds;
}

export class PollGate {
  /** `undefined` = unknown; adopt the next fingerprint without refreshing. */
  private watermark: string | undefined;
  private ticks = 0;

  constructor(private readonly resyncAfterTicks: number = DEFAULT_RESYNC_TICKS) {}

  /** A full refresh has landed: the data is current and the fingerprint is stale. */
  reset(): void {
    this.watermark = undefined;
    this.ticks = 0;
  }

  /**
   * Count this tick and report whether the probe should be skipped in favour of
   * reloading outright — the backstop for the changes a one-second-resolution
   * fingerprint cannot see.
   */
  dueForResync(): boolean {
    this.ticks += 1;
    return this.ticks >= this.resyncAfterTicks;
  }

  /** Feed a fingerprint; true when it is somebody else's change. */
  changed(mark: string): boolean {
    const moved = this.watermark !== undefined && mark !== this.watermark;
    this.watermark = mark;
    return moved;
  }
}

/** Default coalescing window for `Debouncer`, matched to a `bd` write burst. */
export const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Leading-edge coalescing for the file-watcher doorbell.
 *
 * The point of the watcher is to react *immediately* rather than wait for the
 * next poll tick, so the first signal of a burst is accepted right away. A
 * `bd` write is rarely a single filesystem event, though, so every further
 * signal inside the window is swallowed as the same burst; a signal that
 * lands after the window has elapsed starts a new burst and is accepted
 * again. The clock is injectable so tests can drive it without real timers.
 */
export class Debouncer {
  private lastAcceptedAt: number | undefined;

  constructor(
    private readonly windowMs: number = DEFAULT_DEBOUNCE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Record a signal; true when it should trigger a probe, false when coalesced. */
  signal(): boolean {
    const at = this.now();
    if (this.lastAcceptedAt !== undefined && at - this.lastAcceptedAt < this.windowMs) return false;
    this.lastAcceptedAt = at;
    return true;
  }
}
