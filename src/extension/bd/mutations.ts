/**
 * Every write the extension performs against beads.
 *
 * The scope is deliberately narrow — status, priority, assignee, due, estimate, close — which
 * is the "view + quick actions" contract. Creating, deleting and reparenting
 * issues stay in the `bd` CLI where the user can see exactly what they ran.
 *
 * Nothing here runs `bd init`, `bd dolt push` or `bd dolt pull`: syncing is the
 * user's decision, never a side effect of clicking a card.
 */
import type { Priority } from '../../shared/types';
import type { BdService } from './BdService';

/** Fires after any successful write so views can refetch. */
export type MutationListener = (changedIds: string[]) => void;

export class BdMutations {
  private readonly listeners = new Set<MutationListener>();

  constructor(private readonly bd: BdService) {}

  onChanged(listener: MutationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * `status` is passed through verbatim rather than validated against an enum:
   * beads statuses are user-extensible, and bd rejects an unknown name with a
   * clear message that BdService already turns into a readable error.
   */
  async setStatus(id: string, status: string): Promise<void> {
    await this.run(['update', id, '--status', status], id);
  }

  async setPriority(id: string, priority: Priority): Promise<void> {
    await this.run(['update', id, '--priority', String(priority)], id);
  }

  /** An empty string clears the assignee — bd treats it as "unassign". */
  async setAssignee(id: string, assignee: string): Promise<void> {
    await this.run(['update', id, '--assignee', assignee], id);
  }

  async close(id: string, reason?: string): Promise<void> {
    const args = ['close', id];
    if (reason?.trim()) args.push('--reason', reason.trim());
    await this.run(args, id);
  }

  /**
   * The bar's right edge, for an issue that carries a due date.
   *
   * `date` is `YYYY-MM-DD` in the user's local calendar. An empty string clears
   * the due date, which is what bd documents for `--due ""`.
   */
  async setDue(id: string, date: string): Promise<void> {
    await this.run(['update', id, '--due', date], id);
  }

  /**
   * The bar's right edge, for an issue with no due date.
   *
   * bd stores an int, so the value is rounded here rather than trusting a
   * float to survive `String()`.
   */
  async setEstimate(id: string, minutes: number): Promise<void> {
    await this.run(['update', id, '--estimate', String(Math.round(minutes))], id);
  }

  /**
   * Claim in one atomic step (assignee = current user, status = in_progress).
   * Two separate updates would leave a half-claimed issue if the second failed.
   */
  async claim(id: string): Promise<void> {
    await this.run(['update', id, '--claim'], id);
  }

  /**
   * Resolve a human gate. `bd gate resolve --json` still only prints a text
   * confirmation line (verified on bd 1.2.2), so this goes through `exec()`
   * rather than `json()` like every other write.
   */
  async resolveGate(id: string, reason?: string): Promise<void> {
    const args = ['gate', 'resolve', id];
    if (reason?.trim()) args.push('--reason', reason.trim());
    await this.run(args, id);
  }

  /**
   * Post a comment. The router rejects an empty/whitespace-only `text` before
   * it ever reaches here, so this trusts the caller and passes it through.
   */
  async comment(id: string, text: string): Promise<void> {
    await this.run(['comment', id, text], id);
  }

  /**
   * Append to `notes` rather than replace it. bd 1.2.2 joins with a newline
   * (`--append-notes`, verified via `bd update --help` on this board), which
   * is what makes this safe to expose from the UI without a read-modify-write
   * race: two concurrent appends both land, in whatever order bd receives
   * them, instead of one clobbering the other the way a full `--notes`
   * overwrite would.
   */
  async appendNotes(id: string, text: string): Promise<void> {
    await this.run(['update', id, '--append-notes', text], id);
  }

  private async run(args: string[], ...changedIds: string[]): Promise<void> {
    await this.bd.exec(args);
    for (const listener of this.listeners) listener(changedIds);
  }
}
