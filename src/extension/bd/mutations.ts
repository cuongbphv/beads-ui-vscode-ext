/**
 * Every write the extension performs against beads.
 *
 * The scope is deliberately narrow — create, status, priority, assignee, due, estimate,
 * close, comment/notes, text fields (title/description/design/acceptance/notes), claim,
 * gate resolution and dependency edges — which is the "view + quick actions + create"
 * contract. Deleting and reparenting issues stay in the `bd` CLI where the user can see
 * exactly what they ran.
 *
 * Nothing here runs `bd init`, `bd dolt push` or `bd dolt pull`: syncing is the
 * user's decision, never a side effect of clicking a card.
 */
import type { CreateBeadParams, DepType, TextField } from '../../shared/protocol';
import type { Priority } from '../../shared/types';
import type { BdService } from './BdService';

/** `updateText`'s field-to-flag mapping — CLI shape, not beads vocabulary. */
const TEXT_FLAGS: Record<TextField, string> = {
  title: '--title',
  description: '--description',
  design: '--design',
  acceptance: '--acceptance',
  notes: '--notes',
};

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
   * Create an issue. `--silent` makes bd print only the new id, which is the
   * whole reason this can return `{ id }` without a follow-up lookup.
   *
   * `bd create` has no `--status` flag (verified against the CLI reference),
   * so a requested status lands via a follow-up `bd update <id> --status`
   * once the id is known. Listeners fire exactly once, after every write for
   * this create has succeeded, so views never repaint against a half-created
   * issue.
   */
  async create(input: CreateBeadParams): Promise<{ id: string }> {
    const args = ['create', input.title, '--silent'];
    if (input.type !== undefined) args.push('-t', input.type);
    if (input.priority !== undefined) args.push('-p', input.priority);
    if (input.parent !== undefined) args.push('--parent', input.parent);
    if (input.labels !== undefined && input.labels.length > 0) args.push('-l', input.labels.join(','));
    if (input.due !== undefined) args.push('--due', input.due);
    // bd stores whole minutes, same rounding contract as setEstimate.
    if (input.estimate !== undefined) args.push('-e', String(Math.round(input.estimate)));
    if (input.description !== undefined) args.push('-d', input.description);
    if (input.design !== undefined) args.push('--design', input.design);
    if (input.acceptance !== undefined) args.push('--acceptance', input.acceptance);

    const id = (await this.bd.exec(args)).trim();
    if (id === '') {
      throw new Error('bd create --silent printed no id; the issue may not have been created.');
    }
    if (input.status !== undefined) {
      await this.bd.exec(['update', id, '--status', input.status]);
    }
    this.notify([id]);
    return { id };
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
   * Replace one text-shaped field wholesale. The router narrows `field`
   * against the allowlist and rejects an empty `text` for `title` before
   * this is ever called, so this trusts the caller and just maps `field`
   * to its flag via `TEXT_FLAGS`.
   */
  async updateText(id: string, field: TextField, text: string): Promise<void> {
    await this.run(['update', id, TEXT_FLAGS[field], text], id);
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

  /**
   * Add a dependency edge (`bd dep add <id> <dependsOn> --type <type>`). The
   * router narrows `id`/`dependsOn`/`type` (self-edge rejected, `type`
   * checked against `DEP_TYPES`) before this is ever called, so this trusts
   * the caller. A cycle bd itself refuses to create is not special-cased:
   * `BdService` turns bd's non-zero exit into a normal `RpcError`, which
   * reaches the webview as a toast.
   */
  async addDependency(id: string, dependsOn: string, type: DepType): Promise<void> {
    await this.run(['dep', 'add', id, dependsOn, '--type', type], id, dependsOn);
  }

  /**
   * Remove a dependency edge (`bd dep remove <id> <dependsOn>`).
   *
   * `bd dep remove` takes no `--type` flag at all (verified against
   * `CLI_REFERENCE.md`: `bd dep remove [issue-id] [depends-on-id]` lists no
   * flags), and measuring it live in `src/test/bd-live.test.ts` confirms it
   * removes every edge kind between the pair, not only the default `blocks`
   * kind — so this never attempts to pass one.
   */
  async removeDependency(id: string, dependsOn: string): Promise<void> {
    await this.run(['dep', 'remove', id, dependsOn], id, dependsOn);
  }

  /**
   * Add a label (`bd update <id> --add-label <label>` — flag name confirmed
   * against `bd update --help` on the installed CLI). The router rejects a
   * blank `id`/`label` before this is ever called; labels are user-defined
   * and unbounded, so there is no allowlist for this to check `label`
   * against.
   */
  async addLabel(id: string, label: string): Promise<void> {
    await this.run(['update', id, '--add-label', label], id);
  }

  /**
   * Remove a label (`bd update <id> --remove-label <label>` — flag name
   * confirmed against `bd update --help` on the installed CLI).
   */
  async removeLabel(id: string, label: string): Promise<void> {
    await this.run(['update', id, '--remove-label', label], id);
  }

  private async run(args: string[], ...changedIds: string[]): Promise<void> {
    await this.bd.exec(args);
    this.notify(changedIds);
  }

  private notify(changedIds: string[]): void {
    for (const listener of this.listeners) listener(changedIds);
  }
}
