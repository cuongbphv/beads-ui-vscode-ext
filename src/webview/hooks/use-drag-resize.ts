/**
 * Pointer wiring for a splitter.
 *
 * `setPointerCapture` on the handle itself, rather than listeners on the
 * document: the pointer routinely leaves a 6px handle mid-drag, and in a webview
 * it can leave the frame entirely without us ever seeing the pointerup.
 */
import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import { keyResize, shouldActOnPointerMove, sizeFromDrag, type Range } from '../lib/drag-resize';

export interface DragResizeHandlers {
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function useDragResize({
  size,
  range,
  sign = 1,
  onChange,
}: {
  size: number;
  range: Range;
  sign?: 1 | -1;
  onChange: (next: number) => void;
}): DragResizeHandlers {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, size });

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = { x: event.clientX, size };
      setDragging(true);
    },
    [size],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const captureStillHeld = event.currentTarget.hasPointerCapture(event.pointerId);
      if (!shouldActOnPointerMove(dragging, captureStillHeld)) return;
      onChange(sizeFromDrag(origin.current.size, event.clientX - origin.current.x, sign, range));
    },
    [dragging, onChange, range, sign],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!dragging) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
    },
    [dragging],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!dragging) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
    },
    [dragging],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const next = keyResize(event.key, event.shiftKey, size, range, sign);
      if (next === undefined) return;
      event.preventDefault();
      onChange(next);
    },
    [onChange, range, sign, size],
  );

  return { dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown };
}
