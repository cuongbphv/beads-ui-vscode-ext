/**
 * One row of filters shared by Roadmap and Board.
 *
 * Filtering is client-side: the snapshot is already in memory, and re-querying
 * bd per keystroke would spawn a process per keystroke.
 */
import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { BeadQuery } from '../../shared/model';
import type { Bead } from '../../shared/types';
import { assigneesOf, typesOf } from '../../shared/model';
import { cn } from '../lib/utils';

export function QuickFilterBar({
  beads,
  epics,
  query,
  onChange,
  className,
}: {
  beads: Bead[];
  epics: Bead[];
  query: BeadQuery;
  onChange: (next: BeadQuery) => void;
  className?: string;
}): ReactNode {
  const set = (patch: Partial<BeadQuery>): void => onChange({ ...query, ...patch });
  const active =
    Boolean(query.text) ||
    Boolean(query.types?.length) ||
    Boolean(query.assignees?.length) ||
    Boolean(query.epicId) ||
    typeof query.priorityMax === 'number';

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <div className="relative min-w-40 flex-1">
        <Search
          aria-hidden="true"
          className="text-fg-muted pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
        />
        <input
          type="search"
          value={query.text ?? ''}
          placeholder="Filter by id, title or label…"
          aria-label="Filter issues"
          onChange={(event) => set({ text: event.target.value })}
          className="bg-input-bg border-input-border text-fg w-full rounded-md border py-1 pr-2 pl-7 text-sm"
        />
      </div>

      <Select
        label="Epic"
        value={query.epicId ?? ''}
        onChange={(value) => set({ epicId: value || undefined })}
        options={[
          { value: '', label: 'All epics' },
          ...epics.map((epic) => ({ value: epic.id, label: epic.title })),
        ]}
      />

      <Select
        label="Type"
        value={query.types?.[0] ?? ''}
        onChange={(value) => set({ types: value ? [value] : undefined })}
        options={[
          { value: '', label: 'All types' },
          ...typesOf(beads).map((type) => ({ value: type, label: type })),
        ]}
      />

      <Select
        label="Assignee"
        value={query.assignees?.[0] ?? ''}
        onChange={(value) => set({ assignees: value ? [value] : undefined })}
        options={[
          { value: '', label: 'Anyone' },
          ...assigneesOf(beads).map((name) => ({ value: name, label: name })),
        ]}
      />

      <Select
        label="Priority"
        value={query.priorityMax === undefined ? '' : String(query.priorityMax)}
        onChange={(value) => set({ priorityMax: value === '' ? undefined : Number(value) })}
        options={[
          { value: '', label: 'Any priority' },
          { value: '0', label: 'P0 only' },
          { value: '1', label: 'P0–P1' },
          { value: '2', label: 'P0–P2' },
        ]}
      />

      <label className="text-fg-muted flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={query.includeClosed ?? false}
          onChange={(event) => set({ includeClosed: event.target.checked })}
        />
        Closed
      </label>

      {active ? (
        <button
          type="button"
          onClick={() => onChange({ includeClosed: query.includeClosed })}
          className="text-fg-muted hover:text-fg surface-interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm"
        >
          <X aria-hidden="true" className="size-3.5" />
          Clear
        </button>
      ) : null}
    </div>
  );
}

function Select({
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
