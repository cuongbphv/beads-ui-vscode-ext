/**
 * One task bar, and the handle that reschedules it.
 *
 * The bar body stays a plain button that selects the issue — making it both
 * draggable and clickable would swallow the selection. Only the right edge is
 * draggable, because beads has no `--start` to write a left edge back to.
 */
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { formatDuration, placement, type Span, type Timeline } from '../../../shared/schedule';
import { typeStyle } from '../../../shared/types';
import {
  commitFor,
  endFromDrag,
  keyReschedule,
  pastDragThreshold,
  planBarEdit,
  rescheduleRange,
  toDueDate,
  type BarEdit,
} from '../../lib/bar-drag';
import { shouldActOnPointerMove } from '../../lib/drag-resize';
import { barTitle, isEditable, previewSpan } from '../../lib/gantt-bar-layout';
import { cn } from '../../lib/utils';

export function GanttBar({
  span,
  timeline,
  done,
  onSelect,
  onCommit,
  pending,
}: {
  span: Span;
  timeline: Timeline;
  done: boolean;
  onSelect: (id: string) => void;
  /**
   * Called once on release, and never with a `none` edit. Omitting this
   * (rather than passing a no-op) is how a host says "not editable yet" —
   * the handle itself does not render without it, so there is nothing for a
   * user to drag into a silent discard.
   */
  onCommit?: (edit: BarEdit) => void;
  /** True while this bead has a write in flight, from release until bd answers. */
  pending: boolean;
}): ReactNode {
  const bead = span.bead;
  const style = typeStyle(bead.issue_type);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, moved: false });
  const [preview, setPreview] = useState<number | undefined>(undefined);

  const editable = isEditable(span, onCommit !== undefined);
  const shown = previewSpan(span, preview);
  const { left, width } = placement(shown, timeline);
  const range = rescheduleRange(span, timeline);

  // `commitFor` maps a `none` decision (unchanged, or a closed issue) to
  // "nothing to send" — this must not spawn a bd subprocess. Both the pointer
  // and the keyboard land here, so the two cannot drift apart about what a
  // given end means.
  const commitEnd = useCallback(
    (end: number) => {
      const payload = commitFor(planBarEdit(span, end));
      if (payload) onCommit?.(payload);
    },
    [onCommit, span],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, moved: false };
    setPreview(span.end);
  }, [span.end]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // `preview !== undefined` alone is not enough: capture can be stolen or
      // silently dropped mid-drag (an OS gesture, another element) without a
      // synchronous pointerup/pointercancel ever reaching us. Re-checking
      // live capture on every move — the same guard `use-drag-resize.ts`
      // applies — means a drag we no longer own cannot keep moving the bar.
      const captureStillHeld = event.currentTarget.hasPointerCapture(event.pointerId);
      if (!shouldActOnPointerMove(preview !== undefined, captureStillHeld)) return;

      const delta = event.clientX - drag.current.x;
      const moved = pastDragThreshold(drag.current.moved, delta);
      if (!moved) return;
      drag.current.moved = true;
      setPreview(endFromDrag(span, delta, trackRef.current?.clientWidth ?? 0, timeline));
    },
    [preview, span, timeline],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (preview === undefined) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const moved = drag.current.moved;
      const end = preview;
      setPreview(undefined);
      if (!moved) return;
      commitEnd(end);
    },
    [commitEnd, preview],
  );

  // The browser cancels a pointer gesture on window blur, alt-tab, or a
  // touch being claimed by scrolling — a handler that only listens for
  // `pointerup` would leave the drag preview stuck. A cancelled drag commits
  // nothing: the user never got to choose where to release.
  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (preview === undefined) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPreview(undefined);
    },
    [preview],
  );

  // Capture can also be lost with no `pointercancel` at all — another element
  // claiming the pointer, or the platform revoking it. This fires after our
  // own release in `pointerup` too, which is why it only ever clears: the
  // commit has already happened by then, and re-running it would double-write.
  const onLostPointerCapture = useCallback(() => setPreview(undefined), []);

  /**
   * Keyboard editing, so the handle is not a mouse-only control wearing a
   * `role="slider"`.
   *
   * Arrows move a preview and Enter writes it, rather than committing on every
   * keystroke: each commit is a bd subprocess and a toast, and holding a key
   * would queue a dozen writes for one intended change. Escape and losing
   * focus both abandon the edit, so a preview can never outlive the gesture.
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const next = keyReschedule(event.key, event.shiftKey, preview ?? span.end, span, timeline);
      if (next !== undefined) {
        event.preventDefault();
        setPreview(next);
        return;
      }

      if (preview === undefined) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        setPreview(undefined);
        commitEnd(preview);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setPreview(undefined);
      }
    },
    [commitEnd, preview, span, timeline],
  );

  const onBlur = useCallback(() => setPreview(undefined), []);

  return (
    <div ref={trackRef} className="relative h-7 min-w-0 flex-1">
      <button
        type="button"
        onClick={() => onSelect(bead.id)}
        title={barTitle(span)}
        className={cn(
          'absolute top-1/2 flex h-4 -translate-y-1/2 cursor-pointer items-center gap-1 rounded-sm px-1 text-[10px] whitespace-nowrap transition-[filter,box-shadow] hover:brightness-110',
          // An inferred end is drawn faint, so a bar that is really a guess
          // never reads as a commitment.
          span.kind === 'nominal' && 'opacity-55',
          span.overdue && 'ring-danger ring-1',
          pending && 'animate-pulse opacity-60',
        )}
        style={
          {
            left: `${left}%`,
            width: `${width}%`,
            background: done
              ? `color-mix(in oklab, var(--color-success) 55%, transparent)`
              : span.deferred
                ? `color-mix(in oklab, ${style.color} 30%, transparent)`
                : style.color,
            color: 'var(--color-bg)',
          } as CSSProperties
        }
      >
        <span className="sr-only">{barTitle(span)}</span>
      </button>

      {editable ? (
        <span
          role="slider"
          aria-label={`Reschedule ${bead.id}`}
          // Seconds, not milliseconds: assistive technology reads the number
          // out, and the bounds have to be in whatever unit `aria-valuenow` is.
          aria-valuemin={Math.round(range.min / 1000)}
          aria-valuemax={Math.round(range.max / 1000)}
          aria-valuenow={Math.round(shown.end / 1000)}
          aria-valuetext={toDueDate(shown.end)}
          title={`Reschedule ${bead.id} — drag, or use the arrow keys and press Enter`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onLostPointerCapture}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className={cn(
            // Invisible until the row is hovered or the handle is focused: a
            // permanently visible grip on every bar would be noise, and an
            // easy way to write a date nobody meant to change.
            'absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 cursor-col-resize touch-none rounded-sm opacity-0',
            'bg-fg-strong/70 group-hover/row:opacity-100 focus-visible:opacity-100',
            preview !== undefined && 'opacity-100',
          )}
          style={{ left: `${Math.min(left + width, 100)}%` }}
        />
      ) : null}

      {/* The estimate rides outside the bar, where a 3px bar can still show it. */}
      {bead.estimated_minutes ? (
        <span
          aria-hidden="true"
          className="text-fg-muted absolute top-1/2 hidden -translate-y-1/2 pl-3 text-[10px] whitespace-nowrap tabular-nums @2xl:inline"
          style={{ left: `${Math.min(left + width, 96)}%` }}
        >
          {formatDuration(bead.estimated_minutes)}
        </span>
      ) : null}
    </div>
  );
}
