'use client';

/**
 * THE PANE ON A PHONE — one drawer for everything the pane stack holds.
 *
 * Chris, 2026-10-23: "We should only have one sidebar and panes UX for all use
 * cases. On mobile it should render as a drawer and (when >=2) tabs." And: "if
 * 'open' but collapsed on mobile, I should have a way to see that and expand
 * the drawer."
 *
 * So below the breakpoint every host of the pane (the rail, the preview's own
 * host, the conversation's artifact column) draws this, and nothing else:
 *
 * - a drawer over the lower part of the chat, which stays underneath;
 * - with two or more entries open, a tab per entry, each with its own X
 *   (`closePreviewEntry`); a tab puts its entry on top (`showPreviewEntry`);
 * - the handle folds it (a tap, or a swipe down) to ONE bar above the
 *   composer — "Chart · 2 open" — that unfolds it again. Folding closes
 *   nothing: the URL, the entries and their order stay (`setPaneCollapsed`).
 *
 * The drawer has no state of its own: what is open is the URL and the stack
 * (`previewState.ts`), so the desktop column and this drawer are two shapes of
 * the same thing, and a rotate or a resize shows the same entries.
 */

import type { ReactNode } from 'react';
import { ChevronUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { describeRef } from '@/libs/preview/describeRef';
import { parsePreviewKey, previewKey } from '@/libs/preview/types';
import { RECORD_TYPES } from '@/services/chat/pageContext';
import { cn } from '@/utils/Helpers';
import { closePreviewEntry, previewTitle, setPaneCollapsed, showPreviewEntry, useOpenPreviewRef, usePaneCollapsed, usePreviewStack } from './previewState';

/** A swipe down this far on the handle folds the drawer. */
const FOLD_DISTANCE = 48;

/** Air between the folded bar and the composer under it. */
const GAP = 8;

function isRecordType(s: string): s is (typeof RECORD_TYPES)[number] {
  return (RECORD_TYPES as readonly string[]).includes(s);
}

/**
 * What an entry is called on its tab: the title its pane read, or what the
 * ref says it is ("Artifact #12") before that.
 * @param key - Its `<type>:<id>`.
 */
export function entryLabel(key: string): string {
  const read = previewTitle(key);
  if (read) {
    return read;
  }
  const ref = parsePreviewKey(key, isRecordType);
  return ref ? describeRef(ref).label : key;
}

/**
 * The folded bar's words: the entry on top, and how many are open when more than one.
 * @param top - The entry on top.
 * @param count - How many entries are open.
 */
export function peekLabel(top: string, count: number): string {
  return count > 1 ? `${top} · ${count} open` : top;
}

/**
 * How far above the bottom of `host` the folded bar sits so it clears the
 * chat composer, measured; 8px when the page has no composer.
 * @param host - The element the bar is positioned in, or null for the viewport.
 * @param active - Measure only while folded.
 */
function useComposerClearance(host: HTMLElement | null, active: boolean): number {
  const [clearance, setClearance] = useState(GAP);
  useEffect(() => {
    if (!active) {
      return;
    }
    const box = document.querySelector('[data-agent-composer]')?.closest('form') ?? null;
    const measure = () => {
      if (!box) {
        setClearance(GAP);
        return;
      }
      const bottom = host ? host.getBoundingClientRect().bottom : window.innerHeight;
      setClearance(Math.max(GAP, Math.round(bottom - box.getBoundingClientRect().top + GAP)));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (box) {
      ro?.observe(box);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [host, active]);
  return clearance;
}

/**
 * @param props - The drawer.
 * @param props.children - The pane for the entry on top.
 * @param props.position - `absolute` inside a host that holds the chat (the rail's sheet, the conversation); `fixed` over the page (the preview's own host).
 * @param props.className - Extra classes.
 */
export function PaneDrawer({ children, position = 'absolute', className }: { children: ReactNode; position?: 'absolute' | 'fixed'; className?: string }) {
  const open = useOpenPreviewRef();
  const stack = usePreviewStack();
  const collapsed = usePaneCollapsed();
  const rootRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  // Where the folded bar is measured from: the host it sits in, or the viewport.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setHost(position === 'absolute' ? (rootRef.current?.offsetParent as HTMLElement | null) ?? null : null);
  }, [position, collapsed]);
  const clearance = useComposerClearance(host, collapsed);
  const drag = useRef<number | null>(null);

  // A host may hand in a pane the URL does not name (a story, a test): it is
  // then one entry with no tabs, and the bar calls it what its region is.
  const top = open ? previewKey(open) : null;
  const entries = top ? [...stack.filter(k => k !== top), top] : [];
  const place = position === 'fixed' ? 'fixed' : 'absolute';
  const topLabel = top ? entryLabel(top) : 'Preview';

  if (!top && (children === null || children === undefined || children === false)) {
    return null;
  }

  if (collapsed) {
    return (
      <div ref={rootRef} className={cn(place, 'inset-x-3 z-20', className)} style={{ bottom: clearance }}>
        <button
          type="button"
          onClick={() => setPaneCollapsed(false)}
          data-testid="pane-peek"
          aria-expanded={false}
          aria-label={`Show ${peekLabel(topLabel, entries.length)}`}
          className="flex h-11 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-left text-[13px] shadow-(--shadow-pop)"
        >
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{peekLabel(topLabel, entries.length)}</span>
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Preview"
      data-testid="preview-drawer"
      className={cn(place, 'inset-x-0 bottom-0 z-20 flex h-[70%] min-h-0 flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-(--shadow-pop)', position === 'fixed' && 'h-[70dvh]', className)}
    >
      {/* The handle: a tap folds the drawer, and so does a swipe down. Only
          a pane the URL names folds: the bar has to say what it is. */}
      {top && (
        <button
          type="button"
          onClick={() => setPaneCollapsed(true)}
          onPointerDown={(e) => {
            drag.current = e.clientY;
          }}
          onPointerUp={(e) => {
            const from = drag.current;
            drag.current = null;
            if (from !== null && e.clientY - from > FOLD_DISTANCE) {
              setPaneCollapsed(true);
            }
          }}
          data-testid="pane-handle"
          aria-expanded
          aria-label="Fold the preview"
          className="flex h-5 w-full shrink-0 touch-none items-center justify-center"
        >
          <span className="h-1 w-9 rounded-full bg-border" aria-hidden />
        </button>
      )}
      {entries.length > 1 && (
        <div role="tablist" aria-label="Open in the pane" data-testid="pane-tabs" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 pb-1.5">
          {entries.map((key) => {
            const label = entryLabel(key);
            const selected = key === top;
            return (
              <div key={key} className={cn('flex max-w-[60%] min-w-0 shrink-0 items-center rounded-lg border text-[12.5px]', selected ? 'border-border bg-card text-foreground' : 'border-transparent text-muted-foreground')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    if (!selected) {
                      showPreviewEntry(key);
                    }
                  }}
                  data-testid="pane-tab"
                  data-pane-key={key}
                  className="min-h-9 min-w-0 truncate py-1 pr-1 pl-2.5 text-left"
                >
                  {label}
                </button>
                <button
                  type="button"
                  onClick={() => closePreviewEntry(key)}
                  data-testid="pane-tab-close"
                  aria-label={`Close ${label}`}
                  className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-surface-hover"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
