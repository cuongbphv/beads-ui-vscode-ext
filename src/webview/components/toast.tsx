/**
 * Minimal toast with an aria-live region.
 *
 * Deliberately not a dependency: the whole surface is "a bd call failed" or "a
 * change was applied", and an aria-live region is required anyway.
 */
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { cn } from '../lib/utils';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

interface ToastApi {
  notify: (message: string, tone?: Toast['tone']) => void;
}

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
    (message: string, tone: Toast['tone'] = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, tone }]);
      // Errors stay long enough to read a bd message; confirmations do not.
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 3000);
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
