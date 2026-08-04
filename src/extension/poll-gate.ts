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
