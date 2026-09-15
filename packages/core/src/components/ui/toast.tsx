'use client';

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * The global toast — a module-level singleton any client component can call
 * with no provider at the call site; `<Toaster />` is mounted once in the
 * dashboard layout.
 *
 *   toast.success('Approved · Add github.* family', { description: 'Executing now.', action: { label: 'Undo', onClick } });
 *   toast.error('Could not approve', { description: err.message });
 *   toast.info('Snoozed until tomorrow');
 *
 * PLACEHOLDER. This file implements the contract of the toast landing on
 * `workforce/2026-09-15-toasts` (same path, same API) so the decision surface
 * can call it and still build before that branch merges into the release.
 * When the two meet, take theirs — nothing here is meant to survive.
 */

export type ToastTone = 'success' | 'error' | 'info';

export type ToastOptions = {
  description?: string;
  action?: { label: string; onClick: () => void };
  /** Milliseconds on screen. Errors stay longer by default. */
  duration?: number;
};

export type ToastRecord = ToastOptions & { id: number; tone: ToastTone; title: string };

const listeners = new Set<() => void>();
let items: ToastRecord[] = [];
let seq = 0;
const EMPTY: ToastRecord[] = [];

function emit() {
  for (const l of listeners) {
    l();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function dismiss(id: number) {
  items = items.filter(t => t.id !== id);
  emit();
}

function push(tone: ToastTone, title: string, opts: ToastOptions = {}): number {
  const id = ++seq;
  items = [...items.slice(-3), { id, tone, title, ...opts }];
  emit();
  const duration = opts.duration ?? (tone === 'error' ? 8000 : 4500);
  if (duration > 0 && typeof window !== 'undefined') {
    window.setTimeout(() => dismiss(id), duration);
  }
  return id;
}

export const toast = {
  success: (title: string, opts?: ToastOptions) => push('success', title, opts),
  error: (title: string, opts?: ToastOptions) => push('error', title, opts),
  info: (title: string, opts?: ToastOptions) => push('info', title, opts),
  dismiss,
};

const ICON: Record<ToastTone, typeof Info> = { success: CheckCircle2, error: XCircle, info: Info };
const TONE: Record<ToastTone, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-muted-foreground',
};

/** Mount once. Renders the live queue bottom-right, newest last, each dismissible. */
export function Toaster() {
  // The queue is an external store: a new array on every change, so React re-renders on it; empty on the server.
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  if (list.length === 0) {
    return null;
  }
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4" data-testid="toaster">
      {list.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            data-tone={t.tone}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-border bg-background/95 px-3.5 py-3 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85"
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', TONE[t.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[13px] break-words text-muted-foreground">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                  className="mt-1.5 text-[13px] font-medium underline decoration-border underline-offset-2 hover:decoration-foreground"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-1 rounded p-1 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
