/**
 * Board: kanban columns derived from status *categories* at runtime.
 *
 * There is no hardcoded column list anywhere. A project that adds an
 * `in_review` status gets it in whichever column bd assigned its category to,
 * and dropping a card there sets the first status of that category.
 *
 * Responsiveness is container-based (the panel can be dragged narrow
 * independently of the window): one column plus a switcher when cramped,
 * scroll-snap when medium, every column at once when wide.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Columns3 } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { StatusIndex, buildColumns, filterBeads, type BeadQuery } from '../../shared/model';
import type { Bead, BoardColumn, StatusCategory } from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';
import { BeadCard } from '../components/bead-card';
import { EmptyState } from '../components/primitives';
import { QuickFilterBar } from '../components/quick-filter-bar';
import { useToast } from '../components/toast';
import { cn } from '../lib/utils';

/** A column's accent, so the board reads as a gradient from open to done. */
const CATEGORY_ACCENT: Record<StatusCategory, string> = {
  active: 'var(--color-p2)',
  wip: 'var(--color-warning)',
  frozen: 'var(--color-fg-muted)',
  done: 'var(--color-success)',
  unspecified: 'var(--color-p4)',
};

/**
 * Cards rendered per column before a "Load more" appears. A 2000-issue project
 * would otherwise mount 2000 cards on the first paint (T402).
 */
const PAGE = 50;

export function BoardView({
  beads,
  index,
  query,
  onQueryChange,
  onSelect,
  selectedId,
  blockedIds,
}: {
  beads: Bead[];
  index: StatusIndex;
  query: BeadQuery;
  onQueryChange: (next: BeadQuery) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
}): ReactNode {
  const { notify } = useToast();
  const [dragging, setDragging] = useState<Bead>();
  /**
   * Optimistic override: id → status. Applied on top of the snapshot so the
   * card lands in the new column immediately, and dropped as soon as the host
   * pushes a snapshot that already reflects it.
   */
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});

  // Retire each optimistic override the moment the host's snapshot agrees with
  // it; leaving them in place would mask a later change made outside the panel.
  useEffect(() => {
    setOptimistic((current) => {
      const remaining = Object.entries(current).filter(([id, status]) => {
        const bead = beads.find((candidate) => candidate.id === id);
        return bead !== undefined && bead.status !== status;
      });
      return remaining.length === Object.keys(current).length
        ? current
        : Object.fromEntries(remaining);
    });
  }, [beads]);

  const epics = useMemo(() => beads.filter((bead) => bead.issue_type === 'epic'), [beads]);

  const columns = useMemo(() => {
    const visible = filterBeads(beads, query, index).map((bead) =>
      optimistic[bead.id] ? { ...bead, status: optimistic[bead.id] } : bead,
    );
    return buildColumns(visible, index);
  }, [beads, query, index, optimistic]);

  // A pointer must travel a few pixels before a drag starts, otherwise clicking
  // a card to open its details would be swallowed by the drag sensor.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const [activeCategory, setActiveCategory] = useState<string>();
  const narrowColumn =
    columns.find((column) => column.category === activeCategory) ?? columns[0];

  function onDragStart(event: DragStartEvent): void {
    setDragging(beads.find((bead) => bead.id === event.active.id));
  }

  async function onDragEnd(event: DragEndEvent): Promise<void> {
    setDragging(undefined);
    const id = String(event.active.id);
    const targetCategory = event.over?.id ? String(event.over.id) : undefined;
    if (!targetCategory) return;

    const bead = beads.find((candidate) => candidate.id === id);
    const column = columns.find((candidate) => candidate.category === targetCategory);
    if (!bead || !column) return;

    // Dropping into a column means "any status in this category"; keep the
    // issue's own status if it already belongs there.
    if (index.category(bead.status) === column.category) return;
    const nextStatus = column.statuses[0];
    if (!nextStatus) {
      notify(`No status is registered for the ${column.label} column.`, 'error');
      return;
    }

    setOptimistic((current) => ({ ...current, [id]: nextStatus }));
    try {
      await call('setStatus', { id, status: nextStatus });
      notify(`${id} → ${nextStatus}`);
    } catch (error) {
      // Roll back to whatever bd actually has.
      setOptimistic((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      notify(asRpcError(error).message, 'error');
    }
  }

  if (columns.length === 0) {
    return (
      <EmptyState
        icon={<Columns3 className="size-10" />}
        title="No issues to show"
        hint="Adjust the filters, or create an issue with `bd create`."
      />
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="border-border border-b px-3 py-2">
        <QuickFilterBar beads={beads} epics={epics} query={query} onChange={onQueryChange} />

        {/* Column switcher: only rendered where a multi-column board will not fit. */}
        <div className="mt-2 flex gap-1 overflow-x-auto @2xl:hidden">
          {columns.map((column) => (
            <button
              key={column.category}
              type="button"
              onClick={() => setActiveCategory(column.category)}
              aria-pressed={column === narrowColumn}
              className={cn(
                'surface-interactive shrink-0 rounded-md border px-2 py-1 text-sm',
                column === narrowColumn
                  ? 'border-border-strong bg-surface-active text-fg-strong'
                  : 'border-border text-fg-muted hover:bg-surface-hover',
              )}
            >
              {column.label}
              <span className="ml-1 tabular-nums opacity-70">{column.beads.length}</span>
            </button>
          ))}
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={(e) => void onDragEnd(e)}>
        {/* Narrow: one column. Wide: all of them, scroll-snapped. */}
        <div className="min-h-0 flex-1 @2xl:hidden">
          {narrowColumn ? (
            <Column
              column={narrowColumn}
              onSelect={onSelect}
              selectedId={selectedId}
              blockedIds={blockedIds}
              className="h-full"
            />
          ) : null}
        </div>

        <div className="hidden min-h-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto px-3 py-3 @2xl:flex">
          {columns.map((column) => (
            <Column
              key={column.category}
              column={column}
              onSelect={onSelect}
              selectedId={selectedId}
              blockedIds={blockedIds}
              className="w-72 shrink-0 snap-start @5xl:flex-1"
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging ? <BeadCard bead={dragging} className="w-64 shadow-lg" /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({
  column,
  onSelect,
  selectedId,
  blockedIds,
  className,
}: {
  column: BoardColumn;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
  className?: string;
}): ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id: column.category });
  const [limit, setLimit] = useState(PAGE);
  const accent = CATEGORY_ACCENT[column.category] ?? 'var(--color-fg-muted)';

  // A filter change can shrink a column below the current window; reset so the
  // "Load more" count never claims more than is there.
  const shown = column.beads.slice(0, limit);
  const hidden = column.beads.length - shown.length;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.label}, ${column.beads.length} issues`}
      style={{ '--accent-color': accent } as CSSProperties}
      className={cn(
        'bg-surface border-border surface-interactive flex min-h-0 flex-col rounded-lg border',
        isOver && 'border-border-strong drop-target',
        className,
      )}
    >
      <header className="border-border flex items-baseline gap-2 border-b px-2.5 py-2">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 self-center rounded-full"
          style={{ background: accent }}
        />
        <h2 className="text-fg-strong text-sm font-medium">{column.label}</h2>
        <span
          className="rounded-full px-1.5 text-xs tabular-nums"
          style={{
            background: `color-mix(in oklab, ${accent} 18%, transparent)`,
            color: accent,
          }}
        >
          {column.beads.length}
        </span>
        <span className="text-fg-muted ml-auto truncate text-xs" title={column.statuses.join(', ')}>
          {column.statuses.join(' · ')}
        </span>
      </header>

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {column.beads.length === 0 ? (
          <li
            className={cn(
              'text-fg-muted rounded-md border border-dashed px-1 py-4 text-center text-xs transition-colors',
              isOver ? 'border-border-strong text-fg' : 'border-border',
            )}
          >
            Drop an issue here
          </li>
        ) : (
          shown.map((bead) => (
            <li key={bead.id}>
              <DraggableCard
                bead={bead}
                blocked={blockedIds.has(bead.id)}
                selected={bead.id === selectedId}
                onSelect={onSelect}
              />
            </li>
          ))
        )}

        {hidden > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setLimit((current) => current + PAGE)}
              className="border-border text-fg-muted hover:bg-surface-hover hover:text-fg surface-interactive w-full cursor-pointer rounded-md border border-dashed px-2 py-1.5 text-xs"
            >
              Load {Math.min(hidden, PAGE)} more · {hidden} hidden
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function DraggableCard({
  bead,
  blocked,
  selected,
  onSelect,
}: {
  bead: Bead;
  blocked: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}): ReactNode {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: bead.id });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
      <BeadCard
        bead={bead}
        blocked={blocked}
        selected={selected}
        dragging={isDragging}
        onSelect={onSelect}
      />
    </div>
  );
}
