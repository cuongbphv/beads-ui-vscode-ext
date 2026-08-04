/**
 * Every read the extension performs against beads.
 *
 * Each function owns exactly one `bd` argv. Callers pass domain values
 * (a filter object, an id) and never assemble CLI flags themselves.
 */
import type {
  Bead,
  BeadComment,
  BeadFilters,
  BdContext,
  BdStats,
  BdVocabulary,
  DashboardSnapshot,
  IssueTypeDef,
  StatusDef,
} from '../../shared/types';
import { toCategory } from '../../shared/types';
import type { BdService } from './BdService';

/** `bd list` defaults to 50 rows; the dashboard wants the whole project. */
export const DEFAULT_ISSUE_LIMIT = 2000;

/** bd wraps several payloads in a keyed object rather than returning a bare array. */
function pickArray<T>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

export class BdQueries {
  private vocabularyCache: BdVocabulary | undefined;

  constructor(private readonly bd: BdService) {}

  /**
   * Cheapest possible bootstrap: reports bd's version and the resolved `.beads`
   * directory without opening the Dolt database, so it still answers when the
   * database itself is unhappy.
   */
  async context(): Promise<BdContext> {
    const raw = await this.bd.jsonShared<Record<string, unknown>>(['context']);
    return {
      bd_version: String(raw?.bd_version ?? 'unknown'),
      beads_dir: String(raw?.beads_dir ?? ''),
      // bd emits both; `repo_root` is the store's root, `cwd_repo_root` is ours.
      repo_root: String(raw?.repo_root ?? raw?.cwd_repo_root ?? ''),
      database: raw?.database as string | undefined,
      backend: raw?.backend as string | undefined,
      dolt_mode: raw?.dolt_mode as string | undefined,
      project_id: raw?.project_id as string | undefined,
      role: raw?.role as string | undefined,
      is_worktree: raw?.is_worktree as boolean | undefined,
      is_redirected: raw?.is_redirected as boolean | undefined,
      sync_remote: raw?.sync_remote as string | undefined,
    };
  }

  /**
   * Statuses and types are user-extensible, so the UI loads them instead of
   * hardcoding a column list. They cannot change while a window is open, so one
   * fetch per session is enough.
   */
  async vocabulary(): Promise<BdVocabulary> {
    if (this.vocabularyCache) return this.vocabularyCache;

    const [statusPayload, typePayload] = await Promise.all([
      this.bd.jsonShared<unknown>(['statuses']),
      this.bd.jsonShared<unknown>(['types']),
    ]);

    const statuses = pickArray<StatusDef>(
      statusPayload,
      'built_in_statuses',
      'statuses',
      'custom_statuses',
    );
    const custom = pickArray<StatusDef>(statusPayload, 'custom_statuses')
      .filter((s) => !statuses.some((known) => known.name === s.name))
      .map((s) => ({ ...s, custom: true }));

    const types = pickArray<IssueTypeDef>(typePayload, 'core_types', 'types');
    const customTypes = pickArray<IssueTypeDef>(typePayload, 'custom_types')
      .filter((t) => !types.some((known) => known.name === t.name))
      .map((t) => ({ ...t, custom: true }));

    this.vocabularyCache = {
      statuses: [...statuses, ...custom].map((s) => ({ ...s, category: toCategory(s.category) })),
      types: [...types, ...customTypes],
    };
    return this.vocabularyCache;
  }

  async stats(): Promise<BdStats> {
    const raw = await this.bd.jsonShared<{ summary?: BdStats } | BdStats>(['stats']);
    const summary = (raw as { summary?: BdStats })?.summary ?? (raw as BdStats);
    return {
      total_issues: summary?.total_issues ?? 0,
      open_issues: summary?.open_issues ?? 0,
      in_progress_issues: summary?.in_progress_issues ?? 0,
      blocked_issues: summary?.blocked_issues ?? 0,
      closed_issues: summary?.closed_issues ?? 0,
      deferred_issues: summary?.deferred_issues ?? 0,
      pinned_issues: summary?.pinned_issues ?? 0,
      ready_issues: summary?.ready_issues ?? 0,
      epics_eligible_for_closure: summary?.epics_eligible_for_closure,
      average_lead_time_hours: summary?.average_lead_time_hours,
    };
  }

  /** `bd list` with the subset of flags the UI exposes. */
  async list(filters: BeadFilters = {}): Promise<Bead[]> {
    const args = ['list', '--flat'];

    // Repeating -s silently overwrites in bd; the comma form is the only one
    // that survives a multi-status filter.
    if (filters.status?.length) args.push('--status', filters.status.join(','));
    // `--type` is single-valued — bd rejects "epic,task" outright — so only a
    // one-type filter goes to the CLI and the rest is applied below.
    if (filters.type?.length === 1) args.push('--type', filters.type[0]);
    if (filters.label?.length) args.push('--label', filters.label.join(','));
    if (typeof filters.priority === 'number') args.push('--priority', String(filters.priority));
    if (filters.parent) args.push('--parent', filters.parent);
    if (filters.ready) args.push('--ready');
    if (filters.all) args.push('--all');
    if (filters.sort) args.push('--sort', filters.sort);
    args.push('--limit', String(filters.limit ?? DEFAULT_ISSUE_LIMIT));

    const rows = pickArray<Bead>(await this.bd.json<unknown>(args), 'issues');
    if (filters.type && filters.type.length > 1) {
      const wanted = new Set(filters.type);
      return rows.filter((bead) => wanted.has(bead.issue_type));
    }
    return rows;
  }

  /**
   * `bd show --json` answers with an array even for a single id.
   *
   * `--long` is what fills in design, acceptance criteria, notes, due date,
   * estimate, owner and external ref — a list row carries none of them, so the
   * detail pane would show a half-empty issue without it.
   */
  async show(id: string, includeComments = false): Promise<{ bead: Bead | null; comments: BeadComment[] }> {
    const args = ['show', id, '--long'];
    if (includeComments) args.push('--include-comments');

    const rows = pickArray<Bead & { comments?: BeadComment[] }>(
      await this.bd.json<unknown>(args),
      'issues',
    );
    const bead = rows[0] ?? null;
    return { bead, comments: bead?.comments ?? [] };
  }

  /**
   * Children of an epic. `--parent` hides closed issues unless `--all` is
   * passed, which would silently under-report every epic's progress.
   */
  async children(parentId: string): Promise<Bead[]> {
    return this.list({ parent: parentId, all: true, limit: DEFAULT_ISSUE_LIMIT });
  }

  async ready(): Promise<Bead[]> {
    return pickArray<Bead>(await this.bd.jsonShared<unknown>(['ready']), 'issues');
  }

  async blocked(): Promise<Bead[]> {
    return pickArray<Bead>(await this.bd.jsonShared<unknown>(['blocked']), 'issues');
  }

  /**
   * One round trip that fills the entire dashboard. The calls are independent,
   * so they run concurrently; BdService coalesces the ones the tree also wants.
   */
  async snapshot(limit = DEFAULT_ISSUE_LIMIT): Promise<DashboardSnapshot> {
    const [context, vocabulary, stats, beads, ready, blocked] = await Promise.all([
      this.context(),
      this.vocabulary(),
      this.stats(),
      this.list({ all: true, limit }),
      this.ready(),
      this.blocked(),
    ]);

    return {
      context,
      vocabulary,
      stats,
      beads,
      readyIds: ready.map((b) => b.id),
      blockedIds: blocked.map((b) => b.id),
      truncated: beads.length >= limit,
      fetchedAt: new Date().toISOString(),
    };
  }
}
