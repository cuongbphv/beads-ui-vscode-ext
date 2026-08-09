/**
 * A draggable divider, used by the Roadmap gutter and the detail pane.
 *
 * `role="separator"` with `aria-valuenow` is the ARIA window-splitter pattern:
 * it is focusable and resizable from the keyboard, because a mouse-only resize
 * would make part of the UI unreachable.
 */
import type { ReactNode } from 'react';

import { useDragResize } from '../hooks/use-drag-resize';
import type { Range } from '../lib/drag-resize';
import { cn } from '../lib/utils';

export function Splitter({
  size,
  range,
  sign = 1,
  onChange,
  label,
  onReset,
  className,
}: {
  size: number;
  range: Range;
  /** 1 when the resized pane is left of the handle, -1 when it is right of it. */
  sign?: 1 | -1;
  onChange: (next: number) => void;
  label: string;
  /** Double-click target. Omit to make double-click do nothing. */
  onReset?: () => void;
  className?: string;
}): ReactNode {
  const { dragging, ...handlers } = useDragResize({ size, range, sign, onChange });

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      onDoubleClick={onReset}
      {...handlers}
      // `touch-none` stops the webview panning instead of resizing on a trackpad
      // press-drag; `select-none` stops the drag selecting the rows either side.
      className={cn(
        'group relative w-1.5 shrink-0 cursor-col-resize touch-none select-none',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'surface-interactive absolute inset-y-0 left-1/2 w-px -translate-x-1/2',
          dragging ? 'bg-border-strong' : 'bg-border group-hover:bg-border-strong',
        )}
      />
    </div>
  );
}
