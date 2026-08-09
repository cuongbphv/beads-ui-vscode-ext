/**
 * A button that reveals a small panel beneath itself.
 *
 * Hand-rolled rather than pulled from Radix: nothing else in the webview
 * depends on a component library, and the panel is anchored to its own trigger,
 * so none of the collision detection a positioning engine exists to provide is
 * needed here. What is not optional is the keyboard contract — a panel that
 * traps focus with no way out, or swallows Escape, is worse than no panel.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { cn } from '../lib/utils';

export function Popover({
  triggerLabel,
  triggerContent,
  triggerClassName,
  label,
  className,
  children,
}: {
  /** Accessible name of the trigger. Carries the state, e.g. `Filters, 2 active`. */
  triggerLabel: string;
  triggerContent: ReactNode;
  triggerClassName?: string;
  /** Accessible name of the panel itself. */
  label: string;
  className?: string;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Both listeners are on the document because both events are about what
  // happened *outside* the panel; a handler on the panel would never see them.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Dismissing must not strand focus on a node that is about to unmount.
      triggerRef.current?.focus();
    };

    // pointerdown, not click: the panel has to be gone before the press lands
    // on whatever is underneath, or the click reads as landing on the panel.
    const onPointerDown = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Opening moves focus in, so the panel is reachable without a mouse and the
  // next Tab continues inside it rather than from the trigger.
  useEffect(() => {
    if (!open) return;
    contentRef.current?.querySelector<HTMLElement>('select, input, button, [tabindex]')?.focus();
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={triggerClassName}
      >
        {triggerContent}
      </button>

      {open ? (
        <div
          ref={contentRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          className={cn(
            'popover-panel bg-surface border-border absolute top-full right-0 z-50 mt-1 rounded-md border p-2 shadow-lg',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
