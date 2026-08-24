/**
 * The change-probe strategy: what `BeadsStore.tick()` asks every poll cycle
 * to learn whether a full `refresh()` is warranted.
 *
 * Two probes can answer "has anything changed?":
 *
 *   - `watermark` — `bd list --sort updated --limit 1` (via
 *     `BdQueries.watermark`). This is the only probe that exists on any bd
 *     version this extension has actually been run against, and extracting
 *     it out of `store.ts` into this class does not change what it does —
 *     see `probeWatermark` below.
 *   - `events` — `bd events tail --since <seq> --limit <n>` (via
 *     `BdQueries.eventsTail`), a fast path for a future bd that ships a
 *     change journal. [Unverified/dormant]: the locally installed bd 1.2.2
 *     has no `events` command at all — measured directly by running
 *     `bd events tail --since 0 --limit 1`, which exits 1 with
 *     `Error: unknown command "events" for "bd"` — so this path is never
 *     reachable today. It only activates if a future `bd` actually answers
 *     the detection probe below.
 *
 * The detection probe runs at most once per process. The first call to
 * `shouldRefresh()` that is not already satisfied by the resync backstop
 * tries `bd events tail --since 0 --limit 1`; any failure — bd 1.2.2's
 * "unknown command" today, a hypothetical 409 or "journal disabled" response
 * from a future bd with the journal turned off, or anything else — locks the
 * strategy onto `watermark` for the rest of the session. It is never asked
 * again. The same permanent fallback applies if a *later* `events` call ever
 * fails after the fast path was believed to be active (the journal going
 * away mid-session): this is a deliberate design choice broader than the
 * bead's literal "unknown command" wording, made because a local CLI's
 * failure mode is deterministic per binary/version — retrying it every tick
 * could never succeed once it has failed once.
 *
 * Either probe still answers through the same `PollGate`, so the 12-tick
 * full-resync backstop (`FULL_RESYNC_TICKS` in `store.ts`) is unchanged and
 * applies to both paths identically — this class owns the `PollGate`
 * instance so `store.ts` no longer has to.
 */
import { PollGate, DEFAULT_RESYNC_TICKS } from '../poll-gate';
import type { BdQueries } from './queries';

/**
 * Rows fetched per `events tail` call once the fast path is active.
 * [Inference] Arbitrary — correctness never depends on this number, only on
 * the 12-tick backstop still running underneath, so any missed event is
 * caught within one resync cycle regardless of page size.
 */
export const EVENTS_PAGE_SIZE = 50;

type Mode = 'undetermined' | 'watermark' | 'events';

export class ChangeProbeStrategy {
  private readonly gate: PollGate;
  private mode: Mode = 'undetermined';
  /** Last `events` sequence number consumed. Only meaningful once `mode === 'events'`. */
  private seq = 0;

  constructor(
    private readonly queries: BdQueries,
    resyncAfterTicks: number = DEFAULT_RESYNC_TICKS,
  ) {
    this.gate = new PollGate(resyncAfterTicks);
  }

  /**
   * A full refresh has landed: the data is current, so any fingerprint the
   * probe was tracking is stale. Delegates to `PollGate.reset()` — same
   * "adopt the next value silently" semantics as before extraction.
   *
   * `seq` is deliberately left untouched: a refresh does not tell us the
   * journal's latest position, and re-seeing already-known events on the
   * next probe only costs one redundant refresh, never wrong data.
   */
  reset(): void {
    this.gate.reset();
  }

  /**
   * One probe cycle. Resolves `true` when the caller should run a full
   * `store.refresh()` — either the backstop is due, or the probe itself
   * found somebody else's change. Resolves `false` when nothing changed.
   *
   * Can still reject: a `watermark` probe failure (the only live path today)
   * propagates exactly as it did before extraction, so `store.tick()`'s
   * existing catch-and-log stays the single place that handles it.
   */
  async shouldRefresh(): Promise<boolean> {
    if (this.gate.dueForResync()) return true;

    // `detect()` folds the detection probe's own verdict into this tick's
    // answer, so the very first tick costs exactly one `bd` call — never a
    // detection probe *and* a follow-up `probeEvents()` in the same cycle.
    if (this.mode === 'undetermined') return this.detect();

    return this.mode === 'events' ? this.probeEvents() : this.probeWatermark();
  }

  private async probeWatermark(): Promise<boolean> {
    return this.gate.changed(await this.queries.watermark());
  }

  private async probeEvents(): Promise<boolean> {
    try {
      const page = await this.queries.eventsTail(this.seq, EVENTS_PAGE_SIZE);
      this.seq = page.latestSeq;
      return page.events.length > 0;
    } catch {
      // The journal went away mid-session (disabled, a 409, or anything
      // else) — fall back permanently rather than retry a broken path every
      // tick. This tick still needs an answer, so it is honoured via
      // watermark rather than surfaced as a probe failure.
      this.mode = 'watermark';
      return this.probeWatermark();
    }
  }

  /**
   * Runs at most once per session: decides whether `events` is real on this
   * bd, and — since the detection call (`--since 0 --limit 1`) is itself a
   * valid probe — doubles as this tick's answer instead of spending a second
   * `bd` call to ask again.
   */
  private async detect(): Promise<boolean> {
    try {
      const page = await this.queries.eventsTail(0, 1);
      this.mode = 'events';
      this.seq = page.latestSeq;
      return page.events.length > 0;
    } catch {
      // Covers bd 1.2.2's "unknown command" (the only case verified against a
      // real binary), a hypothetical 409 / "journal disabled" response, and
      // any other failure — every one of them means the fast path is not
      // available, and it is never worth asking a second time. This tick
      // still needs an answer, so it falls through to watermark rather than
      // returning early with a guess.
      this.mode = 'watermark';
      return this.probeWatermark();
    }
  }
}
