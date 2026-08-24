/**
 * Every read the extension performs against beads.
 *
 * Each function owns exactly one `bd` argv. Callers pass domain values
 * (a filter object, an id) and never assemble CLI flags themselves.
 */
import { diffHistory, type HistoryEvent, type HistorySnapshot } from '../../shared/history-diff';
import {
  toMolDetail,
  toMolProgress,
  toMolWisp,
  toStaleIds,
  type MolDetail,
  type MolProgress,
  type MolSnapshot,
  type MolWisp,
} from '../../shared/mol';
import type {
  Bead,
  BeadComment,
  BeadFilters,
  BdContext,
  BdGate,
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

/** `bd history` defaults to 50 commits when no `--limit` is given. */
export const DEFAULT_HISTORY_LIMIT = 50;

/** One row of `bd history <id> --json`'s bare array, before translation. */
interface RawHistoryCommit {
  CommitHash?: string;
  Committer?: string;
  CommitDate?: string;
  Issue?: Partial<Bead>;
}

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
   * Open gates. `bd gate list --json` answers with a bare array, or `null`
   * when the project has none — `pickArray` turns both into `[]`/the array.
   */
  async gates(): Promise<BdGate[]> {
    return pickArray<BdGate>(await this.bd.jsonShared<unknown>(['gate', 'list']), 'gates', 'issues');
  }

  /**
   * "Has anything changed?" in one `bd` call.
   *
   * A full snapshot is a six-way fan-out; asking that on a timer would spawn six
   * processes every few seconds to learn that nothing happened. `--sort updated`
   * returns newest-first, so a single row is enough to fingerprint the whole
   * project: any `bd` write bumps `updated_at` on the row it touched.
   *
   * The id is part of the fingerprint because bd's timestamps have one-second
   * resolution — two different issues touched in the same second would otherwise
   * look identical. Two writes to the *same* issue inside one second still
   * collapse into one fingerprint, which is why the store also forces a full
   * resync on a slow cycle.
   */
  async watermark(): Promise<string> {
    const rows = pickArray<Bead>(
      await this.bd.jsonShared<unknown>([
        'list',
        '--flat',
        '--all',
        '--sort',
        'updated',
        '--limit',
        '1',
      ]),
      'issues',
    );
    const newest = rows[0];
    return newest ? `${newest.id}@${newest.updated_at ?? ''}` : '';
  }

  /**
   * "What changed, by whom" for one issue, derived from `bd history --json`
   * (verified against bd 1.2.2: a bare array of `{CommitHash, Committer,
   * CommitDate, Issue}`, newest commit first — there is no `--events` flag).
   *
   * The diff runs here, not in the webview: `Issue` is the *entire* issue
   * body at that commit, so a 50-commit history of a big issue is megabytes
   * of design/acceptance/notes text repeated over and over. `diffHistory`
   * turns that into a handful of field-change events before it ever reaches
   * `postMessage`.
   */
  async history(id: string, limit = DEFAULT_HISTORY_LIMIT): Promise<HistoryEvent[]> {
    const args = ['history', id];
    if (limit) args.push('--limit', String(limit));

    const rows = pickArray<RawHistoryCommit>(await this.bd.json<unknown>(args));
    const snapshots: HistorySnapshot[] = rows.map((row) => ({
      hash: row.CommitHash ?? '',
      actor: row.Committer ?? '',
      at: row.CommitDate ?? '',
      issue: {
        status: row.Issue?.status,
        priority: row.Issue?.priority,
        assignee: row.Issue?.assignee,
        title: row.Issue?.title,
        labels: row.Issue?.labels,
        description: row.Issue?.description,
        design: row.Issue?.design,
        acceptance_criteria: row.Issue?.acceptance_criteria,
      },
    }));

    return diffHistory(snapshots);
  }

  /**
   * Molecule roots: plain issue rows with `issue_type: 'molecule'` — bd 1.2.2
   * emits no `mol_type` field to filter on client-side (fixtures/mol/README.md
   * #5), so `--type molecule` on the CLI side is the only filter needed.
   */
  async molRoots(): Promise<Bead[]> {
    return pickArray<Bead>(
      await this.bd.json<unknown>(['list', '--flat', '--type', 'molecule']),
      'issues',
    );
  }

  /**
   * `bd mol progress <id> --json` — a bare object, not an array; no rate/ETA
   * fields are emitted despite the CLI's help text (fixtures/mol/README.md #1).
   */
  async molProgress(id: string): Promise<MolProgress> {
    return toMolProgress(await this.bd.json<unknown>(['mol', 'progress', id]));
  }

  /**
   * `bd mol show <id> --parallel --json`. Gate dependencies never appear in
   * `blocked_by` and never flip `is_ready` (fixtures/mol/README.md #2) — a
   * step waiting only on an open gate can still come back `ready` here; gate
   * awareness is out of scope for this read model.
   */
  async molShow(id: string): Promise<MolDetail> {
    return toMolDetail(await this.bd.json<unknown>(['mol', 'show', id, '--parallel']));
  }

  /**
   * `bd mol wisp list --json` → `{count, wisps: [...]}`, root and step rows
   * both included. Rows key the issue type as `type`, never `wisp_type`
   * (fixtures/mol/README.md #5, #6).
   */
  async wisps(): Promise<MolWisp[]> {
    return pickArray<Record<string, unknown>>(
      await this.bd.json<unknown>(['mol', 'wisp', 'list']),
      'wisps',
    ).map(toMolWisp);
  }

  /**
   * `bd mol stale --json`. On bd 1.2.2 only epic-type roots are ever flagged
   * (fixtures/mol/README.md #10) — a molecule-only project should expect this
   * to settle to `[]` in practice, not because it's hardcoded but because bd
   * itself has nothing to report.
   */
  async molStaleIds(): Promise<string[]> {
    return toStaleIds(await this.bd.json<unknown>(['mol', 'stale']));
  }

  /**
   * Composes the Molecules tab's one round trip. Short-circuits before any
   * per-root or project-wide mol/gate read when there are no molecule roots —
   * the common case — so a project with none costs exactly the one `bd list`
   * call above. Otherwise fans `molProgress` out per root via
   * `Promise.allSettled`: one broken molecule's progress read degrades only
   * its own card (and flips the snapshot's `degraded` flag) instead of
   * blanking the whole tab.
   */
  async molSnapshot(): Promise<MolSnapshot> {
    const roots = await this.molRoots();
    if (roots.length === 0) {
      return { molecules: [], wisps: [], gates: [], fetchedAt: new Date().toISOString(), degraded: false };
    }

    const [progressOutcomes, staleIds, wisps, gates] = await Promise.all([
      Promise.allSettled(roots.map((root) => this.molProgress(root.id))),
      this.molStaleIds(),
      this.wisps(),
      this.gates(),
    ]);

    const staleSet = new Set(staleIds);
    let degraded = false;
    const molecules = roots.map((root, index) => {
      const outcome = progressOutcomes[index];
      if (outcome.status === 'fulfilled') {
        return { root, progress: outcome.value, stale: staleSet.has(root.id), degraded: false };
      }
      degraded = true;
      return { root, progress: null, stale: staleSet.has(root.id), degraded: true };
    });

    return { molecules, wisps, gates, fetchedAt: new Date().toISOString(), degraded };
  }

  /**
   * One round trip that fills the entire dashboard. The calls are independent,
   * so they run concurrently; BdService coalesces the ones the tree also wants.
   */
  async snapshot(limit = DEFAULT_ISSUE_LIMIT): Promise<DashboardSnapshot> {
    const [context, vocabulary, stats, beads, ready, blocked, gates] = await Promise.all([
      this.context(),
      this.vocabulary(),
      this.stats(),
      this.list({ all: true, limit }),
      this.ready(),
      this.blocked(),
      this.gates(),
    ]);

    return {
      context,
      vocabulary,
      stats,
      beads,
      readyIds: ready.map((b) => b.id),
      blockedIds: blocked.map((b) => b.id),
      gates,
      truncated: beads.length >= limit,
      fetchedAt: new Date().toISOString(),
    };
  }
}
