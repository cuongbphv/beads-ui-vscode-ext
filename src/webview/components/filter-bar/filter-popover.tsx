/**
 * The four pickers, behind one button.
 *
 * They used to sit in the band, where an unset picker cost exactly as much
 * width as a set one and read the same at a glance. Folded away, the band is
 * quiet until something is actually filtered — and what *is* filtered is
 * reported by the chip row, not by hunting through five controls.
 */
import { SlidersHorizontal } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { assigneesOf, typesOf, type BeadQuery } from '../../../shared/model';
import type { Bead } from '../../../shared/types';
import { activeFilterCount, clearAllFilters } from '../../lib/filter-chips';
import { cn } from '../../lib/utils';
import { Button } from '../primitives';
import { Popover } from '../popover';

const PRIORITY_OPTIONS = [
  { value: '', label: 'Any priority' },
  { value: '0', label: 'P0 only' },
  { value: '1', label: 'P0–P1' },
  { value: '2', label: 'P0–P2' },
];

export function FilterPopover({
  beads,
  epics,
  query,
  onChange,
}: {
  beads: Bead[];
  epics: Bead[];
  query: BeadQuery;
  onChange: (next: BeadQuery) => void;
}): ReactNode {
  const set = (patch: Partial<BeadQuery>): void => onChange({ ...query, ...patch });
  const count = activeFilterCount(query, epics);
  const closedId = useId();

  return (
    <Popover
      // The count is in the name, not only in the badge: a screen reader user
      // gets the same "something is filtered" signal a sighted one does.
      triggerLabel={count > 0 ? `Filters, ${count} active` : 'Filters'}
      label="Filters"
      className="w-64"
      triggerClassName={cn(
        'surface-interactive inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm',
        count > 0
          ? 'border-border-strong text-fg-strong'
          : 'border-border text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
      triggerContent={
        <>
          <SlidersHorizontal aria-hidden="true" className="size-3.5" />
          Filters
          {/* A digit, not a coloured dot — the state is never carried by
              colour alone. */}
          {count > 0 ? (
            <span className="bg-badge-bg text-badge-fg rounded-full px-1.5 text-xs tabular-nums">
              {count}
            </span>
          ) : null}
        </>
      }
    >
      <div className="grid gap-1.5">
        <LabelledSelect
          label="Epic"
          value={query.epicId ?? ''}
          onChange={(value) => set({ epicId: value || undefined })}
          options={[
            { value: '', label: 'All epics' },
            ...epics.map((epic) => ({ value: epic.id, label: epic.title })),
          ]}
        />

        {/* Types and assignees come from the snapshot: beads lets users define
            their own, so a hardcoded list would filter to nothing. */}
        <LabelledSelect
          label="Type"
          value={query.types?.[0] ?? ''}
          onChange={(value) => set({ types: value ? [value] : undefined })}
          options={[
            { value: '', label: 'All types' },
            ...typesOf(beads).map((type) => ({ value: type, label: type })),
          ]}
        />

        <LabelledSelect
          label="Assignee"
          value={query.assignees?.[0] ?? ''}
          onChange={(value) => set({ assignees: value ? [value] : undefined })}
          options={[
            { value: '', label: 'Anyone' },
            ...assigneesOf(beads).map((name) => ({ value: name, label: name })),
          ]}
        />

        <LabelledSelect
          label="Priority"
          value={query.priorityMax === undefined ? '' : String(query.priorityMax)}
          onChange={(value) => set({ priorityMax: value === '' ? undefined : Number(value) })}
          options={PRIORITY_OPTIONS}
        />

        <div className="border-border mt-1 flex items-center gap-2 border-t pt-2">
          <input
            id={closedId}
            type="checkbox"
            checked={query.includeClosed ?? false}
            onChange={(event) => set({ includeClosed: event.target.checked })}
          />
          <label htmlFor={closedId} className="text-fg cursor-pointer text-sm">
            Include closed issues
          </label>
        </div>

        <Button
          variant="ghost"
          disabled={count === 0}
          onClick={() => onChange(clearAllFilters(query))}
          className="justify-center"
        >
          Reset filters
        </Button>
      </div>
    </Popover>
  );
}

/**
 * A picker with a label you can see.
 *
 * The band's controls carried an `aria-label` and nothing visible, which reads
 * as four unlabelled boxes to everyone not using a screen reader. Stacked in a
 * panel there is room to simply say what each one is.
 */
function LabelledSelect({
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
  const id = useId();

  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
      <label htmlFor={id} className="text-fg-muted text-xs">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-input-bg border-input-border text-fg min-w-0 rounded-md border px-1.5 py-1 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
