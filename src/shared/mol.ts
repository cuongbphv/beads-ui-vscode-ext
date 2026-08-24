/**
 * Molecules tab: read model shared between the extension host and the
 * webview, describing molecule roots, their steps, wisps and (eventually)
 * gates as `bd mol`/`bd gate` report them.
 *
 * Framework-free by contract (see CLAUDE.md): no `vscode`, no `react` here.
 * Every shape below mirrors REAL `bd` 1.2.2 JSON captured in
 * `src/test/fixtures/mol/` (bead beads-ui-vscode-ext-8eo.1) — see
 * `src/test/fixtures/mol/README.md` for exactly how each fixture was
 * produced and which fields were verified absent. Two hard rules that
 * fixture run established and this file must not violate:
 *
 *   - `mol_type` / `wisp_type` do not exist on any bd 1.2.2 JSON row. Wisp
 *     rows carry the issue type under the key `type`.
 *   - Only four step states have ever been observed on bd 1.2.2 (`done`,
 *     `ready`, `current`, `pending`); `blocked` was not — a step behind an
 *     open gate still reports `ready`, because gates are invisible to both
 *     `mol show --parallel`'s `blocked_by` and `mol current`'s step status.
 *     This file has no fifth `blocked` state; an unrecognised value degrades
 *     to `pending` rather than throwing.
 *
 * The functions here take already-parsed JSON (`unknown`) and translate it
 * defensively — they never throw on a shape they don't recognise, matching
 * `queries.ts`'s existing `pickArray` convention for the same reason: a
 * partial/odd payload should degrade a card, not crash the tab.
 */
import { formatDurationMs } from './lease';
import type { Bead, BdGate, GateAwaitType } from './types';

/** The four step states bd 1.2.2 has ever been observed to report. */
export type MolStepStatus = 'done' | 'ready' | 'current' | 'pending';

const KNOWN_STEP_STATUSES: ReadonlySet<string> = new Set(['done', 'ready', 'current', 'pending']);

/**
 * Normalises a step status bd already computed for us (e.g. from
 * `mol current --json`'s `steps[].status`). Anything this build does not
 * recognise — a future bd version's fifth state, a typo, `null` — degrades
 * to `'pending'` instead of throwing.
 */
export function normalizeStepStatus(value: unknown): MolStepStatus {
  return typeof value === 'string' && KNOWN_STEP_STATUSES.has(value)
    ? (value as MolStepStatus)
    : 'pending';
}

/**
 * Derives a step's display state from the raw issue status plus the two
 * flags `mol show --parallel` gives per step (`is_ready`) and the molecule's
 * current pointer (`isCurrent`). This is a *translation* of data bd already
 * trusts, not a new state machine: it produces exactly the same four values
 * `mol current --json` reports on its own steps (verified against
 * `fixtures/mol/mol-show-parallel.json` vs `fixtures/mol/mol-current.json`
 * for the same molecule — every step's derived state matches bd's own).
 */
export function stepStateOf(
  rawStatus: string | undefined,
  isReady: boolean,
  isCurrent: boolean,
): MolStepStatus {
  if (rawStatus === 'closed') return 'done';
  if (isCurrent || rawStatus === 'in_progress') return 'current';
  if (isReady) return 'ready';
  return 'pending';
}

/**
 * One row of `bd mol progress <id> --json` (a bare object, not an array).
 * No rate/ETA fields are ever emitted on bd 1.2.2 despite the CLI's help
 * text advertising them (fixtures/mol/README.md #1) — they are simply
 * absent from this type.
 */
export interface MolProgress {
  molecule_id: string;
  molecule_title: string;
  total: number;
  completed: number;
  in_progress: number;
  /** Integer 0-100. */
  percent: number;
  current_step_id?: string;
  schema_version?: number;
}

/** Defensively narrows a `bd mol progress --json` payload into `MolProgress`. */
export function toMolProgress(raw: unknown): MolProgress {
  const r = asRecord(raw);
  return {
    molecule_id: str(r.molecule_id),
    molecule_title: str(r.molecule_title),
    total: num(r.total),
    completed: num(r.completed),
    in_progress: num(r.in_progress),
    percent: num(r.percent),
    current_step_id: optStr(r.current_step_id),
    schema_version: optNum(r.schema_version),
  };
}

/**
 * A step's open-gate badge, attached by {@link withGateBadges} — never by
 * `toMolDetail` itself. `mol show --parallel`'s own `dependencies` array can
 * never carry this edge: `loadTemplateSubgraph` (beads' `cmd/bd/template.go`)
 * only keeps a dependency when BOTH ends are already inside the molecule
 * subgraph, and a gate created via `bd gate create --blocks <step>` never
 * is. Instead, a plain `bd show <step-id>... --json` already returns each
 * step's own `dependencies[]` with the gate's fields inlined (verified live
 * against bd 1.2.2, this bead, 2026-08-25, isolated scratch project — no
 * `--include-dependents` needed for this direction; that flag only affects
 * the reverse `dependents[]` list) — see {@link gatesByStepId}.
 */
export interface MolStepGate {
  gateId: string;
  awaitType: GateAwaitType;
  awaitId?: string;
  /** Go nanoseconds, as `bd gate list`/`bd show` emit it — never a string. */
  timeout?: number;
}

/** One step inside a molecule's detail view. */
export interface MolStep {
  issue: Bead;
  status: MolStepStatus;
  is_current: boolean;
  /**
   * Non-empty `parallel_group` name from `mol show --parallel`'s own
   * per-step analysis; `undefined` when the step is ungrouped or parallel
   * data was unavailable (`parallelAvailable: false` on the parent detail).
   */
  parallelGroup?: string;
  /** Set only by {@link withGateBadges}; always `undefined` straight out of `toMolDetail`. */
  gate?: MolStepGate;
}

/**
 * One molecule's detail, assembled from `bd mol show <id> --parallel --json`.
 *
 * `progress` is always `null` here — `mol show` never reports it, and this
 * bead does not fan out a second `mol progress` call to fill it in; a future
 * caller that already has both can merge them. `parallelAvailable` is `true`
 * only when the raw `parallel` block parsed and contains at least one group,
 * so a caller can degrade to a flat step list when it can't.
 */
export interface MolDetail {
  root: Bead;
  steps: MolStep[];
  parallelAvailable: boolean;
  progress: MolProgress | null;
}

interface RawParallelStep {
  status?: string;
  is_ready?: boolean;
  parallel_group?: string;
}

/**
 * Defensively narrows a `bd mol show --parallel --json` payload into
 * `MolDetail`. Never throws: a missing/odd `parallel` block just yields
 * `parallelAvailable: false` and steps derived from `issues`/root status
 * alone (every step falls back through `stepStateOf`'s `isReady: false`
 * branch, i.e. `pending`, unless it is closed or in progress).
 */
export function toMolDetail(raw: unknown): MolDetail {
  const r = asRecord(raw);
  const root = asRecord(r.root) as unknown as Bead;
  const issues = Array.isArray(r.issues) ? (r.issues as Bead[]) : [];
  const parallel = asRecord(r.parallel);
  const parallelSteps = asRecord(parallel.steps) as Record<string, RawParallelStep>;
  const parallelGroups = asRecord(parallel.parallel_groups);
  const parallelAvailable = Object.keys(parallel).length > 0 && Object.keys(parallelGroups).length > 0;

  const rootId = typeof root.id === 'string' ? root.id : undefined;
  const steps: MolStep[] = issues
    .filter((issue) => issue.id !== rootId)
    .map((issue) => {
      const info = parallelSteps[issue.id] ?? {};
      const isCurrent = issue.status === 'in_progress';
      const status = stepStateOf(issue.status, info.is_ready === true, isCurrent);
      const parallelGroup =
        parallelAvailable && typeof info.parallel_group === 'string' && info.parallel_group !== ''
          ? info.parallel_group
          : undefined;
      return { issue, status, is_current: status === 'current', parallelGroup };
    });

  return { root, steps, parallelAvailable, progress: null };
}

/**
 * Extracts, from a batched `bd show <step-id>... --json` payload, the open
 * gate (if any) blocking each step. Each row's own `dependencies[]` embeds
 * the full dependency issue inline — a gate dependency row carries
 * `issue_type: "gate"`, its `status`, and its `await_type`/`await_id`/
 * `timeout` directly, with no extra flag needed (verified live against bd
 * 1.2.2, isolated scratch project, 2026-08-25: `bd show <gate-id>
 * --include-dependents --json` was NOT required for this direction — a
 * plain `bd show <step-id> --json` already returns the step's own
 * `dependencies[]` populated). Never throws: an unparseable row or a step
 * with no gate dependency is simply absent from the returned map.
 */
export function gatesByStepId(raw: unknown): Map<string, MolStepGate> {
  const rows = Array.isArray(raw) ? raw : [];
  const result = new Map<string, MolStepGate>();
  for (const row of rows) {
    const r = asRecord(row);
    const stepId = typeof r.id === 'string' ? r.id : undefined;
    if (!stepId) continue;

    const deps = Array.isArray(r.dependencies) ? r.dependencies : [];
    for (const depRaw of deps) {
      const dep = asRecord(depRaw);
      if (dep.issue_type !== 'gate' || dep.status !== 'open' || typeof dep.await_type !== 'string') {
        continue;
      }
      result.set(stepId, {
        gateId: typeof dep.id === 'string' ? dep.id : '',
        awaitType: dep.await_type as GateAwaitType,
        awaitId: typeof dep.await_id === 'string' ? dep.await_id : undefined,
        timeout: typeof dep.timeout === 'number' ? dep.timeout : undefined,
      });
      break; // A step blocked by more than one open gate badges the first found.
    }
  }
  return result;
}

/**
 * Attaches a gate badge to any step whose id is in `gatesByStep` — the pure
 * merge step `BdQueries.showMolecule` runs after its own batched `bd show`
 * call settles, kept separate from `toMolDetail` so a caller with only the
 * `mol show --parallel` payload (no gate data yet) still gets a fully valid
 * `MolDetail` with every `step.gate` simply `undefined`.
 */
export function withGateBadges(steps: readonly MolStep[], gatesByStep: ReadonlyMap<string, MolStepGate>): MolStep[] {
  return steps.map((step) => {
    const gate = gatesByStep.get(step.issue.id);
    return gate ? { ...step, gate } : step;
  });
}

/**
 * One row of `bd mol wisp list --json`'s `wisps` array. The issue type is
 * keyed `type` here (`"molecule"` for the wisp root, `"task"` for its
 * steps) — bd 1.2.2 emits no `wisp_type`/`mol_type`/ephemeral marker on
 * these rows at all (fixtures/mol/README.md #5, #6).
 */
export interface MolWisp {
  id: string;
  title: string;
  status: string;
  priority: number;
  type: string;
  created_at?: string;
  updated_at?: string;
}

/** Defensively narrows one `bd mol wisp list --json` row into `MolWisp`. */
export function toMolWisp(raw: unknown): MolWisp {
  const r = asRecord(raw);
  return {
    id: str(r.id),
    title: str(r.title),
    status: str(r.status),
    priority: num(r.priority),
    type: str(r.type),
    created_at: optStr(r.created_at),
    updated_at: optStr(r.updated_at),
  };
}

/**
 * Extracts the flagged molecule ids from `bd mol stale --json`. On bd 1.2.2
 * only epic-type roots are ever flagged (fixtures/mol/README.md #10), so a
 * molecule-only project should expect this to settle to `[]` in practice —
 * `stale_molecules` itself comes back as `null`, not `[]`, when there is
 * nothing to report, which this handles the same as an empty array.
 */
export function toStaleIds(raw: unknown): string[] {
  const r = asRecord(raw);
  const rows = Array.isArray(r.stale_molecules)
    ? (r.stale_molecules as Array<Record<string, unknown>>)
    : [];
  return rows.map((row) => str(row.id)).filter((id) => id !== '');
}

/**
 * A rough, client-side ETA for a molecule's remaining steps.
 *
 * bd 1.2.2 emits no rate/ETA fields anywhere in `mol progress` output
 * (fixtures/mol/README.md #1), so this is a heuristic derived from data we
 * already have: the completion rate implied by `progress.completed` steps
 * finished since the root's own `started_at` (falling back to
 * `created_at`), projected across the steps left. It is deliberately not
 * presented as a bd-reported figure — callers should label it as an
 * estimate (e.g. "~2h left").
 *
 * Returns `undefined` whenever there isn't enough signal to guess from: no
 * steps completed yet, nothing left to do, or a missing/unparseable start
 * time. Never throws.
 */
export function estimateEtaMs(root: Bead, progress: MolProgress, nowMs: number): number | undefined {
  if (progress.completed <= 0 || progress.total <= progress.completed) return undefined;

  const startedAt = Date.parse(root.started_at ?? root.created_at ?? '');
  if (Number.isNaN(startedAt)) return undefined;

  const elapsedMs = nowMs - startedAt;
  if (elapsedMs <= 0) return undefined;

  const ratePerMs = progress.completed / elapsedMs;
  if (ratePerMs <= 0) return undefined;

  const remaining = progress.total - progress.completed;
  return remaining / ratePerMs;
}

/**
 * A short, human-readable description of what a gate is waiting on, for the
 * gate card on the Molecules tab. `await_id` is only ever present for
 * `gh:pr`/`gh:run`/`bead` gates and `timeout` only for `timer` gates
 * (`fixtures/mol/README.md` #4) — this never fabricates either when absent,
 * and the timer's Go-nanosecond `timeout` is converted to milliseconds
 * before going through the same `formatDurationMs` the lease/ETA badges use,
 * never shown as a raw nanosecond count.
 */
export function formatGateAwait(gate: Pick<BdGate, 'await_type' | 'await_id' | 'timeout'>): string {
  const type = gate.await_type;
  if (type === 'human') return 'Waiting on a person';
  if (type === 'timer') {
    return typeof gate.timeout === 'number' ? `Timer · ${formatDurationMs(gate.timeout / 1_000_000)}` : 'Timer';
  }
  if (type === 'gh:pr') return gate.await_id ? `GitHub PR #${gate.await_id}` : 'GitHub PR';
  if (type === 'gh:run') return gate.await_id ? `GitHub run ${gate.await_id}` : 'GitHub run';
  if (type === 'bead') return gate.await_id ? `Bead ${gate.await_id}` : 'Bead';
  return type;
}

/** One molecule as it appears in the Molecules tab's list. */
export interface MolListItem {
  root: Bead;
  /** `null` when this molecule's own `mol progress` call failed. */
  progress: MolProgress | null;
  /** From `bd mol stale --json`; see `toStaleIds` — expect `false` in practice for pure-molecule projects. */
  stale: boolean;
  /** True when `progress` is `null` because this molecule's own read failed. */
  degraded: boolean;
}

/**
 * Everything the Molecules tab needs for one paint. `gates` mirrors
 * `DashboardSnapshot.gates` (all open gates, project-wide — bd has no
 * "gates blocking a molecule" filter) so a later tab can render gate cards
 * with no additional read.
 */
export interface MolSnapshot {
  molecules: MolListItem[];
  wisps: MolWisp[];
  gates: BdGate[];
  fetchedAt: string;
  /** True when at least one molecule's own progress read failed (see `MolListItem.degraded`). */
  degraded: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
