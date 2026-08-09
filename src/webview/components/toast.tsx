/**
 * Minimal toast with an aria-live region.
 *
 * Deliberately not a dependency: the whole surface is "a bd call failed", "a
 * change was applied", and — for a change the user may not have meant — one
 * button that takes it back. An aria-live region is required anyway.
 */
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { cn } from '../lib/utils';

/** A single button on a toast. `run` fires the inverse write; the toast then goes. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: ToastAction;
}

interface ToastApi {
  notify: (message: string, tone?: Toast['tone'], action?: ToastAction) => void;
}

/**
 * How long a toast stays up, by what it asks of the reader.
 *
 * A confirmation is read at a glance. An error is read word for word, and one
 * carrying an action has to survive long enough to be aimed at and clicked —
 * three seconds is not that, and a bar drag the user did not mean is exactly
 * the case Undo exists for.
 */
const LIFETIME_MS = { brief: 3000, considered: 8000 } as const;

const ToastContext = createContext<ToastApi>({ notify: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'info', action?: ToastAction) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, tone, action }]);
      const lifetime =
        tone === 'error' || action ? LIFETIME_MS.considered : LIFETIME_MS.brief;
      setTimeout(() => dismiss(id), lifetime);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-3 bottom-3 z-50 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 shadow-lg',
              'bg-surface border-border text-sm',
              toast.tone === 'error' && 'border-danger text-danger',
            )}
          >
            <span className="flex-1 break-words">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  // Dismiss first: the action fires its own toast when bd
                  // answers, and a second click would send the write twice.
                  dismiss(toast.id);
                  toast.action?.run();
                }}
                className="text-accent hover:text-accent-hover shrink-0 font-medium underline underline-offset-2"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
              className="text-fg-muted hover:text-fg shrink-0"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
