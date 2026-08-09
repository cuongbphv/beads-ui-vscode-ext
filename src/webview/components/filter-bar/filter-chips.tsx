/**
 * What the filter bar is currently hiding, and the one click that undoes it.
 *
 * The row exists only when something is applied, so the band stays a single
 * line in the common case. Everything in it is a control: a filter the user
 * cannot see is a filter they will blame on the data.
 */
import { CheckCircle2, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { BeadQuery } from '../../../shared/model';
import type { Bead } from '../../../shared/types';
import { activeFilters, clearAllFilters, clearFilter } from '../../lib/filter-chips';

export function FilterChipRow({
  query,
  epics,
  onChange,
  hiddenClosedCount = 0,
}: {
  query: BeadQuery;
  epics: Bead[];
  onChange: (next: BeadQuery) => void;
  hiddenClosedCount?: number;
}): ReactNode {
  const chips = activeFilters(query, epics);
  if (chips.length === 0 && hiddenClosedCount === 0) return null;

  return (
    <div
      role="group"
      aria-label="Active filters"
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-label={`Remove filter ${chip.label} ${chip.value}`}
          onClick={() => onChange(clearFilter(query, chip.key))}
          className="border-border bg-surface text-fg hover:bg-surface-hover surface-interactive inline-flex max-w-56 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
        >
          <span className="text-fg-muted shrink-0">{chip.label}</span>
          <span className="truncate">{chip.value}</span>
          <X aria-hidden="true" className="size-3 shrink-0" />
        </button>
      ))}

      {/* Never a silent filter: the count is on screen and is the control. */}
      {hiddenClosedCount > 0 ? (
        <button
          type="button"
          onClick={() => onChange({ ...query, includeClosed: true })}
          className="text-fg-muted hover:bg-surface-hover hover:text-fg border-border surface-interactive inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 text-xs"
        >
          <CheckCircle2 aria-hidden="true" className="size-3" />
          {hiddenClosedCount} closed hidden — show
        </button>
      ) : null}

      {chips.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange(clearAllFilters(query))}
          className="text-fg-muted hover:text-fg cursor-pointer px-1 text-xs underline underline-offset-2"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
