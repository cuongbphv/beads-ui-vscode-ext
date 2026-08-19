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
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Columns3,
  HelpCircle,
  Inbox,
  PauseCircle,
  Rows3,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { StatusIndex, buildColumns, filterBeads, type BeadQuery } from '../../shared/model';
import type { Bead, BoardColumn, StatusCategory } from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';
import { BeadCard } from '../components/bead-card';
import { EmptyState } from '../components/primitives';
import { QuickFilterBar } from '../components/filter-bar';
import { useToast } from '../components/toast';
import {
  CATEGORY_EMPTY_TEXT,
  collapsedSet,
  toggleCollapsed as nextCollapsed,
} from '../lib/board-columns';
import {
  BOARD_ANNOUNCEMENTS,
  BOARD_KEYBOARD_CODES,
  BOARD_SCREEN_READER_INSTRUCTIONS,
  boardKeyboardCoordinates,
} from '../lib/board-keyboard';
import { buildSwimlanes, laneDropId, parseLaneDropId, type Swimlane } from '../lib/board-swimlanes';
import { labelChipStyle } from '../lib/label-color';
import { cn } from '../lib/utils';

/** A column's accent, so the board reads as a gradient from open to done. */
const CATEGORY_ACCENT: Record<StatusCategory, string> = {
  active: 'var(--color-chart-blue)',
  wip: 'var(--color-chart-orange)',
  frozen: 'var(--color-chart-neutral)',
  done: 'var(--color-chart-green)',
  unspecified: 'var(--color-chart-purple)',
};

/** The glyph for each empty column; the sentence lives in lib/board-columns. */
const CATEGORY_EMPTY_ICON: Record<StatusCategory, LucideIcon> = {
  active: Inbox,
  wip: CircleDashed,
  frozen: PauseCircle,
  done: CheckCircle2,
  unspecified: HelpCircle,
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
  collapsedColumns,
  onCollapsedColumnsChange,
  swimlanes: swimlanesEnabled,
  onSwimlanesChange,
}: {
  beads: Bead[];
  index: StatusIndex;
  query: BeadQuery;
  onQueryChange: (next: BeadQuery) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
  /** `undefined` means the user has never chosen — fall back to the default. */
  collapsedColumns?: StatusCategory[];
  onCollapsedColumnsChange: (next: StatusCategory[]) => void;
  /** Group columns into taxonomy-label lanes instead of one flat board. Default off. */
  swimlanes?: boolean;
  onSwimlanesChange: (next: boolean) => void;
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

  // One filtered snapshot feeds both the flat board and the swimlane grouping
  // below — never re-filter per lane.
  const visible = useMemo(
    () =>
      filterBeads(beads, query, index).map((bead) =>
        optimistic[bead.id] ? { ...bead, status: optimistic[bead.id] } : bead,
      ),
    [beads, query, index, optimistic],
  );

  const columns = useMemo(() => buildColumns(visible, index), [visible, index]);

  // Only built when the toggle is on — buildSwimlanes runs buildColumns once
  // per lane, so skipping it entirely on the (default) flat path is what keeps
  // that path exactly as cheap as it is today.
  const swimlanes = useMemo(
    () => (swimlanesEnabled ? buildSwimlanes(visible, index) : undefined),
    [swimlanesEnabled, visible, index],
  );

  // A pointer must travel a few pixels before a drag starts, otherwise clicking
  // a card to open its details would be swallowed by the drag sensor.
  //
  // The keyboard sensor is the same board without a mouse: space picks a card
  // up, the arrow keys move it one *column* at a time (see `board-keyboard`),
  // space drops it and escape puts it back.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
      keyboardCodes: BOARD_KEYBOARD_CODES,
    }),
  );

  const collapsed = useMemo(() => collapsedSet(collapsedColumns), [collapsedColumns]);

  const [activeCategory, setActiveCategory] = useState<string>();
  const narrowColumn =
    columns.find((column) => column.category === activeCategory) ?? columns[0];

  function onDragStart(event: DragStartEvent): void {
    setDragging(beads.find((bead) => bead.id === event.active.id));
  }

  async function onDragEnd(event: DragEndEvent): Promise<void> {
    setDragging(undefined);
    const id = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : undefined;
    if (!overId) return;

    // Swimlane droppables are `lane::category`; the flat board's are a bare
    // category. Either way only the category decides the next status — a
    // card dropped in a different lane never mutates its label, because the
    // lane is discarded right here.
    const targetCategory = parseLaneDropId(overId)?.category ?? overId;

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
        <QuickFilterBar
          beads={beads}
          epics={epics}
          query={query}
          onChange={onQueryChange}
          trailing={
            <button
              type="button"
              title="Group columns into taxonomy-label lanes"
              aria-pressed={Boolean(swimlanesEnabled)}
              onClick={() => onSwimlanesChange(!swimlanesEnabled)}
              className={cn(
                'surface-interactive inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs',
                swimlanesEnabled
                  ? 'bg-surface-active text-fg-strong'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              <Rows3 aria-hidden="true" className="size-3.5" />
              Swimlanes
            </button>
          }
        />

        {/* Column switcher: only rendered where a multi-column board will not fit.
            Doubles as the per-lane narrow selector when swimlanes are on — one
            picker for "which category" rather than one per lane. */}
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

      <DndContext
        sensors={sensors}
        accessibility={{
          announcements: BOARD_ANNOUNCEMENTS,
          screenReaderInstructions: BOARD_SCREEN_READER_INSTRUCTIONS,
        }}
        onDragStart={onDragStart}
        onDragEnd={(e) => void onDragEnd(e)}
        // Escape only reaches the board through the keyboard sensor, and it
        // ends the drag without an `onDragEnd` — without this the overlay card
        // would hang around after the move was called off.
        onDragCancel={() => setDragging(undefined)}
      >
        {swimlanes ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {swimlanes.map((swimlane) => (
              <SwimlaneSection
                key={swimlane.lane}
                swimlane={swimlane}
                narrowCategory={narrowColumn?.category}
                onSelect={onSelect}
                selectedId={selectedId}
                blockedIds={blockedIds}
                collapsed={collapsed}
                onToggleCollapsed={(category) =>
                  onCollapsedColumnsChange(nextCollapsed(collapsedColumns, category))
                }
              />
            ))}
          </div>
        ) : (
          <>
            {/* Narrow: one column. Wide: all of them, scroll-snapped. */}
            {/* One column at a time: the user picked it from the switcher, so it is
                never folded away. */}
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
                  collapsed={collapsed.has(column.category)}
                  onToggleCollapsed={() =>
                    onCollapsedColumnsChange(nextCollapsed(collapsedColumns, column.category))
                  }
                  className={cn(
                    'shrink-0 snap-start',
                    collapsed.has(column.category) ? 'w-52' : 'w-72 @5xl:flex-1',
                  )}
                />
              ))}
            </div>
          </>
        )}

        <DragOverlay dropAnimation={null}>
          {dragging ? <BeadCard bead={dragging} className="w-64 shadow-lg" /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/**
 * One lane's worth of the board: a header naming the lane, then that lane's
 * columns. Narrow uses the same category switcher as the flat board (one
 * column per lane, stacked); wide repeats the flat board's row, once per lane
 * — a real swimlane grid, lanes as rows and status categories as columns.
 */
function SwimlaneSection({
  swimlane,
  narrowCategory,
  onSelect,
  selectedId,
  blockedIds,
  collapsed,
  onToggleCollapsed,
}: {
  swimlane: Swimlane;
  narrowCategory?: StatusCategory;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
  collapsed: Set<StatusCategory>;
  onToggleCollapsed: (category: StatusCategory) => void;
}): ReactNode {
  const narrowColumn =
    swimlane.columns.find((column) => column.category === narrowCategory) ?? swimlane.columns[0];
  const total = swimlane.columns.reduce((sum, column) => sum + column.beads.length, 0);

  return (
    <section aria-label={`${swimlane.lane} lane, ${total} issues`} className="border-border border-b">
      <header className="flex items-center gap-2 px-3 py-2">
        {swimlane.warning ? (
          // Color is never the only signal here: the dashed border, the icon,
          // and the "unlabeled" text all say the same thing independently.
          <span className="text-warning border-warning inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs">
            <AlertTriangle aria-hidden="true" className="size-3" />
            {swimlane.lane}
          </span>
        ) : (
          <span
            className="label-chip rounded-full px-2 py-0.5 text-xs"
            style={labelChipStyle(swimlane.lane) as CSSProperties}
          >
            {swimlane.lane}
          </span>
        )}
        <span className="text-fg-muted text-xs tabular-nums">{total}</span>
      </header>

      <div className="pb-3 @2xl:hidden">
        {narrowColumn ? (
          <Column
            column={narrowColumn}
            dropId={laneDropId(swimlane.lane, narrowColumn.category)}
            onSelect={onSelect}
            selectedId={selectedId}
            blockedIds={blockedIds}
            className="mx-3 h-72"
          />
        ) : null}
      </div>

      <div className="hidden gap-2 overflow-x-auto px-3 pb-3 @2xl:flex">
        {swimlane.columns.map((column) => (
          <Column
            key={column.category}
            column={column}
            dropId={laneDropId(swimlane.lane, column.category)}
            onSelect={onSelect}
            selectedId={selectedId}
            blockedIds={blockedIds}
            collapsed={collapsed.has(column.category)}
            onToggleCollapsed={() => onToggleCollapsed(column.category)}
            className={cn(
              'h-80 shrink-0',
              collapsed.has(column.category) ? 'w-52' : 'w-72 @5xl:flex-1',
            )}
          />
        ))}
      </div>
    </section>
  );
}

function Column({
  column,
  dropId,
  onSelect,
  selectedId,
  blockedIds,
  className,
  collapsed = false,
  onToggleCollapsed,
}: {
  column: BoardColumn;
  /** Droppable id. Defaults to the bare category — the flat board's id, unchanged. */
  dropId?: string;
  onSelect: (id: string) => void;
  selectedId?: string;
  blockedIds: Set<string>;
  className?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}): ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? column.category });
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
      <Header
        column={column}
        accent={accent}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />

      {collapsed ? (
        // Still a drop target: the whole section is the droppable, so a card can
        // be dragged onto a folded column without unfolding it first.
        <div className="flex flex-1 flex-col p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={cn(
              'border-border text-fg-muted hover:bg-surface-hover hover:text-fg surface-interactive',
              'cursor-pointer rounded-md border border-dashed px-2 py-3 text-xs',
              isOver && 'border-border-strong text-fg',
            )}
          >
            {isOver
              ? `Drop to move to ${column.label}`
              : column.beads.length === 0
                ? CATEGORY_EMPTY_TEXT[column.category]
                : `Show ${column.beads.length} ${column.beads.length === 1 ? 'issue' : 'issues'}`}
          </button>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          {column.beads.length === 0 ? (
            <li>
              <ColumnEmpty category={column.category} label={column.label} isOver={isOver} />
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
      )}
    </section>
  );
}

function Header({
  column,
  accent,
  collapsed,
  onToggleCollapsed,
}: {
  column: BoardColumn;
  accent: string;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
}): ReactNode {
  const heading = (
    <>
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
    </>
  );

  // Without a toggle the header is just a label; with one, the whole strip is
  // the control, so the hit target matches what it looks like.
  if (!onToggleCollapsed) {
    return (
      <header className="border-border flex items-baseline gap-2 border-b px-2.5 py-2">
        {heading}
        <span className="text-fg-muted ml-auto truncate text-xs" title={column.statuses.join(', ')}>
          {column.statuses.join(' · ')}
        </span>
      </header>
    );
  }

  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <header className="border-border border-b">
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${column.label}, ${column.beads.length} issues`}
        className="hover:bg-surface-hover surface-interactive flex w-full cursor-pointer items-baseline gap-2 rounded-t-lg px-2.5 py-2 text-left"
      >
        <Chevron aria-hidden="true" className="text-fg-muted size-3.5 shrink-0 self-center" />
        {heading}
        {!collapsed ? (
          <span
            className="text-fg-muted ml-auto truncate text-xs"
            title={column.statuses.join(', ')}
          >
            {column.statuses.join(' · ')}
          </span>
        ) : null}
      </button>
    </header>
  );
}

/** The sentence an empty column earns, plus what to do about it. */
function ColumnEmpty({
  category,
  label,
  isOver,
}: {
  category: StatusCategory;
  label: string;
  isOver: boolean;
}): ReactNode {
  const Icon = CATEGORY_EMPTY_ICON[category];
  const text = CATEGORY_EMPTY_TEXT[category];
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-md border border-dashed px-2 py-5 text-center transition-colors',
        isOver ? 'border-border-strong text-fg' : 'border-border text-fg-muted',
      )}
    >
      <Icon aria-hidden="true" className="size-5 opacity-60" />
      <p className="text-xs">{isOver ? `Drop to move to ${label}` : text}</p>
      {!isOver ? <p className="text-fg-muted text-xs opacity-70">Drag a card here to move it.</p> : null}
    </div>
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
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: bead.id,
  });

  // The wrapper is the thing that moves; the card inside it is the thing you
  // focus and press space on. They have to be split: the keyboard sensor only
  // fires when the key event's target *is* the activator node, so the activator
  // belongs on the element focus lands on. Spreading the attributes out here as
  // well would wrap one button role around another and cost a second tab stop
  // on every card. The pointer sensor is unaffected — it has no such check, so
  // a press anywhere inside the card still bubbles up and starts a drag.
  return (
    <div ref={setNodeRef}>
      <BeadCard
        bead={bead}
        blocked={blocked}
        selected={selected}
        dragging={isDragging}
        onSelect={onSelect}
        drag={{ attributes, listeners, setActivatorRef: setActivatorNodeRef }}
      />
    </div>
  );
}
