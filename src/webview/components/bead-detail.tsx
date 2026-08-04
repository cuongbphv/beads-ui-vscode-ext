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
  CalendarClock,
  Copy,
  ExternalLink,
  Hourglass,
  Link2,
  Lock,
  MessageSquare,
  Pin,
  Snowflake,
  Timer,
  User,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { StatusIndex, edgesOfKind, parentIdOf } from '../../shared/model';
import { formatDuration, spanOf } from '../../shared/schedule';
import {
  PARENT_CHILD,
  PRIORITY_LABELS,
  typeStyle,
  type Bead,
  type BeadComment,
  type Priority,
} from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';
import { useBeadDetail } from '../hooks/use-bead-detail';
import { labelChipStyle } from '../lib/label-color';
import { absoluteTime, cn, relativeTime } from '../lib/utils';
import { Button, PriorityDot, Skeleton, StatusPill, TypeIcon } from './primitives';
import { useToast } from './toast';

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

  useEffect(() => setAssignee(bead.assignee ?? ''), [bead.id, bead.assignee]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function mutate(action: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      notify(success);
    } catch (error) {
      notify(asRpcError(error).message, 'error');
    } finally {
      setBusy(false);
    }
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

  const done = index.isDone(bead.status);
  const span = spanOf(bead, done, Date.now());
  const parentId = parentIdOf(bead);
  const parent = parentId ? beads.find((candidate) => candidate.id === parentId) : undefined;
  const children = beads.filter((candidate) => parentIdOf(candidate) === bead.id);
  const blocks = edgesOfKind(bead, 'blocks');
  const related = edgesOfKind(bead, 'related');
  const discovered = edgesOfKind(bead, 'discovered-from');
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
          <h2 className="text-fg-strong text-lg leading-snug font-medium">{bead.title}</h2>
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

        {bead.labels?.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {bead.labels.map((label) => (
              <span
                key={label}
                className="label-chip rounded-sm px-1.5 py-0.5 text-xs"
                style={labelChipStyle(label)}
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}

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
        </section>

        <LongText title="Description" text={bead.description} />
        <LongText title="Design" text={bead.design} />
        <LongText title="Acceptance criteria" text={bead.acceptance_criteria} />
        <LongText title="Notes" text={bead.notes} />

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

        {bead.blocked_by?.length ? (
          <Section title="Blocked by" icon={<Lock aria-hidden="true" className="size-3" />}>
            <ul className="grid gap-1">
              {bead.blocked_by.map((id) => (
                <li key={id}>
                  <LinkRow id={id} beads={beads} onSelect={onSelect} index={index} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <EdgeList
          title="Depends on"
          edges={blocks}
          beads={beads}
          onSelect={onSelect}
          index={index}
        />
        <EdgeList title="Related" edges={related} beads={beads} onSelect={onSelect} index={index} />
        <EdgeList
          title="Discovered from"
          edges={discovered}
          beads={beads}
          onSelect={onSelect}
          index={index}
        />

        {comments.length > 0 ? (
          <Section
            title={`Comments (${comments.length})`}
            icon={<MessageSquare aria-hidden="true" className="size-3" />}
          >
            <ul className="grid gap-2">
              {comments.map((comment, position) => (
                <CommentRow key={comment.id ?? position} comment={comment} />
              ))}
            </ul>
          </Section>
        ) : null}

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
  edges,
  beads,
  onSelect,
  index,
}: {
  title: string;
  edges: Array<{ id: string }>;
  beads: Bead[];
  onSelect: (id: string) => void;
  index: StatusIndex;
}): ReactNode {
  if (edges.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="grid gap-1">
        {edges.map((edge) => (
          <li key={edge.id}>
            <LinkRow id={edge.id} beads={beads} onSelect={onSelect} index={index} />
          </li>
        ))}
      </ul>
    </Section>
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
