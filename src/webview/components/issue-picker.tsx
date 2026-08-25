/**
 * A text input over already-loaded beads, filtered by id/title substring —
 * no RPC call, just a client-side filter over the same `beads` array every
 * other view already has in memory. Meant to sit inside a `Popover` panel
 * (see the "Add link" control in `bead-detail.tsx`): the popover supplies the
 * open/close, outside-click and Escape handling and moves focus onto this
 * input when it opens; this component supplies the type-ahead filter and a
 * keyboard-navigable listbox (ArrowUp/ArrowDown/Enter) on top of it.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';

import type { Bead } from '../../shared/types';
import { cn } from '../lib/utils';

/**
 * Caps how many matches render at once. `beads` can be the whole project;
 * without a cap an empty query would dump every issue into the DOM.
 */
const MAX_RESULTS = 20;

export function IssuePicker({
  beads,
  excludeIds = [],
  onPick,
  placeholder = 'Search by id or title…',
  autoFocus = false,
}: {
  beads: Bead[];
  /** Ids never offered as a match — e.g. the issue itself, or ones already linked. */
  excludeIds?: string[];
  onPick: (bead: Bead) => void;
  placeholder?: string;
  autoFocus?: boolean;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const candidates = beads.filter((bead) => !excluded.has(bead.id));
    const matched = needle
      ? candidates.filter(
          (bead) =>
            bead.id.toLowerCase().includes(needle) || bead.title.toLowerCase().includes(needle),
        )
      : candidates;
    return matched.slice(0, MAX_RESULTS);
  }, [beads, excluded, query]);

  function commit(index: number): void {
    const target = results[index];
    if (!target) return;
    onPick(target);
    setQuery('');
    setActiveIndex(0);
  }

  return (
    <div className="grid gap-1">
      <input
        type="text"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={results.length > 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-label="Search issues"
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            commit(activeIndex);
          }
          // Escape is deliberately not handled here: the enclosing Popover's
          // document-level listener already closes the whole panel on it.
        }}
        className="bg-input-bg border-input-border text-fg min-w-0 rounded-md border px-2 py-1 text-sm"
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Matching issues"
        className="border-border max-h-40 overflow-y-auto rounded-md border"
      >
        {results.length === 0 ? (
          <li className="text-fg-muted px-2 py-1.5 text-xs">No matching issues.</li>
        ) : (
          results.map((bead, index) => (
            <li key={bead.id} id={`${listboxId}-${index}`} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onClick={() => commit(index)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm',
                  index === activeIndex ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                )}
              >
                <span className="text-fg-muted shrink-0 font-mono text-xs">{bead.id}</span>
                <span className="truncate">{bead.title}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
