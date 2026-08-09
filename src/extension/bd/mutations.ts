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
   * Create one issue and return its id.
   *
   * Only the Velox import path uses this, and only after the user has approved
   * an explicit preview of what will be created — issue creation is otherwise
   * out of scope for a "view + quick actions" extension.
   *
   * `--silent` makes bd print the new id and nothing else.
   */
  async create(draft: {
    title: string;
    description?: string;
    type?: string;
    priority?: number;
    labels?: string[];
    parent?: string;
    externalRef?: string;
  }): Promise<string> {
    const args = ['create', draft.title, '--silent'];
    if (draft.description) args.push('--description', draft.description);
    if (draft.type) args.push('--type', draft.type);
    if (draft.priority !== undefined) args.push('--priority', String(draft.priority));
    if (draft.labels?.length) args.push('--labels', draft.labels.join(','));
    if (draft.parent) args.push('--parent', draft.parent);
    if (draft.externalRef) args.push('--external-ref', draft.externalRef);

    const id = (await this.bd.exec(args)).trim().split(/\s+/).pop() ?? '';
    for (const listener of this.listeners) listener([id]);
    return id;
  }

  private async run(args: string[], ...changedIds: string[]): Promise<void> {
    await this.bd.exec(args);
    for (const listener of this.listeners) listener(changedIds);
  }
}
