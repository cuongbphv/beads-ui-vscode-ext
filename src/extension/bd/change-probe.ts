/**
 * Beads 1.3 journal probe, with a watermark fallback for disabled journals and
 * older CLIs. Every 12 ticks a full snapshot still catches unjournaled sync/SQL.
 */
import { PollGate, DEFAULT_RESYNC_TICKS } from '../poll-gate';
import { BdError } from './BdService';
import type { BdQueries } from './queries';

export const EVENTS_PAGE_SIZE = 50;
type Mode = 'undetermined' | 'watermark' | 'events';

export class ChangeProbeStrategy {
  private readonly gate: PollGate;
  private mode: Mode = 'undetermined';
  private seq = 0;

  constructor(private readonly queries: BdQueries, resyncAfterTicks = DEFAULT_RESYNC_TICKS) {
    this.gate = new PollGate(resyncAfterTicks);
  }

  /** A snapshot landed. Keep the cursor captured before that read. */
  reset(): void { this.gate.reset(); }

  /** A new CLI must detect its capabilities again. */
  restart(): void {
    this.mode = 'undetermined';
    this.seq = 0;
    this.gate.reset();
  }

  async shouldRefresh(): Promise<boolean> {
    if (this.gate.dueForResync()) {
      // Re-baseline even a recreated journal whose head dropped below our cursor.
      if (this.mode === 'events') await this.baseline();
      return true;
    }
    if (this.mode === 'undetermined') {
      if (await this.baseline()) return true;
      return this.probeWatermark();
    }
    return this.mode === 'events' ? this.probeEvents() : this.probeWatermark();
  }

  private async probeWatermark(): Promise<boolean> {
    return this.gate.changed(await this.queries.watermark());
  }

  /** Always pair a new head with a full refresh; historical pages are not changes. */
  private async baseline(): Promise<boolean> {
    try {
      const head = await this.queries.eventsHead();
      // Also verify tail capability; a head alone does not prove it is available.
      const page = await this.queries.eventsTail(head, 1);
      this.seq = page.latestSeq;
      this.mode = 'events';
      return true;
    } catch {
      this.mode = 'watermark';
      return false;
    }
  }

  private async probeEvents(): Promise<boolean> {
    try {
      const page = await this.queries.eventsTail(this.seq, EVENTS_PAGE_SIZE);
      this.seq = page.latestSeq;
      return page.events.length > 0;
    } catch (error) {
      if (error instanceof BdError && error.rpcError.code === 'events_journal_truncated') {
        await this.baseline();
      } else {
        this.mode = 'watermark';
      }
      // The first watermark is adopted silently, so refresh NOW on fallback.
      return true;
    }
  }
}
