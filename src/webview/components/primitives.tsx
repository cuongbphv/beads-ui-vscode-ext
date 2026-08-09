/**
 * The small shared vocabulary: type icon, priority dot, status pill, progress
 * bar, skeletons, empty state.
 *
 * Card content budget from the design system: id, truncated title, type icon,
 * priority dot. Anything richer belongs in the detail pane, not on a card.
 */
import {
  Beaker,
  Book,
  Bug,
  CircleDashed,
  Flag,
  Lightbulb,
  Milestone,
  Scale,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { PRIORITY_LABELS, type StatusCategory } from '../../shared/types';
import { cn, percent } from '../lib/utils';

const TYPE_ICONS: Record<string, LucideIcon> = {
  epic: Milestone,
  milestone: Flag,
  bug: Bug,
  feature: Lightbulb,
  chore: Wrench,
  decision: Scale,
  spike: Beaker,
  story: Book,
};

export function TypeIcon({ type, className }: { type: string; className?: string }): ReactNode {
  const Icon = TYPE_ICONS[type] ?? CircleDashed;
  // The label is what a screen reader announces; the glyph is decoration.
  return (
    <span title={type} className={cn('inline-flex shrink-0', className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{type}</span>
    </span>
  );
}

const PRIORITY_CLASS = ['bg-p0', 'bg-p1', 'bg-p2', 'bg-p3', 'bg-p4'];

/** Colour plus a text label — never colour alone. */
export function PriorityDot({ priority }: { priority: number }): ReactNode {
  const label = PRIORITY_LABELS[priority] ?? `P${priority}`;
  return (
    <span className="inline-flex items-center gap-1 shrink-0" title={label}>
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', PRIORITY_CLASS[priority] ?? 'bg-p4')}
      />
      <span className="text-fg-muted text-xs tabular-nums">P{priority}</span>
    </span>
  );
}

const CATEGORY_CLASS: Record<StatusCategory, string> = {
  active: 'text-p2',
  wip: 'text-warning',
  done: 'text-success',
  frozen: 'text-fg-muted',
  unspecified: 'text-fg-muted',
};

export function StatusPill({
  status,
  category,
  icon,
}: {
  status: string;
  category: StatusCategory;
  icon?: string;
}): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-xs',
        CATEGORY_CLASS[category],
      )}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {status}
    </span>
  );
}

export function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: string;
}): ReactNode {
  const value = percent(done, total);
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `${done} of ${total} done`}
      className="h-1 w-full overflow-hidden rounded-full bg-surface-hover"
    >
      <div
        className="h-full rounded-full bg-success transition-[width] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }): ReactNode {
  return <div aria-hidden="true" className={cn('skeleton', className)} />;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-fg-muted opacity-60">{icon}</div>
      <p className="text-fg-strong text-lg font-medium">{title}</p>
      {hint ? <p className="text-fg-muted max-w-md text-sm">{hint}</p> : null}
      {action}
    </div>
  );
}

/**
 * A compact picker for a band, where there is no room for a visible label.
 *
 * Only for choices whose *current value* names the field — `By date`, `Weeks`.
 * A filter select reading `bug` says nothing about which field it narrows, so
 * those live in the filter popover with a real `<label>` instead.
 */
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}): ReactNode {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="bg-input-bg border-input-border text-fg max-w-40 rounded-md border px-1.5 py-1 text-sm"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  title,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  title?: string;
  disabled?: boolean;
  className?: string;
}): ReactNode {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'surface-interactive inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-button-bg text-button-fg hover:opacity-90',
        variant === 'secondary' &&
          'bg-button-secondary-bg text-fg hover:bg-surface-hover border border-border',
        variant === 'ghost' && 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}
