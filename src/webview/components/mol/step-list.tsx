/**
 * One molecule's step list, inside the Molecules tab's detail view.
 *
 * Renders exactly the four states bd 1.2.2 has ever been observed to report
 * (`done`/`current`/`ready`/`pending` — see `shared/mol.ts`'s doc comment on
 * `MolStepStatus`; there is no fifth "blocked" state, because bd itself
 * never emits one). A step waiting on an open gate still reports one of
 * those four. The presentation overrides Ready with Waiting for gate so the
 * two signals cannot contradict each other; the bd status remains unchanged.
 *
 * Steps group into bordered clusters by `parallelGroup` when the parent
 * detail's `parallelAvailable` is true; otherwise (or for any ungrouped
 * step) they render as a flat list — the same graceful degradation
 * `toMolDetail` already applies to the data itself.
 */
import type { ReactNode } from 'react';

import { formatDurationMs } from '../../../shared/lease';
import type { MolStep, MolStepGate, MolStepStatus } from '../../../shared/mol';
import { cn } from '../../lib/utils';

const STATUS_LABEL: Record<MolStepStatus, string> = {
  done: 'Done',
  current: 'In progress',
  ready: 'Ready',
  pending: 'Pending',
};

const STATUS_CLASS: Record<MolStepStatus, string> = {
  done: 'text-success border-success/40',
  current: 'text-p2 border-p2/40',
  ready: 'text-fg border-border-strong',
  pending: 'text-fg-muted border-border',
};

/** Go nanoseconds (as `bd gate`/`bd show` emit `timeout`) to a short "Xh Ym" string. */
function formatTimeoutNs(ns: number): string {
  return formatDurationMs(ns / 1_000_000);
}

function gateBadgeDetail(gate: MolStepGate): string | undefined {
  if (gate.awaitType === 'gh:pr' && gate.awaitId) return `PR ${gate.awaitId}`;
  if (gate.awaitType === 'gh:run' && gate.awaitId) return `run ${gate.awaitId}`;
  if (gate.awaitType === 'bead' && gate.awaitId) return gate.awaitId;
  if (gate.awaitType === 'timer' && typeof gate.timeout === 'number') {
    return `${formatTimeoutNs(gate.timeout)} timeout`;
  }
  return undefined;
}

export function StepStatusBadge({ status, waitingForGate = false }: { status: MolStepStatus; waitingForGate?: boolean }): ReactNode {
  const waiting = status === 'ready' && waitingForGate;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium',
        waiting ? 'text-warning border-warning/40' : STATUS_CLASS[status],
      )}
    >
      {waiting ? 'Waiting for gate' : STATUS_LABEL[status]}
    </span>
  );
}

export function GateBadge({ gate }: { gate: MolStepGate }): ReactNode {
  const detail = gateBadgeDetail(gate);
  return (
    <span
      title={`Blocked by an open ${gate.awaitType} gate${gate.gateId ? ` (${gate.gateId})` : ''}`}
      className="border-warning text-warning inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium"
    >
      gate: {gate.awaitType}
      {detail ? ` · ${detail}` : ''}
    </span>
  );
}

function StepRow({
  step,
  onSelect,
  selected,
}: {
  step: MolStep;
  onSelect?: (id: string) => void;
  selected?: boolean;
}): ReactNode {
  return (
    <article
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`${step.issue.id}: ${step.issue.title}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect ? () => onSelect(step.issue.id) : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(step.issue.id);
              }
            }
          : undefined
      }
      className={cn(
        'surface-interactive flex items-center gap-2 rounded-md border p-2 text-sm',
        onSelect && 'cursor-pointer',
        'bg-surface hover:bg-surface-hover border-border hover:border-border-strong',
        selected && 'border-border-strong bg-surface-active',
      )}
    >
      <StepStatusBadge status={step.status} waitingForGate={Boolean(step.gate)} />
      <span className="text-fg-muted shrink-0 truncate font-mono text-xs opacity-70">{step.issue.id}</span>
      <span className="text-fg-strong min-w-0 flex-1 truncate">{step.issue.title}</span>
      {step.gate ? <GateBadge gate={step.gate} /> : null}
    </article>
  );
}

export function StepList({
  steps,
  parallelAvailable,
  onSelect,
  selectedId,
}: {
  steps: MolStep[];
  parallelAvailable: boolean;
  onSelect?: (id: string) => void;
  selectedId?: string;
}): ReactNode {
  if (steps.length === 0) {
    return <p className="text-fg-muted p-2 text-sm">No steps.</p>;
  }

  if (!parallelAvailable) {
    return (
      <ul className="grid gap-1.5" aria-label="Steps">
        {steps.map((step) => (
          <li key={step.issue.id}>
            <StepRow step={step} onSelect={onSelect} selected={step.issue.id === selectedId} />
          </li>
        ))}
      </ul>
    );
  }

  const groups = new Map<string, MolStep[]>();
  const ungrouped: MolStep[] = [];
  for (const step of steps) {
    if (!step.parallelGroup) {
      ungrouped.push(step);
      continue;
    }
    const members = groups.get(step.parallelGroup) ?? [];
    members.push(step);
    groups.set(step.parallelGroup, members);
  }

  return (
    <div className="grid gap-2" aria-label="Steps">
      {[...groups.entries()].map(([group, members]) => (
        <div key={group} className="border-border-strong rounded-md border border-dashed p-2">
          <p className="text-fg-muted mb-1.5 text-[11px] font-medium uppercase tracking-wide">{group} · parallel</p>
          <ul className="grid gap-1.5">
            {members.map((step) => (
              <li key={step.issue.id}>
                <StepRow step={step} onSelect={onSelect} selected={step.issue.id === selectedId} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {ungrouped.length > 0 ? (
        <ul className="grid gap-1.5">
          {ungrouped.map((step) => (
            <li key={step.issue.id}>
              <StepRow step={step} onSelect={onSelect} selected={step.issue.id === selectedId} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
