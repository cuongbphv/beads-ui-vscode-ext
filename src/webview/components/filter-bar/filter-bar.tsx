/**
 * One band of filters shared by Roadmap and Board.
 *
 * Two zones and two rows. Row one is the search box, the Filters button, and
 * whatever view controls the owning tab hands over — data on the left, the way
 * the data is drawn on the right. Row two only appears once something is
 * filtered, and every item in it removes itself.
 *
 * Filtering is client-side: the snapshot is already in memory, and re-querying
 * bd per keystroke would spawn a process per keystroke.
 */
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import type { BeadQuery } from '../../../shared/model';
import type { Bead } from '../../../shared/types';
import { cn } from '../../lib/utils';
import { FilterChipRow } from './filter-chips';
import { FilterPopover } from './filter-popover';

export function QuickFilterBar({
  beads,
  epics,
  query,
  onChange,
  className,
  hiddenClosedCount,
  trailing,
}: {
  beads: Bead[];
  epics: Bead[];
  query: BeadQuery;
  onChange: (next: BeadQuery) => void;
  className?: string;
  /**
   * Closed issues the current query is hiding. Rendered in the chip row as the
   * control that includes them. The Roadmap counts its own; the Board, where
   * done is a column rather than a filter, passes nothing.
   */
  hiddenClosedCount?: number;
  /**
   * View controls owned by the tab — sort, zoom, shape. They sit inside the
   * same flex row rather than beside it so they wrap with everything else;
   * pinned outside, they leave a hole in the first row as soon as the panel is
   * too narrow for one line.
   */
  trailing?: ReactNode;
}): ReactNode {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
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
            onChange={(event) => onChange({ ...query, text: event.target.value })}
            className="bg-input-bg border-input-border text-fg w-full rounded-md border py-1 pr-2 pl-7 text-sm"
          />
        </div>

        <FilterPopover beads={beads} epics={epics} query={query} onChange={onChange} />

        {trailing ? (
          <>
            {/* The seam between narrowing the data and drawing it. Decorative:
                the controls on either side already name themselves. */}
            <span aria-hidden="true" className={cn('bg-border h-5 w-px')} />
            {trailing}
          </>
        ) : null}
      </div>

      <FilterChipRow
        query={query}
        epics={epics}
        onChange={onChange}
        hiddenClosedCount={hiddenClosedCount}
      />
    </div>
  );
}
