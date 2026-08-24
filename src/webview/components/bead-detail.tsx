/**
 * Detail pane: every field beads actually stores, plus the quick actions.
 *
 * The cards are deliberately spartan, so this is where the whole record lives —
 * PIC and owner, the three long-form fields (design, acceptance criteria,
 * notes), the full date set including due and defer, the estimate, external
 * refs, metadata, both directions of the dependency graph, and comments.
 */
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  History as HistoryIcon,
  Hourglass,
  Link2,
  Lock,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Snowflake,
  StickyNote,
  Timer,
  User,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import { buildBlockerChain, type BlockerNode } from '../../shared/blocker-chain';
import type { HistoryEvent } from '../../shared/history-diff';
import { StatusIndex, edgesOfKind, parentIdOf } from '../../shared/model';
import { DEP_TYPES, type DepType, type TextField } from '../../shared/protocol';
import { formatDuration, spanOf } from '../../shared/schedule';
import {
  PARENT_CHILD,
  PRIORITY_LABELS,
  edgeKind,
  edgeTargetId,
  typeStyle,
  type Bead,
  type BeadComment,
  type BeadDependency,
  type Priority,
} from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';
import { useBeadDetail } from '../hooks/use-bead-detail';
import { useHistory } from '../hooks/use-history';
import { labelChipStyle } from '../lib/label-color';
import { absoluteTime, cn, relativeTime } from '../lib/utils';
import { IssuePicker } from './issue-picker';
import { Markdown } from './markdown';
import { Popover } from './popover';
import { Button, PriorityDot, Skeleton, StatusPill, TypeIcon } from './primitives';
import { useToast } from './toast';

/**
 * The dependency kinds shown directly in the Add-link kind select; the rest
 * of {@link DEP_TYPES} sit behind a "More kinds…" toggle so the common case
 * (blocks/related/discovered-from) does not compete with six rarer ones.
 */
const PROMINENT_DEP_TYPES: readonly DepType[] = ['blocks', 'related', 'discovered-from'];

export function BeadDetail({
  bead: summary,
  beads,
  index,
  onClose,
  onSelect,
  refreshKey,
}: {
  bead: Bead;
  beads: Bead[];
  index: StatusIndex;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** Changes whenever the host pushes a new snapshot, to refetch the record. */
  refreshKey: unknown;
}): ReactNode {
  const { notify } = useToast();
  const { bead, comments, loading } = useBeadDetail(summary, refreshKey);
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState(bead.assignee ?? '');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(bead.title);
  const [commentDraft, setCommentDraft] = useState('');
  /**
   * Optimistic label override: id → labels. Applied on top of the fetched
   * bead so a chip add/remove lands immediately; rolled back (the key is
   * dropped) on error, and retired once `beads` — the same full snapshot
   * array whose refresh drives every other view — agrees. Same shape as
   * BoardView's optimistic status override.
   */
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string[]>>({});
  /**
   * Optimistic dependency-edge override: id → the full `dependencies` array
   * to show instead of `bead.dependencies`. Same shape and lifecycle as
   * `labelOverrides` — applied immediately on add/remove, dropped on RPC
   * failure, retired once `beads` agrees.
   */
  const [depOverrides, setDepOverrides] = useState<Record<string, BeadDependency[]>>({});
  /**
   * Optimistic override for the separate `blocked_by` id list — a different
   * bd data source from `dependencies`, but the same relationship, so
   * removing an edge updates both overrides together (see
   * `removeDependencyEdge`). Merged into the "Blocked by" section alongside
   * the transitive chain below; any id here the chain does not cover still
   * gets a depth-1 row so the merge never drops data.
   */
  const [blockedByOverride, setBlockedByOverride] = useState<Record<string, string[]>>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<DepType>('blocks');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  /**
   * Defer composer draft. `deferOpen` is only ever shown when `bead.defer_until`
   * is unset — see the render below — so this never has to coexist with the
   * Undefer button.
   */
  const [deferOpen, setDeferOpen] = useState(false);
  const [deferUntilDraft, setDeferUntilDraft] = useState('');
  const [deferReasonDraft, setDeferReasonDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const {
    events: historyEvents,
    loading: historyLoading,
    error: historyError,
  } = useHistory(bead.id, historyOpen, refreshKey);

  useEffect(() => setAssignee(bead.assignee ?? ''), [bead.id, bead.assignee]);
  useEffect(() => setTitleDraft(bead.title), [bead.id, bead.title]);

  // Switching to a different issue abandons any in-progress draft — a comment
  // typed for one issue appearing under another would be a silent misfire.
  useEffect(() => {
    setCommentDraft('');
    setNoteDraft('');
    setNoteOpen(false);
    setTitleEditing(false);
    setDeferOpen(false);
    setDeferUntilDraft('');
    setDeferReasonDraft('');
    setLinkOpen(false);
    setLinkKind('blocks');
    // A different issue means a different history; collapsing it back means
    // the next fetch only happens if the user actually asks for it again,
    // rather than silently following the selection around.
    setHistoryOpen(false);
  }, [bead.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Retire each label override the moment `beads` — refreshed by the host
  // after every mutation — agrees with it; leaving one in place would mask a
  // later change made outside this pane. Same shape as BoardView's
  // optimistic-status cleanup effect.
  useEffect(() => {
    setLabelOverrides((current) => {
      const remaining = Object.entries(current).filter(([id, labels]) => {
        const match = beads.find((candidate) => candidate.id === id);
        return match === undefined || !sameStringSet(match.labels ?? [], labels);
      });
      return remaining.length === Object.keys(current).length
        ? current
        : Object.fromEntries(remaining);
    });
  }, [beads]);

  // Same retirement rule as the label-override effect above, for both
  // dependency-edge overrides: once the refreshed `beads` snapshot agrees,
  // the override is dropped rather than left to mask a later external change.
  useEffect(() => {
    setDepOverrides((current) => {
      const remaining = Object.entries(current).filter(([id, deps]) => {
        const match = beads.find((candidate) => candidate.id === id);
        return match === undefined || !sameEdgeSet(match.dependencies ?? [], deps);
      });
      return remaining.length === Object.keys(current).length
        ? current
        : Object.fromEntries(remaining);
    });
    setBlockedByOverride((current) => {
      const remaining = Object.entries(current).filter(([id, ids]) => {
        const match = beads.find((candidate) => candidate.id === id);
        return match === undefined || !sameStringSet(match.blocked_by ?? [], ids);
      });
      return remaining.length === Object.keys(current).length
        ? current
        : Object.fromEntries(remaining);
    });
  }, [beads]);

  const currentLabels = labelOverrides[bead.id] ?? bead.labels ?? [];
  const labelOptions = useMemo(
    () => Array.from(new Set(beads.flatMap((candidate) => candidate.labels ?? []))).sort(),
    [beads],
  );
  const currentDependencies = depOverrides[bead.id] ?? bead.dependencies ?? [];
  const currentBlockedBy = blockedByOverride[bead.id] ?? bead.blocked_by ?? [];
  // Ids already wired to this issue by any edge kind — bd enforces at most
  // one edge per ordered (id, dependsOn) pair regardless of type, so a
  // second `dep add` to an already-linked id is a guaranteed failure the
  // picker should never offer in the first place.
  const linkedIds = useMemo(
    () => new Set(currentDependencies.map((edge) => edgeTargetId(edge)).filter((id): id is string => !!id)),
    [currentDependencies],
  );

  /**
   * Applies the add optimistically, then calls `bd`. On failure the override
   * is dropped — reverting the chip list to whatever `bead.labels` (the last
   * fetched real value) already has — and a toast reports why.
   */
  async function addLabel(label: string): Promise<void> {
    if (currentLabels.includes(label)) return;
    setLabelOverrides((current) => ({ ...current, [bead.id]: [...currentLabels, label] }));
    try {
      await call('addLabel', { id: bead.id, label });
      notify(`${bead.id} labeled "${label}"`);
    } catch (error) {
      setLabelOverrides((current) => {
        const next = { ...current };
        delete next[bead.id];
        return next;
      });
      notify(asRpcError(error).message, 'error');
    }
  }

  /** Same shape as {@link addLabel}, removing rather than appending. */
  async function removeLabel(label: string): Promise<void> {
    setLabelOverrides((current) => ({
      ...current,
      [bead.id]: currentLabels.filter((existing) => existing !== label),
    }));
    try {
      await call('removeLabel', { id: bead.id, label });
      notify(`${bead.id} label "${label}" removed`);
    } catch (error) {
      setLabelOverrides((current) => {
        const next = { ...current };
        delete next[bead.id];
        return next;
      });
      notify(asRpcError(error).message, 'error');
    }
  }

  /**
   * Wires a new dependency edge (`addDependency`), applied optimistically to
   * `depOverrides` before the RPC resolves and rolled back on failure — same
   * shape as `addLabel`. The picker never offers `bead.id` itself (see
   * `linkedIds`/`excludeIds` at the call site below), but this is checked
   * again here regardless: rejecting a self-edge has to hold even if the
   * picker's exclusion list is ever wrong, not only when it works.
   */
  async function addDependencyEdge(dependsOn: string, type: DepType): Promise<void> {
    if (dependsOn === bead.id) {
      notify('An issue cannot depend on itself.', 'error');
      return;
    }
    const nextEdge: BeadDependency = { depends_on_id: dependsOn, type };
    setDepOverrides((current) => ({ ...current, [bead.id]: [...currentDependencies, nextEdge] }));
    setLinkOpen(false);
    try {
      await call('addDependency', { id: bead.id, dependsOn, type });
      notify(`${bead.id} → ${type} → ${dependsOn}`);
    } catch (error) {
      setDepOverrides((current) => {
        const next = { ...current };
        delete next[bead.id];
        return next;
      });
      // A cycle bd itself refuses to create arrives here as a normal
      // RpcError — no special-casing, just the same toast every other
      // rejected mutation gets.
      notify(asRpcError(error).message, 'error');
    }
  }

  /**
   * Removes a dependency edge (`removeDependency`), which — measured live in
   * `src/test/bd-live.test.ts` — removes every edge kind between the pair,
   * not only the one shown in whichever section's × triggered this. Both
   * optimistic overrides are updated together: `blocked_by` and
   * `dependencies` are two different bd data sources describing the same
   * relationship, so a removal has to disappear from both rather than only
   * the row that was clicked.
   */
  async function removeDependencyEdge(dependsOn: string): Promise<void> {
    setDepOverrides((current) => ({
      ...current,
      [bead.id]: currentDependencies.filter((edge) => edgeTargetId(edge) !== dependsOn),
    }));
    setBlockedByOverride((current) => ({
      ...current,
      [bead.id]: currentBlockedBy.filter((id) => id !== dependsOn),
    }));
    try {
      await call('removeDependency', { id: bead.id, dependsOn });
      notify(`${bead.id} no longer depends on ${dependsOn}`);
    } catch (error) {
      setDepOverrides((current) => {
        const next = { ...current };
        delete next[bead.id];
        return next;
      });
      setBlockedByOverride((current) => {
        const next = { ...current };
        delete next[bead.id];
        return next;
      });
      notify(asRpcError(error).message, 'error');
    }
  }

  /** Returns whether the write succeeded, so a caller can decide what to reset. */
  async function mutate(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      notify(success);
      return true;
    } catch (error) {
      notify(asRpcError(error).message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Clears the draft only once bd has actually accepted the comment. */
  async function submitComment(): Promise<void> {
    const text = commentDraft.trim();
    if (!text) return;
    const ok = await mutate(
      () => call('addComment', { id: bead.id, text }),
      `${bead.id} comment added`,
    );
    if (ok) setCommentDraft('');
  }

  /** Same shape as `submitComment`, but also folds the composer back up on success. */
  async function submitNote(): Promise<void> {
    const text = noteDraft.trim();
    if (!text) return;
    const ok = await mutate(
      () => call('appendNotes', { id: bead.id, text }),
      `${bead.id} notes updated`,
    );
    if (ok) {
      setNoteDraft('');
      setNoteOpen(false);
    }
  }

  /**
   * Defers the issue via the dedicated `bd defer` command (not `bd update
   * --status`). `until` accepts bd's free-form relative expressions
   * (`tomorrow`, `+1h`, `next monday`), not a strict date, so this is a
   * plain text field rather than a date picker; both it and `reason` are
   * sent as `undefined` rather than an empty string when left blank, so
   * `bd defer` sees neither flag at all.
   */
  async function submitDefer(): Promise<void> {
    const until = deferUntilDraft.trim() || undefined;
    const reason = deferReasonDraft.trim() || undefined;
    const ok = await mutate(
      () => call('deferBead', { id: bead.id, until, reason }),
      `${bead.id} deferred`,
    );
    if (ok) {
      setDeferUntilDraft('');
      setDeferReasonDraft('');
      setDeferOpen(false);
    }
  }

  /** Restores the issue from the icebox via the dedicated `bd undefer` command. */
  async function undeferBead(): Promise<void> {
    await mutate(() => call('undeferBead', { id: bead.id }), `${bead.id} undeferred`);
  }

  /** Reopens a done issue via the dedicated `bd reopen` command (not `bd update --status`). */
  async function reopenBead(): Promise<void> {
    await mutate(() => call('reopenBead', { id: bead.id }), `${bead.id} reopened`);
  }

  /**
   * Unlike the dropdowns, a rejected assignee has to be put back by hand: the
   * field keeps its own draft, and bd's record never changed, so nothing else
   * would ever correct it. An input still showing a name bd refused reads as
   * saved.
   */
  async function commitAssignee(): Promise<void> {
    const next = assignee.trim();
    if (next === (bead.assignee ?? '')) return;

    setBusy(true);
    try {
      await call('setAssignee', { id: bead.id, assignee: next });
      notify(`${bead.id} assigned to ${next || 'nobody'}`);
    } catch (error) {
      setAssignee(bead.assignee ?? '');
      notify(asRpcError(error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Same shape as `commitAssignee`: a rejected title has to be put back by
   * hand, and an empty title is nonsensical (bd itself refuses one), so an
   * edit that trims to nothing is silently reverted rather than sent.
   */
  async function commitTitle(): Promise<void> {
    const next = titleDraft.trim();
    if (!next || next === bead.title) {
      setTitleDraft(bead.title);
      setTitleEditing(false);
      return;
    }

    setBusy(true);
    try {
      await call('updateText', { id: bead.id, field: 'title', text: next });
      notify(`${bead.id} renamed`);
      setTitleEditing(false);
    } catch (error) {
      setTitleDraft(bead.title);
      notify(asRpcError(error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const done = index.isDone(bead.status);
  const span = spanOf(bead, done, Date.now());
  const parentId = parentIdOf(bead);
  const parent = parentId ? beads.find((candidate) => candidate.id === parentId) : undefined;
  const children = beads.filter((candidate) => parentIdOf(candidate) === bead.id);
  // `edgesOfKind` reads `bead.dependencies`; feeding it a bead shaped with the
  // optimistic override in place of the fetched array is what makes an
  // add/remove show up in these three lists immediately.
  const beadWithCurrentEdges: Bead = { ...bead, dependencies: currentDependencies };
  const blocks = edgesOfKind(beadWithCurrentEdges, 'blocks');
  // Why is this blocked, transitively? Only open blockers count — a done bead
  // no longer blocks anything, so the whole "Blocked by" section (chain and
  // all) is hidden for it below rather than showing stale history.
  const blockerChain = done ? undefined : buildBlockerChain(bead, beads, index);
  // `currentBlockedBy` is a second bd data source for the same relationship
  // as the chain's depth-1 rows (see the `blockedByOverride` comment above).
  // Any id it carries that the chain does not already cover — e.g. the
  // blocker bead is absent from the loaded set — still gets a depth-1 row so
  // consolidating both into one section never drops data.
  const chainIds = new Set((blockerChain?.nodes ?? []).map((node) => node.id));
  const extraBlockedByNodes: BlockerNode[] = currentBlockedBy
    .filter((id) => !chainIds.has(id))
    .map((id) => ({
      id,
      bead: beads.find((candidate) => candidate.id === id),
      depth: 1,
      cycle: false,
      truncated: false,
    }));
  const blockedByNodes: BlockerNode[] = done
    ? []
    : [...(blockerChain?.nodes ?? []), ...extraBlockedByNodes];
  const related = edgesOfKind(beadWithCurrentEdges, 'related');
  const discovered = edgesOfKind(beadWithCurrentEdges, 'discovered-from');
  const statusDef = index.def(bead.status);
  const style = typeStyle(bead.issue_type);

  return (
    <aside
      aria-label={`Details for ${bead.id}`}
      className="bg-surface border-border flex h-full min-h-0 w-full flex-col border-l"
    >
      <header
        className="border-border type-spine flex items-start gap-2 border-b px-3 py-2"
        style={{ '--type-color': style.color } as Record<string, string>}
      >
        <TypeIcon type={bead.issue_type} className={cn('mt-1', style.className)} />
        <div className="min-w-0 flex-1">
          <div className="text-fg-muted flex items-center gap-2 text-xs">
            <span className="font-mono">{bead.id}</span>
            <button
              type="button"
              title="Copy issue ID"
              className="hover:text-fg"
              onClick={() => void call('copyText', { text: bead.id })}
            >
              <Copy aria-hidden="true" className="size-3" />
              <span className="sr-only">Copy issue ID</span>
            </button>
            {bead.pinned ? (
              <span title="Pinned" className="text-warning">
                <Pin aria-hidden="true" className="size-3" />
              </span>
            ) : null}
            {loading ? <Skeleton className="ml-auto h-3 w-16" /> : null}
          </div>
          {titleEditing ? (
            <input
              autoFocus
              aria-label="Edit title"
              disabled={busy}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                  return;
                }
                if (event.key !== 'Escape') return;
                // Abandon the edit without also closing the pane, which is
                // what the window-level Escape handler would otherwise do.
                // No explicit `.blur()` here (unlike the Enter branch above):
                // `setTitleEditing(false)` unmounts this input on its own, and
                // calling `.blur()` first would fire `onBlur` synchronously
                // against this render's stale (pre-revert) `titleDraft`
                // closure, re-committing the very text Escape is abandoning.
                event.stopPropagation();
                setTitleDraft(bead.title);
                setTitleEditing(false);
              }}
              className="bg-input-bg border-input-border text-fg-strong w-full min-w-0 rounded-md border px-2 py-1 text-lg font-medium"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <h2 className="text-fg-strong text-lg leading-snug font-medium">{bead.title}</h2>
              <button
                type="button"
                aria-label="Edit title"
                disabled={busy}
                onClick={() => {
                  setTitleDraft(bead.title);
                  setTitleEditing(true);
                }}
                className="text-fg-muted hover:text-fg shrink-0"
              >
                <Pencil aria-hidden="true" className="size-3" />
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="text-fg-muted hover:text-fg shrink-0"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill
            status={bead.status}
            category={index.category(bead.status)}
            icon={statusDef?.icon}
          />
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs',
              style.className,
            )}
            style={{ borderColor: style.color }}
          >
            {bead.issue_type}
          </span>
          <PriorityDot priority={bead.priority} />
          {span.overdue ? (
            <span className="text-danger inline-flex items-center gap-1 text-xs" title="Past its due date">
              <AlertTriangle aria-hidden="true" className="size-3" />
              overdue
            </span>
          ) : null}
          {span.deferred ? (
            <span className="text-fg-muted inline-flex items-center gap-1 text-xs">
              <Snowflake aria-hidden="true" className="size-3" />
              deferred
            </span>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {currentLabels.map((label) => (
            <span
              key={label}
              className="label-chip inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs"
              style={labelChipStyle(label)}
            >
              {label}
              <button
                type="button"
                aria-label={`Remove label ${label}`}
                onClick={() => void removeLabel(label)}
                className="hover:opacity-70"
              >
                <X aria-hidden="true" className="size-2.5" />
              </button>
            </span>
          ))}
          <LabelAdder options={labelOptions} onAdd={(label) => void addLabel(label)} />
        </div>

        {/* People and effort: the fields a planner reads first. */}
        <dl className="border-border mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md border p-2 text-xs">
          <Field icon={<User className="size-3" />} label="Assignee">
            {bead.assignee || <span className="text-fg-muted">unassigned</span>}
          </Field>
          {bead.owner ? (
            <Field icon={<User className="size-3" />} label="Owner">
              {bead.owner}
            </Field>
          ) : null}
          {bead.estimated_minutes ? (
            <Field icon={<Timer className="size-3" />} label="Estimate">
              {formatDuration(bead.estimated_minutes)}
            </Field>
          ) : null}
          {bead.due_at ? (
            <Field icon={<CalendarClock className="size-3" />} label="Due">
              <span className={span.overdue ? 'text-danger' : undefined}>
                {absoluteTime(bead.due_at)} · {relativeTime(bead.due_at)}
              </span>
            </Field>
          ) : null}
          {bead.defer_until ? (
            <Field icon={<Hourglass className="size-3" />} label="Deferred until">
              {absoluteTime(bead.defer_until)}
            </Field>
          ) : null}
          {bead.external_ref ? (
            <Field icon={<Link2 className="size-3" />} label="External">
              {bead.external_ref}
            </Field>
          ) : null}
          {bead.spec_id ? (
            <Field icon={<Link2 className="size-3" />} label="Spec">
              {bead.spec_id}
            </Field>
          ) : null}
        </dl>

        <section className="mt-3 grid gap-2" aria-label="Quick actions">
          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Status</span>
            <select
              disabled={busy}
              value={bead.status}
              onChange={(event) =>
                void mutate(
                  () => call('setStatus', { id: bead.id, status: event.target.value }),
                  `${bead.id} → ${event.target.value}`,
                )
              }
              className="bg-input-bg border-input-border text-fg rounded-md border px-2 py-1 text-sm"
            >
              {index.statuses.map((status) => (
                <option key={status.name} value={status.name}>
                  {status.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Priority</span>
            <select
              disabled={busy}
              value={bead.priority}
              onChange={(event) =>
                void mutate(
                  () =>
                    call('setPriority', {
                      id: bead.id,
                      priority: Number(event.target.value) as Priority,
                    }),
                  `${bead.id} → P${event.target.value}`,
                )
              }
              className="bg-input-bg border-input-border text-fg rounded-md border px-2 py-1 text-sm"
            >
              {[0, 1, 2, 3, 4].map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </label>

          {/* Status and Priority apply the moment you pick one; a Save button
              here would make the same pane behave two different ways. A text
              field's equivalent of "on change" is on commit — Enter or leaving
              the field — so that is what it does. */}
          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Assignee (PIC)</span>
            <input
              disabled={busy}
              value={assignee}
              placeholder="unassigned"
              onChange={(event) => setAssignee(event.target.value)}
              onBlur={() => void commitAssignee()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                  return;
                }
                if (event.key !== 'Escape') return;
                // Abandon the edit without also closing the pane, which is what
                // the window-level Escape handler would otherwise do.
                event.stopPropagation();
                setAssignee(bead.assignee ?? '');
                event.currentTarget.blur();
              }}
              className="bg-input-bg border-input-border text-fg min-w-0 rounded-md border px-2 py-1 text-sm"
            />
            <span className="text-fg-muted text-xs opacity-70">
              Applies on Enter, or when you leave the field. Escape cancels.
            </span>
          </label>

          {!done ? (
            <Button
              variant="primary"
              disabled={busy}
              className="mt-1 justify-center"
              onClick={() =>
                void mutate(() => call('closeBead', { id: bead.id }), `${bead.id} closed`)
              }
            >
              Close issue
            </Button>
          ) : null}

          {/*
            Reopen is toggled on `index.isDone(bead.status)` — the runtime
            vocabulary check — never on a hardcoded status string, per
            CLAUDE.md's rule against hardcoding beads vocabulary.
          */}
          {done ? (
            <Button
              variant="ghost"
              disabled={busy}
              className="mt-1 justify-center"
              onClick={() => void reopenBead()}
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Reopen
            </Button>
          ) : null}

          {/*
            Defer/Undefer toggle on `bead.defer_until` (whether the issue is
            currently deferred), independent of `done` — an issue can be
            deferred and later closed or reopened without ever being undeferred.
          */}
          <div className="@container">
            {bead.defer_until ? (
              <Button variant="ghost" disabled={busy} onClick={() => void undeferBead()}>
                <Snowflake aria-hidden="true" className="size-3.5" />
                Undefer
              </Button>
            ) : deferOpen ? (
              <div
                className="border-border grid gap-1.5 rounded-md border p-2"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  // Abandon the composer without also closing the pane, which
                  // is what the window-level Escape handler would otherwise
                  // do. No explicit `.blur()` here — the same reasoning as the
                  // title/note composers: this closure's `deferUntilDraft` /
                  // `deferReasonDraft` are already the values being reverted,
                  // so there is no stale-closure risk to guard against, and an
                  // explicit blur would only re-fire this same handler.
                  event.stopPropagation();
                  setDeferUntilDraft('');
                  setDeferReasonDraft('');
                  setDeferOpen(false);
                }}
              >
                <label htmlFor="defer-until" className="text-fg-muted text-xs">
                  Defer until
                </label>
                <input
                  id="defer-until"
                  autoFocus
                  disabled={busy}
                  value={deferUntilDraft}
                  placeholder="tomorrow, +1h, next monday…"
                  onChange={(event) => setDeferUntilDraft(event.target.value)}
                  className="bg-input-bg border-input-border text-fg min-w-0 rounded-md border px-2 py-1 text-sm"
                />
                <label htmlFor="defer-reason" className="text-fg-muted text-xs">
                  Reason (optional)
                </label>
                <input
                  id="defer-reason"
                  disabled={busy}
                  value={deferReasonDraft}
                  placeholder="e.g. waiting on API access"
                  onChange={(event) => setDeferReasonDraft(event.target.value)}
                  className="bg-input-bg border-input-border text-fg min-w-0 rounded-md border px-2 py-1 text-sm"
                />
                <div className="flex flex-col gap-1.5 @xs:flex-row @xs:items-center @xs:justify-end">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setDeferUntilDraft('');
                      setDeferReasonDraft('');
                      setDeferOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" disabled={busy} onClick={() => void submitDefer()}>
                    Defer
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" disabled={busy} onClick={() => setDeferOpen(true)}>
                <Snowflake aria-hidden="true" className="size-3.5" />
                Defer…
              </Button>
            )}
          </div>
        </section>

        <EditableText
          key={`description-${bead.id}`}
          title="Description"
          text={bead.description}
          field="description"
          id={bead.id}
          busy={busy}
          mutate={mutate}
          placeholder="Add description…"
        />
        <EditableText
          key={`design-${bead.id}`}
          title="Design"
          text={bead.design}
          field="design"
          id={bead.id}
          busy={busy}
          mutate={mutate}
          placeholder="Add design…"
        />
        <EditableText
          key={`acceptance-${bead.id}`}
          title="Acceptance criteria"
          text={bead.acceptance_criteria}
          field="acceptance"
          id={bead.id}
          busy={busy}
          mutate={mutate}
          placeholder="Add acceptance criteria…"
        />
        <LongText title="Notes" text={bead.notes} />

        {/*
          Deliberately outside `LongText`: that component returns null for
          empty notes, so an "Append note" affordance living inside it would
          vanish exactly when an issue has no notes yet to append to.
        */}
        <div className="@container mt-1">
          {noteOpen ? (
            <div className="border-border grid gap-1.5 rounded-md border p-2">
              <label htmlFor="note-draft" className="text-fg-muted text-xs">
                Append to notes
              </label>
              <textarea
                id="note-draft"
                rows={2}
                autoFocus
                disabled={busy}
                value={noteDraft}
                placeholder="New note text…"
                onChange={(event) => setNoteDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    // Fold the composer back up without also closing the pane.
                    event.stopPropagation();
                    setNoteDraft('');
                    setNoteOpen(false);
                    return;
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submitNote();
                  }
                }}
                className="bg-input-bg border-input-border text-fg min-w-0 resize-y rounded-md border px-2 py-1 text-sm"
              />
              <div className="flex flex-col gap-1.5 @xs:flex-row @xs:items-center @xs:justify-end">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setNoteDraft('');
                    setNoteOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={busy || noteDraft.trim() === ''}
                  onClick={() => void submitNote()}
                >
                  Save note
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setNoteOpen(true)}>
              <StickyNote aria-hidden="true" className="size-3.5" />
              Append note
            </Button>
          )}
        </div>

        {parent ? (
          <Section title="Parent">
            <LinkRow id={parent.id} beads={beads} onSelect={onSelect} index={index} />
          </Section>
        ) : null}

        {children.length > 0 ? (
          <Section
            title={`Children (${children.filter((child) => index.isDone(child.status)).length}/${children.length} done)`}
          >
            <ul className="grid gap-1">
              {children.map((child) => (
                <li key={child.id}>
                  <LinkRow id={child.id} beads={beads} onSelect={onSelect} index={index} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {blockedByNodes.length > 0 ? (
          <Section title="Blocked by" icon={<Lock aria-hidden="true" className="size-3" />}>
            <ul className="grid gap-1">
              {blockedByNodes.map((node, position) => (
                <BlockerRow
                  // The same blocker can legitimately appear on several paths
                  // (a diamond), so the id alone is not a stable key.
                  key={`${position}-${node.id}`}
                  node={node}
                  beads={beads}
                  onSelect={onSelect}
                  index={index}
                  // Only a depth-1 (direct) blocker is on this bead's own
                  // dependency list — a transitive one belongs to some other
                  // bead's list, so it cannot be removed from here.
                  onRemove={(id) => void removeDependencyEdge(id)}
                />
              ))}
            </ul>
            {blockerChain?.hasCycle ? (
              <p className="text-warning mt-1 flex items-center gap-1 text-xs">
                <AlertTriangle aria-hidden="true" className="size-3" />
                Dependency cycle detected — these issues block each other.
              </p>
            ) : null}
          </Section>
        ) : null}

        <EdgeList
          title="Blocks"
          edges={blocks}
          beads={beads}
          onSelect={onSelect}
          index={index}
          onRemove={(id) => void removeDependencyEdge(id)}
        />
        <EdgeList
          title="Related"
          edges={related}
          beads={beads}
          onSelect={onSelect}
          index={index}
          onRemove={(id) => void removeDependencyEdge(id)}
        />
        <EdgeList
          title="Discovered from"
          edges={discovered}
          beads={beads}
          onSelect={onSelect}
          index={index}
          onRemove={(id) => void removeDependencyEdge(id)}
        />

        <div className="mt-2">
          <Popover
            triggerLabel="Add link"
            label="Add link"
            className="w-72"
            triggerClassName="surface-interactive text-fg-muted hover:text-fg inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"
            triggerContent={
              <>
                <Plus aria-hidden="true" className="size-3.5" />
                Add link
              </>
            }
            open={linkOpen}
            onOpenChange={setLinkOpen}
          >
            <div className="grid gap-2">
              <DepKindSelect value={linkKind} onChange={setLinkKind} />
              <IssuePicker
                beads={beads}
                excludeIds={[bead.id, ...linkedIds]}
                onPick={(picked) => void addDependencyEdge(picked.id, linkKind)}
                autoFocus
              />
            </div>
          </Popover>
        </div>

        {/*
          Always rendered — including at zero comments — so the composer is
          reachable without waiting for a first comment to exist.
        */}
        <Section
          title={`Comments (${comments.length})`}
          icon={<MessageSquare aria-hidden="true" className="size-3" />}
        >
          {comments.length > 0 ? (
            <ul className="grid gap-2">
              {comments.map((comment, position) => (
                <CommentRow key={comment.id ?? position} comment={comment} />
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted text-xs">No comments yet.</p>
          )}

          <div className="@container mt-2 grid gap-1.5">
            <label htmlFor="comment-draft" className="text-fg-muted text-xs">
              Add a comment
            </label>
            <textarea
              id="comment-draft"
              rows={2}
              disabled={busy}
              value={commentDraft}
              placeholder="Write a comment…"
              onChange={(event) => setCommentDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  // Abandon the draft without also closing the pane, which is
                  // what the window-level Escape handler would otherwise do.
                  event.stopPropagation();
                  setCommentDraft('');
                  event.currentTarget.blur();
                  return;
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void submitComment();
                }
              }}
              className="bg-input-bg border-input-border text-fg min-w-0 resize-y rounded-md border px-2 py-1 text-sm"
            />
            <div className="flex flex-col gap-1.5 @xs:flex-row @xs:items-center @xs:justify-between">
              <span className="text-fg-muted text-xs opacity-70">
                Ctrl/Cmd+Enter to submit. Escape clears.
              </span>
              <Button
                variant="primary"
                disabled={busy || commentDraft.trim() === ''}
                className="justify-center @xs:self-end"
                onClick={() => void submitComment()}
              >
                Comment
              </Button>
            </div>
          </div>
        </Section>

        <section className="mt-4">
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
            className="text-fg-muted hover:text-fg flex w-full items-center gap-1 text-xs tracking-wide uppercase"
          >
            {historyOpen ? (
              <ChevronDown aria-hidden="true" className="size-3" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-3" />
            )}
            <HistoryIcon aria-hidden="true" className="size-3" />
            Change history
          </button>
          {historyOpen ? (
            <div className="mt-1.5">
              {historyLoading ? <Skeleton className="h-4 w-32" /> : null}
              {historyError ? (
                <p className="text-danger text-xs">{historyError.message}</p>
              ) : null}
              {!historyLoading && !historyError && historyEvents.length === 0 ? (
                <p className="text-fg-muted text-xs">No changes recorded.</p>
              ) : null}
              {historyEvents.length > 0 ? (
                <ul className="grid gap-1.5">
                  {historyEvents.map((event, position) => (
                    <HistoryRow key={`${event.at}-${position}`} event={event} index={index} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        {bead.metadata !== undefined && bead.metadata !== null ? (
          <Section title="Metadata">
            <pre className="bg-input-bg text-fg-muted overflow-x-auto rounded-md p-2 text-xs">
              {typeof bead.metadata === 'string'
                ? bead.metadata
                : JSON.stringify(bead.metadata, null, 2)}
            </pre>
          </Section>
        ) : null}

        <Section title="History">
          <dl className="text-fg-muted grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Meta label="Created" value={bead.created_at} extra={bead.created_by} />
            <Meta label="Updated" value={bead.updated_at} />
            <Meta label="Started" value={bead.started_at} />
            <Meta label="Closed" value={bead.closed_at} />
          </dl>
          {bead.close_reason ? (
            <p className="text-fg-muted mt-1 text-xs">
              <span className="text-fg">Close reason:</span> {bead.close_reason}
            </p>
          ) : null}
        </Section>
      </div>

      <footer className="border-border border-t px-3 py-2">
        <Button variant="ghost" onClick={() => void call('revealBead', { id: bead.id })}>
          <ExternalLink aria-hidden="true" className="size-3.5" />
          Reveal in sidebar
        </Button>
      </footer>
    </aside>
  );
}

/**
 * Unordered comparison — bd's own label/id order need not match the
 * optimistic array's. Shared by the label-override and blocked-by-override
 * retirement effects; despite the name this is generic over any string set.
 */
function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((value) => setB.has(value));
}

/**
 * Same unordered comparison as {@link sameStringSet}, but for dependency
 * edges: two edge arrays are equal when they carry the same
 * (target id, kind) pairs, regardless of order or which of bd's two edge
 * shapes (`edgeTargetId`/`edgeKind` normalise that).
 */
function sameEdgeSet(a: BeadDependency[], b: BeadDependency[]): boolean {
  const keyOf = (edge: BeadDependency): string => `${edgeTargetId(edge) ?? ''}:${edgeKind(edge) ?? ''}`;
  return sameStringSet(a.map(keyOf), b.map(keyOf));
}

/**
 * The chip row's add affordance: a small text input with a `<datalist>` of
 * labels already seen across every loaded bead (there is no dedicated `bd`
 * command to list every label that exists project-wide, so this is derived
 * rather than hardcoded — same derivation `BeadCreate`'s label datalist
 * uses). Enter adds the trimmed value and clears the draft; the caller
 * (`addLabel` in `BeadDetail`) owns the optimistic apply and rollback.
 */
function LabelAdder({
  options,
  onAdd,
}: {
  options: string[];
  onAdd: (label: string) => void;
}): ReactNode {
  const [draft, setDraft] = useState('');

  return (
    <>
      <input
        type="text"
        list="bead-detail-labels"
        value={draft}
        placeholder="Add label…"
        aria-label="Add label"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const trimmed = draft.trim();
          if (!trimmed) return;
          onAdd(trimmed);
          setDraft('');
        }}
        className="bg-input-bg border-input-border text-fg w-24 min-w-0 rounded-sm border px-1.5 py-0.5 text-xs"
      />
      <datalist id="bead-detail-labels">
        {options.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
    </>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <dt className="text-fg-muted flex items-center gap-1">
        {icon}
        {label}
      </dt>
      <dd className="text-fg truncate">{children}</dd>
    </>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="mt-4">
      <h3 className="text-fg-muted mb-1 flex items-center gap-1 text-xs tracking-wide uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function LongText({ title, text }: { title: string; text?: string }): ReactNode {
  if (!text?.trim()) return null;
  return (
    <Section title={title}>
      <p className="text-fg text-sm whitespace-pre-wrap">{text}</p>
    </Section>
  );
}

/**
 * The description/design/acceptance sections: a pencil swaps read-only text
 * for a textarea with a Write/Preview toggle (Preview renders through the
 * same `Markdown` component transcripts use), Ctrl/Cmd+Enter saves through
 * `updateText`, Escape cancels without also closing the pane. Unlike
 * `LongText`, an empty field still renders — a ghost "Add …" button — so
 * there is always a way to give a field its first value, not only to edit
 * one that already has text.
 *
 * Keyed by `${field}-${bead.id}` at the call site so switching issues
 * remounts fresh, discarding any in-progress edit — the same rule the
 * comment and note drafts already follow.
 */
function EditableText({
  title,
  text,
  field,
  id,
  busy,
  mutate,
  placeholder,
}: {
  title: string;
  text?: string;
  field: Extract<TextField, 'description' | 'design' | 'acceptance'>;
  id: string;
  busy: boolean;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<boolean>;
  placeholder: string;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [draft, setDraft] = useState(text ?? '');

  function startEdit(): void {
    setDraft(text ?? '');
    setMode('write');
    setEditing(true);
  }

  function cancel(): void {
    setDraft(text ?? '');
    setMode('write');
    setEditing(false);
  }

  async function save(): Promise<void> {
    const next = draft;
    if (next === (text ?? '')) {
      setEditing(false);
      return;
    }
    const ok = await mutate(
      () => call('updateText', { id, field, text: next }),
      `${id} ${title.toLowerCase()} updated`,
    );
    if (ok) setEditing(false);
  }

  if (!editing) {
    const hasText = !!text?.trim();
    return (
      <section className="mt-4">
        <h3 className="text-fg-muted mb-1 flex items-center justify-between gap-1 text-xs tracking-wide uppercase">
          {title}
          <button
            type="button"
            aria-label={`Edit ${title}`}
            disabled={busy}
            onClick={startEdit}
            className="text-fg-muted hover:text-fg normal-case"
          >
            <Pencil aria-hidden="true" className="size-3" />
          </button>
        </h3>
        {hasText ? (
          <p className="text-fg text-sm whitespace-pre-wrap">{text}</p>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={startEdit}>
            <Plus aria-hidden="true" className="size-3.5" />
            {placeholder}
          </Button>
        )}
      </section>
    );
  }

  return (
    <section
      className="@container mt-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // Abandon the edit without also closing the pane, which is what
          // the window-level Escape handler would otherwise do.
          event.stopPropagation();
          cancel();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          void save();
        }
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <h3 className="text-fg-muted text-xs tracking-wide uppercase">{title}</h3>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            aria-pressed={mode === 'write'}
            disabled={busy}
            onClick={() => setMode('write')}
            className={mode === 'write' ? 'text-fg font-medium' : 'text-fg-muted hover:text-fg'}
          >
            Write
          </button>
          <button
            type="button"
            aria-pressed={mode === 'preview'}
            disabled={busy}
            onClick={() => setMode('preview')}
            className={mode === 'preview' ? 'text-fg font-medium' : 'text-fg-muted hover:text-fg'}
          >
            Preview
          </button>
        </div>
      </div>

      {mode === 'write' ? (
        <textarea
          autoFocus
          rows={5}
          aria-label={`${title} draft`}
          disabled={busy}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="bg-input-bg border-input-border text-fg min-w-0 w-full resize-y rounded-md border px-2 py-1 text-sm"
        />
      ) : (
        <div className="border-border min-h-24 rounded-md border px-2 py-1.5">
          {draft.trim() ? (
            <Markdown source={draft} />
          ) : (
            <p className="text-fg-muted text-xs">Nothing to preview.</p>
          )}
        </div>
      )}

      <div className="mt-1.5 flex flex-col gap-1.5 @xs:flex-row @xs:items-center @xs:justify-between">
        <span className="text-fg-muted text-xs opacity-70">
          Ctrl/Cmd+Enter to save. Escape cancels.
        </span>
        <div className="flex gap-1.5 @xs:self-end">
          <Button variant="ghost" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}

function Meta({
  label,
  value,
  extra,
}: {
  label: string;
  value?: string;
  extra?: string;
}): ReactNode {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-fg text-right" title={absoluteTime(value)}>
        {relativeTime(value)}
        {extra ? <span className="text-fg-muted"> · {extra}</span> : null}
      </dd>
    </>
  );
}

function EdgeList({
  title,
  icon,
  edges,
  beads,
  onSelect,
  index,
  onRemove,
}: {
  title: string;
  icon?: ReactNode;
  edges: Array<{ id: string }>;
  beads: Bead[];
  onSelect: (id: string) => void;
  index: StatusIndex;
  /** When provided, each row gets an × button that calls this with the edge's id. */
  onRemove?: (id: string) => void;
}): ReactNode {
  if (edges.length === 0) return null;
  return (
    <Section title={title} icon={icon}>
      <ul className="grid gap-1">
        {edges.map((edge) => (
          <li key={edge.id} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <LinkRow id={edge.id} beads={beads} onSelect={onSelect} index={index} />
            </div>
            {onRemove ? (
              <button
                type="button"
                aria-label={`Remove link to ${edge.id}`}
                onClick={() => onRemove(edge.id)}
                className="text-fg-muted hover:text-danger shrink-0 p-0.5"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * The Add-link control's kind select: `blocks`/`related`/`discovered-from`
 * are the common case and always visible; the rest of {@link DEP_TYPES} sit
 * behind "More kinds…" so the select does not open to ten options nobody
 * usually needs. Reveals permanently for the session once toggled (there is
 * no reason to hide them again after the user asked to see them).
 */
function DepKindSelect({
  value,
  onChange,
}: {
  value: DepType;
  onChange: (next: DepType) => void;
}): ReactNode {
  const [showAll, setShowAll] = useState(false);
  const id = useId();
  // The current value always stays selectable, even if it is one of the
  // "more" kinds and showAll is still false (e.g. restored from a draft).
  const visibleOptions =
    showAll || !PROMINENT_DEP_TYPES.includes(value) ? DEP_TYPES : PROMINENT_DEP_TYPES;

  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-fg-muted text-xs">
        Kind
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as DepType)}
        className="bg-input-bg border-input-border text-fg rounded-md border px-2 py-1 text-sm"
      >
        {visibleOptions.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      {!showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-fg-muted hover:text-fg justify-self-start text-xs"
        >
          More kinds…
        </button>
      ) : null}
    </div>
  );
}

const HISTORY_FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  title: 'Title',
  labels: 'Labels',
  description: 'Description',
  design: 'Design',
  acceptance_criteria: 'Acceptance criteria',
};

function historyFieldLabel(field: string): string {
  return HISTORY_FIELD_LABELS[field] ?? field;
}

/** Priority is stored as a numeric string on the event; show its label when it parses. */
function historyPriorityLabel(value: string | undefined): string {
  if (value === undefined) return '—';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? PRIORITY_LABELS[parsed] ?? value : value;
}

function HistoryRow({ event, index }: { event: HistoryEvent; index: StatusIndex }): ReactNode {
  return (
    <li className="border-border rounded-md border px-2 py-1.5 text-xs">
      <div className="text-fg-muted flex items-baseline gap-2">
        <span className="text-fg">{event.actor || 'unknown'}</span>
        <span title={absoluteTime(event.at)}>{relativeTime(event.at)}</span>
      </div>
      <div className="text-fg mt-0.5 flex flex-wrap items-center gap-1">
        <HistoryChangeText event={event} index={index} />
      </div>
    </li>
  );
}

function HistoryChangeText({
  event,
  index,
}: {
  event: HistoryEvent;
  index: StatusIndex;
}): ReactNode {
  if (event.kind === 'text-changed') {
    return <>{historyFieldLabel(event.field)} changed</>;
  }

  if (event.kind === 'label-added') {
    return (
      <>
        <span>label added:</span>
        <span
          className="label-chip rounded-sm px-1.5 py-0.5"
          style={labelChipStyle(event.to ?? '')}
        >
          {event.to}
        </span>
      </>
    );
  }

  if (event.kind === 'label-removed') {
    return (
      <>
        <span>label removed:</span>
        <span
          className="label-chip rounded-sm px-1.5 py-0.5 opacity-70 line-through"
          style={labelChipStyle(event.from ?? '')}
        >
          {event.from}
        </span>
      </>
    );
  }

  if (event.field === 'status') {
    return (
      <>
        <span>{historyFieldLabel(event.field)}:</span>
        {event.from ? (
          <StatusPill
            status={event.from}
            category={index.category(event.from)}
            icon={index.def(event.from)?.icon}
          />
        ) : (
          <span className="text-fg-muted">—</span>
        )}
        <ArrowRight aria-hidden="true" className="size-3" />
        {event.to ? (
          <StatusPill
            status={event.to}
            category={index.category(event.to)}
            icon={index.def(event.to)?.icon}
          />
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </>
    );
  }

  if (event.field === 'priority') {
    return (
      <>
        <span>{historyFieldLabel(event.field)}:</span>
        <span>{historyPriorityLabel(event.from)}</span>
        <ArrowRight aria-hidden="true" className="size-3" />
        <span>{historyPriorityLabel(event.to)}</span>
      </>
    );
  }

  return (
    <>
      <span>{historyFieldLabel(event.field)}:</span>
      <span className="truncate">{event.from ?? '—'}</span>
      <ArrowRight aria-hidden="true" className="size-3" />
      <span className="truncate">{event.to ?? '—'}</span>
    </>
  );
}

function CommentRow({ comment }: { comment: BeadComment }): ReactNode {
  return (
    <li className="border-border rounded-md border px-2 py-1.5">
      <div className="text-fg-muted flex items-baseline gap-2 text-xs">
        <span className="text-fg">{comment.author || 'unknown'}</span>
        <span title={absoluteTime(comment.created_at)}>{relativeTime(comment.created_at)}</span>
      </div>
      <p className="text-fg mt-0.5 text-sm whitespace-pre-wrap">{comment.text}</p>
    </li>
  );
}

/**
 * One row of the "Blocked by" chain: an ordinary link row, indented by how
 * far the blocker sits from the inspected bead, with a chip when the edge
 * closes a cycle and an ellipsis when the walk was depth-capped there.
 *
 * The × removal button only ever renders for a depth-1 (direct) row: a
 * deeper blocker is on some other bead's dependency list, not this one's, so
 * there is nothing here to remove it from.
 */
function BlockerRow({
  node,
  beads,
  onSelect,
  index,
  onRemove,
}: {
  node: BlockerNode;
  beads: Bead[];
  onSelect: (id: string) => void;
  index: StatusIndex;
  /** Called with the blocker's id when its × is clicked; ignored below depth 1. */
  onRemove?: (id: string) => void;
}): ReactNode {
  return (
    <li
      className="flex items-center gap-1.5"
      style={{ paddingLeft: `${(node.depth - 1) * 0.75}rem` }}
    >
      <div className="min-w-0 flex-1">
        <LinkRow id={node.id} beads={beads} onSelect={onSelect} index={index} />
      </div>
      {node.cycle ? (
        <span
          title="This edge closes a dependency cycle"
          className="text-warning shrink-0 rounded-sm border border-current px-1 text-xs"
        >
          cycle
        </span>
      ) : null}
      {node.truncated ? (
        <span title="Chain continues; too deep to show" className="text-fg-muted shrink-0 text-xs">
          …
        </span>
      ) : null}
      {node.depth === 1 && onRemove ? (
        <button
          type="button"
          aria-label={`Remove link to ${node.id}`}
          onClick={() => onRemove(node.id)}
          className="text-fg-muted hover:text-danger shrink-0 p-0.5"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </li>
  );
}

function LinkRow({
  id,
  beads,
  onSelect,
  index,
}: {
  id: string;
  beads: Bead[];
  onSelect: (id: string) => void;
  index: StatusIndex;
}): ReactNode {
  const target = beads.find((bead) => bead.id === id);
  const strike = target ? index.isDone(target.status) : false;

  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className="surface-interactive hover:bg-surface-hover flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-sm"
    >
      {target ? (
        <TypeIcon type={target.issue_type} className={typeStyle(target.issue_type).className} />
      ) : null}
      <span className="text-fg-muted shrink-0 font-mono text-xs">{id}</span>
      <span className={cn('truncate', strike && 'text-fg-muted line-through')}>
        {target?.title ?? '(not loaded)'}
      </span>
    </button>
  );
}

export { PARENT_CHILD };
