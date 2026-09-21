'use client';

import type { ReactNode } from 'react';
import type { ReviewWhy as ReviewWhyModel } from './reviewSheetModel';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * "Why this?" — one fold holding everything the header used to say out loud.
 *
 * Chris, 2026-09-19: *"there may be **too** much in the head/header as
 * context? maybe it should be explorable discoverable if needed?"* So the
 * header keeps the line a person reads at a glance and this holds the rest:
 * the agent's reason in full, the run id, how long it has waited, the
 * confidence, what changes, the payload, the citations and the record's
 * earlier decisions. **Nothing is deleted** — it is one click away, which is
 * principle 9 exactly (hide complexity, never hide truth).
 *
 * Open state is remembered per browser, not per server round trip: a reviewer
 * who wants the reasoning every time gets it every time, and it costs one
 * `localStorage` key rather than a column.
 */

const REMEMBER_KEY = 'vocion.review.whyThis';

const listeners = new Set<() => void>();

/**
 * Whether this browser asked for the fold open. Read straight from storage on
 * every snapshot — it is one synchronous key, and caching it would survive a
 * second surface writing it.
 */
function readRemembered(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    // A browser with site data blocked simply starts closed.
    return false;
  }
}

/** The server has no browser to ask, so the fold renders closed and hydrates. */
function serverSnapshot(): boolean {
  return false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function remember(open: boolean): void {
  try {
    window.localStorage.setItem(REMEMBER_KEY, open ? '1' : '0');
  } catch {
    // Remembering is a convenience, never a requirement.
  }
  for (const listener of listeners) {
    listener();
  }
}

/**
 * @param props
 * @param props.why - The reason and its facts, from `splitReviewContext`.
 * @param props.children - Everything else the fold holds — evidence, payload, earlier decisions.
 */
export function ReviewWhy({ why, children }: { why: ReviewWhyModel; children?: ReactNode }) {
  // The preference is browser state, not component state: `useSyncExternalStore`
  // is what reads it without a hydration mismatch and without a setState in an
  // effect.
  const open = useSyncExternalStore(subscribe, readRemembered, serverSnapshot);

  return (
    <section data-testid="review-why" className="border-b border-rule">
      <button
        type="button"
        onClick={() => remember(!open)}
        aria-expanded={open}
        data-testid="review-why-toggle"
        className="flex min-h-10 w-full items-center gap-1.5 py-2 text-left text-[13px] text-muted-foreground transition hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        <Sparkles className="size-3.5 shrink-0 text-brand-amber-deep" aria-hidden />
        <span className="font-medium">Why this?</span>
        <span className="truncate text-muted-foreground/70">
          {open ? '' : why.facts.map(f => `${f.label} ${f.value}`).join(' · ')}
        </span>
      </button>
      <div hidden={!open} data-testid="review-why-body" className="pb-5">
        {why.reason && <p className="max-w-3xl text-[15px] leading-relaxed break-words text-foreground/90">{why.reason}</p>}
        {why.facts.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-muted-foreground tabular-nums">
            {why.facts.map(f => (
              <div key={f.label} className="flex gap-1.5">
                <dt>{f.label}</dt>
                <dd className="text-foreground/80">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
    </section>
  );
}
