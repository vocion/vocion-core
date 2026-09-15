'use client';

import { CheckCircle2, CircleAlert, Info, Loader2, X } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { useEffect, useState } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * The app's one notification surface.
 *
 * Vocion had none until 2026-09-15 (Chris, after approving a decision: "what
 * do we have for toast/notifications so I can see what was done? do we have a
 * global implementation for that to build or leverage?"). The answer was no,
 * so this is it — built on the Radix Toast primitive already in the
 * dependency tree rather than a new library.
 *
 * A toast reports what the system DID, in the person's words, right after
 * they did it (Manifesto §11 *make the important things obvious*, and
 * *hide complexity, never hide truth*). It is not a place for progress, for
 * anything the person has to read to continue, or for errors that belong on
 * the form that produced them.
 *
 * Call it from anywhere on the client — the store is module level, so no
 * context import at the call site:
 *
 * ```ts
 * toast.success('Approved · Add github.* family', {
 *   description: 'Queued for the review queue.',
 *   action: { label: 'Undo', onClick: () => undo(id) },
 * });
 * ```
 *
 * `toast.promise` covers the submit-then-report shape: it shows a pending
 * toast while the work runs and rewrites it in place with the outcome, so a
 * person never watches two toasts for one action.
 */

export type ToastTone = 'success' | 'error' | 'info' | 'pending';

export type ToastAction = { label: string; onClick: () => void };

export type ToastOptions = {
  description?: string;
  action?: ToastAction;
  /** ms before it dismisses itself; 0 keeps it until dismissed. Errors default to 0. */
  duration?: number;
};

export type ToastRecord = ToastOptions & {
  id: number;
  tone: ToastTone;
  title: string;
};

type Listener = (toasts: ToastRecord[]) => void;

let nextId = 1;
let records: ToastRecord[] = [];
const listeners = new Set<Listener>();

/** Most recent first, and never more than this many on screen at once. */
const MAX_VISIBLE = 3;

function emit() {
  for (const listener of listeners) {
    listener(records);
  }
}

function upsert(record: ToastRecord) {
  const at = records.findIndex(r => r.id === record.id);
  records = at >= 0
    ? records.map(r => (r.id === record.id ? record : r))
    : [record, ...records].slice(0, MAX_VISIBLE);
  emit();
}

function dismiss(id: number) {
  records = records.filter(r => r.id !== id);
  emit();
}

function defaultDuration(tone: ToastTone): number {
  if (tone === 'error') {
    // An error is the one thing worth making someone dismiss: it usually
    // names something they have to do differently.
    return 0;
  }
  return tone === 'pending' ? 0 : 5000;
}

function show(tone: ToastTone, title: string, opts: ToastOptions = {}, id = nextId++): number {
  upsert({ id, tone, title, ...opts, duration: opts.duration ?? defaultDuration(tone) });
  return id;
}

export const toast = {
  success: (title: string, opts?: ToastOptions) => show('success', title, opts),
  error: (title: string, opts?: ToastOptions) => show('error', title, opts),
  info: (title: string, opts?: ToastOptions) => show('info', title, opts),
  /** A toast that stays until you resolve it with `toast.success`/`toast.error` on the same id. */
  pending: (title: string, opts?: ToastOptions) => show('pending', title, opts),
  /** Rewrite an existing toast in place — the id comes from any of the above. */
  update: (id: number, tone: ToastTone, title: string, opts?: ToastOptions) => show(tone, title, opts, id),
  dismiss,
  /**
   * Run work behind one toast: pending while it runs, the outcome in its
   * place when it settles. The promise's own result and rejection are
   * re-thrown unchanged, so callers keep their control flow.
   * @param work - The promise to report on.
   * @param copy - What to say at each stage.
   * @param copy.pending - Title while it runs.
   * @param copy.success - Title, or a function of the result, when it resolves.
   * @param copy.error - Title, or a function of the error, when it rejects.
   */
  async promise<T>(work: Promise<T>, copy: {
    pending: string;
    success: string | ((value: T) => string);
    error: string | ((err: unknown) => string);
  }): Promise<T> {
    const id = show('pending', copy.pending);
    try {
      const value = await work;
      show('success', typeof copy.success === 'function' ? copy.success(value) : copy.success, {}, id);
      return value;
    } catch (err) {
      show('error', typeof copy.error === 'function' ? copy.error(err) : copy.error, {}, id);
      throw err;
    }
  },
};

const TONE_ICON = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
  pending: Loader2,
} as const;

const TONE_CLASS = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-destructive',
  info: 'text-muted-foreground',
  pending: 'text-muted-foreground',
} as const;

/**
 * Mounted once, in the dashboard shell. Renders whatever the store holds.
 */
export function Toaster() {
  const [items, setItems] = useState<ToastRecord[]>(records);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {items.map((item) => {
        const Icon = TONE_ICON[item.tone];
        return (
          <ToastPrimitive.Root
            key={item.id}
            duration={item.duration === 0 ? Number.POSITIVE_INFINITY : item.duration}
            onOpenChange={open => !open && dismiss(item.id)}
            className={cn(
              'flex items-start gap-3 rounded-xl border border-border bg-background p-3 shadow-(--shadow-pop)',
              'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-2 data-[state=open]:fade-in',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out',
            )}
          >
            <Icon
              className={cn('mt-0.5 size-4 shrink-0', TONE_CLASS[item.tone], item.tone === 'pending' && 'animate-spin')}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-[13px] font-medium text-foreground">{item.title}</ToastPrimitive.Title>
              {item.description && (
                <ToastPrimitive.Description className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                  {item.description}
                </ToastPrimitive.Description>
              )}
              {item.action && (
                <ToastPrimitive.Action
                  altText={item.action.label}
                  onClick={item.action.onClick}
                  className="mt-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-hover"
                >
                  {item.action.label}
                </ToastPrimitive.Action>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-100 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}

/** Test seam: drop every toast and every listener between cases. */
export function __resetToasts() {
  records = [];
  nextId = 1;
  listeners.clear();
}

/** Test seam: what the store currently holds, newest first. */
export function __toasts(): ToastRecord[] {
  return records;
}
