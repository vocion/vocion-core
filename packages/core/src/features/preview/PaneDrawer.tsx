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
 * - a drawer over the lower part of the chat, which stays underneath. It
 *   rests at three heights (`drawerSnap.ts`): folded to its bar, half the
 *   screen, and the whole screen (Chris, 2026-10-24: "I can't drag drawer full
 *   height"). The handle, the tabs and the pane's own header drag it; the
 *   content drags it too when it is scrolled to its top, and scrolls
 *   otherwise. A tap on the handle steps it: half → full → folded;
 * - with two or more entries open, a tab per entry, each with its own X
 *   (`closePreviewEntry`), in the order they were opened (`tabsInOrder`):
 *   picking a tab puts its entry on top and moves no tab (2026-10-24:
 *   "Switching active drawer tab changes tab order and moves what I clicked
 *   on"). The active tab is scrolled into view, never cut off;
 * - folded, ONE bar above the composer — "Chart · 2 open" — with its own grab
 *   handle: a tap or a drag up opens it again (2026-10-24: "When closed I lose
 *   the drag handle that opens it"). Folding closes nothing: the URL, the
 *   entries and their order stay (`setPaneCollapsed`). The bar is there while
 *   anything is open; only the last X removes it.
 *
 * What is open is the URL and the stack (`previewState.ts`), so the desktop
 * column and this drawer are two shapes of the same thing, and a rotate or a
 * resize shows the same entries. Only the height it rests at is the drawer's.
 */

import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { DrawerSnap } from './drawerSnap';
import { ChevronUp, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { describeRef } from '@/libs/preview/describeRef';
import { parsePreviewKey, previewKey } from '@/libs/preview/types';
import { RECORD_TYPES } from '@/services/chat/pageContext';
import { cn } from '@/utils/Helpers';
import { clampHeight, FULL_GAP, nextSnap, PEEK_HEIGHT, resolveSnap, snapHeights } from './drawerSnap';
import { closePreviewEntry, previewTitle, setPaneCollapsed, showPreviewEntry, tabsInOrder, useOpenPreviewRef, usePaneCollapsed, usePaneOrder, usePreviewStack } from './previewState';

/** Air between the folded bar and the composer under it. */
const GAP = 8;

/** How far a finger moves before the drawer decides it is a drag, px. */
const SLOP = 6;

/** A finger still this long before it lifts let go without a flick, ms. */
const PAUSE_MS = 90;

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
 * The element the drawer is laid out in: its positioned parent when it is
 * `absolute`, the viewport (null) when it is `fixed`.
 * @param root - The drawer.
 * @param position - How it is positioned.
 */
function hostOf(root: HTMLElement, position: 'absolute' | 'fixed'): HTMLElement | null {
  return position === 'absolute' ? (root.offsetParent as HTMLElement | null) : null;
}

/**
 * How tall the drawer's host is, px, kept current: 0 until measured.
 * @param root - The drawer.
 * @param position - How it is positioned.
 */
function useHostHeight(root: HTMLElement | null, position: 'absolute' | 'fixed'): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!root) {
      return;
    }
    const host = hostOf(root, position);
    const measure = () => setHeight(host ? host.clientHeight : window.innerHeight);
    measure();
    const ro = host && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (host) {
      ro?.observe(host);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [root, position]);
  return height;
}

/**
 * How far above the bottom of the host the folded bar sits so it clears the
 * chat composer; 8px when the page has no composer.
 *
 * Measured afresh on every change that can move the composer, and never
 * further up than the host has room for. It used to read the composer once,
 * on folding, and follow only that element's size: a composer that moved
 * without resizing (a card docked above it, the keyboard, a turn starting) or
 * was drawn again left the bar where the old one had been — behind the new
 * one, or, reading a detached element's top of 0, above the top of the
 * screen (2026-10-24: "Gone and I can't re open it").
 * @param root - The bar's wrapper.
 * @param position - How it is positioned.
 * @param active - Measure only while folded.
 */
function useComposerClearance(root: HTMLElement | null, position: 'absolute' | 'fixed', active: boolean): number {
  const [clearance, setClearance] = useState(GAP);
  useLayoutEffect(() => {
    if (!active || !root) {
      return;
    }
    const host = hostOf(root, position);
    const measure = () => {
      const box = document.querySelector('[data-agent-composer]')?.closest('form') ?? null;
      const bottom = host ? host.getBoundingClientRect().bottom : window.innerHeight;
      const room = (host ? host.clientHeight : window.innerHeight) - PEEK_HEIGHT - GAP;
      const raw = box && box.isConnected ? Math.round(bottom - box.getBoundingClientRect().top + GAP) : GAP;
      setClearance(Math.max(GAP, Math.min(raw, Math.max(GAP, room))));
    };
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon);
    const box = document.querySelector('[data-agent-composer]')?.closest('form');
    if (box) {
      ro?.observe(box);
    }
    if (host) {
      ro?.observe(host);
    }
    // The composer can move, or be drawn again, without resizing.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(soon);
    mo?.observe(host ?? document.body, { childList: true, subtree: true });
    const vv = window.visualViewport;
    window.addEventListener('resize', soon);
    vv?.addEventListener('resize', soon);
    vv?.addEventListener('scroll', soon);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', soon);
      vv?.removeEventListener('resize', soon);
      vv?.removeEventListener('scroll', soon);
    };
  }, [root, position, active]);
  return clearance;
}

/**
 * The nearest element between `el` and `root` that scrolls vertically, if any.
 * @param el - Where the finger came down.
 * @param root - The drawer.
 */
function scrollerWithin(el: Element | null, root: Element): HTMLElement | null {
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight) {
      const overflow = getComputedStyle(n).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') {
        return n;
      }
    }
  }
  return null;
}

type Gesture = {
  x0: number;
  y0: number;
  /** The drawer's height when the finger came down. */
  h0: number;
  /** On the handle, the tabs or the bar (always the drawer's), or on the content. */
  grab: boolean;
  scroller: HTMLElement | null;
  decided: null | 'drag' | 'none';
  y: number;
  t: number;
  /** px/ms, positive downward. */
  vy: number;
};

/**
 * The drawer's drag: a finger (touch events, so a drag can stop the page
 * scrolling under it on iOS) or a mouse or pen (pointer events), on the
 * drawer `root`.
 * @param root - The drawer.
 * @param opts - What it needs.
 * @param opts.height - Its height now, px.
 * @param opts.snap - Where it rests now.
 * @param opts.heights - The rests.
 * @param opts.onLive - The height while a drag is under way; null when it ends.
 * @param opts.onSettle - Where a drag let go of it.
 * @returns Whether a click that ends a drag should be swallowed.
 */
function useDrawerDrag(root: HTMLElement | null, opts: { height: number; snap: DrawerSnap; heights: Record<DrawerSnap, number>; onLive: (h: number | null) => void; onSettle: (s: DrawerSnap) => void }): RefObject<boolean> {
  const latest = useRef(opts);
  useLayoutEffect(() => {
    latest.current = opts;
  });
  const swallowClick = useRef(false);

  useEffect(() => {
    if (!root) {
      return;
    }
    let g: Gesture | null = null;

    const begin = (x: number, y: number, target: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      const grab = Boolean(el?.closest('[data-drawer-grab]'));
      g = { x0: x, y0: y, h0: latest.current.height, grab, scroller: grab ? null : scrollerWithin(el, root), decided: null, y, t: performance.now(), vy: 0 };
    };
    // True while the finger is dragging the drawer (the caller stops the page scrolling).
    const track = (x: number, y: number): boolean => {
      if (!g) {
        return false;
      }
      const dx = x - g.x0;
      const dy = y - g.y0;
      if (g.decided === null) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
          return false;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          g.decided = 'none';
        } else if (g.grab) {
          g.decided = 'drag';
        } else {
          const atTop = !g.scroller || g.scroller.scrollTop <= 0;
          // Full: only pulling down from the top moves it; the rest scrolls.
          // Lower: pulling up opens it first; down moves it from the top.
          g.decided = (latest.current.snap === 'full' ? dy > 0 && atTop : dy < 0 || atTop) ? 'drag' : 'none';
        }
      }
      if (g.decided !== 'drag') {
        return false;
      }
      // The speed follows the finger's moves; a lift where it already is adds none.
      if (y !== g.y) {
        const now = performance.now();
        const step = (y - g.y) / Math.max(1, now - g.t);
        g.vy = g.vy === 0 ? step : 0.7 * step + 0.3 * g.vy;
        g.y = y;
        g.t = now;
      }
      latest.current.onLive(clampHeight(g.h0 - dy, latest.current.heights));
      return true;
    };
    const finish = (x: number, y: number) => {
      const gesture = g;
      if (!gesture) {
        return;
      }
      // A finger that stopped before it lifted throws nothing.
      const paused = performance.now() - gesture.t > PAUSE_MS;
      // A swipe fast enough to send no move still counts.
      track(x, y);
      if (paused && gesture.y === y) {
        gesture.vy = 0;
      }
      g = null;
      if (gesture.decided !== 'drag') {
        return;
      }
      swallowClick.current = true;
      setTimeout(() => {
        swallowClick.current = false;
      }, 0);
      const h = clampHeight(gesture.h0 - (y - gesture.y0), latest.current.heights);
      latest.current.onSettle(resolveSnap(h, gesture.vy, latest.current.heights));
    };
    const cancel = () => {
      if (g?.decided === 'drag') {
        latest.current.onLive(null);
      }
      g = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length === 1 && t) {
        begin(t.clientX, t.clientY, e.target);
      } else {
        cancel();
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && track(t.clientX, t.clientY) && e.cancelable) {
        e.preventDefault();
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) {
        finish(t.clientX, t.clientY);
      } else {
        cancel();
      }
    };
    // A finger is the touch events' to follow; pointer events take the mouse and the pen.
    const onPointerMove = (e: PointerEvent) => {
      track(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      finish(e.clientX, e.clientY);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button > 0) {
        return;
      }
      begin(e.clientX, e.clientY, e.target);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd);
    root.addEventListener('touchcancel', cancel);
    root.addEventListener('pointerdown', onPointerDown);
    return () => {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', cancel);
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [root]);

  return swallowClick;
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
  const order = usePaneOrder();
  const collapsed = usePaneCollapsed();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  // Where it rests when open; folded is the shared `collapsed`, so anything
  // newly opened unfolds it wherever it was opened from.
  const [expanded, setExpanded] = useState<Exclude<DrawerSnap, 'peek'>>('half');
  const [live, setLive] = useState<number | null>(null);
  const hostHeight = useHostHeight(root, position);
  const heights = snapHeights(hostHeight);
  const folded = collapsed && live === null;
  const clearance = useComposerClearance(root, position, folded);
  const snap: DrawerSnap = collapsed ? 'peek' : expanded;
  const height = live ?? heights[snap];

  const settle = useCallback((next: DrawerSnap) => {
    setLive(null);
    if (next === 'peek') {
      setPaneCollapsed(true);
      return;
    }
    setExpanded(next);
    setPaneCollapsed(false);
  }, []);
  const swallowClick = useDrawerDrag(root, { height, snap, heights, onLive: setLive, onSettle: settle });

  // A host may hand in a pane the URL does not name (a story, a test): it is
  // then one entry with no tabs, and the bar calls it what its region is.
  const top = open ? previewKey(open) : null;
  const tabs = top ? tabsInOrder(order, [...stack, top]) : [];
  const place = position === 'fixed' ? 'fixed' : 'absolute';
  const topLabel = top ? entryLabel(top) : 'Preview';

  // The tab picked stays where it is, and is scrolled into view.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [top, tabs.length, folded]);

  if (!top && (children === null || children === undefined || children === false)) {
    return null;
  }

  const onClickCapture = (e: MouseEvent) => {
    if (swallowClick.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const next = nextSnap(snap);
  const measured = hostHeight > 0;
  const label = peekLabel(topLabel, tabs.length);
  // ONE element whether folded or open, and ONE grab button first in it, so
  // a finger that drags the bar up keeps hold of the drawer it becomes.
  const grab = (top || folded) && (
    <button
      key="grab"
      type="button"
      onClick={() => settle(folded ? expanded : next)}
      data-testid={folded ? 'pane-peek' : 'pane-handle'}
      data-drawer-grab
      aria-expanded={!folded}
      aria-label={folded ? `Show ${label}` : next === 'full' ? 'Expand the preview to full height' : next === 'peek' ? 'Fold the preview' : 'Show the preview at half height'}
      className={folded
        ? 'flex w-full touch-none flex-col rounded-xl border border-border bg-card px-3 pt-1.5 pb-2.5 text-left text-[13px] shadow-(--shadow-pop)'
        : 'flex h-6 w-full shrink-0 touch-none items-center justify-center'}
      style={folded ? { minHeight: PEEK_HEIGHT - GAP } : undefined}
    >
      <span className={cn('h-1 w-9 shrink-0 rounded-full bg-border', folded && 'mx-auto mb-1.5')} aria-hidden data-testid={folded ? 'pane-peek-handle' : undefined} />
      {folded && (
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{label}</span>
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </span>
      )}
    </button>
  );

  return (
    <div
      ref={setRoot}
      onClickCapture={onClickCapture}
      {...(folded ? {} : { 'role': 'region', 'aria-label': 'Preview', 'data-testid': 'preview-drawer' })}
      data-drawer-snap={folded ? 'peek' : live !== null ? 'dragging' : snap}
      className={cn(
        place,
        'z-30',
        folded
          ? 'inset-x-3'
          : 'inset-x-0 bottom-0 flex min-h-0 flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-(--shadow-pop)',
        !folded && live === null && 'transition-[height] duration-200 ease-out motion-reduce:transition-none',
        !folded && !measured && (position === 'fixed' ? 'h-[70dvh]' : 'h-[70%]'),
        className,
      )}
      style={folded
        ? { bottom: clearance }
        : {
            ...(measured ? { height } : {}),
            // Never under the status bar, whatever the host measured.
            maxHeight: position === 'fixed' ? `calc(100dvh - env(safe-area-inset-top) - ${FULL_GAP}px)` : `calc(100% - ${FULL_GAP}px)`,
          }}
    >
      {/* The grab: folded, the bar ("Chart · 2 open"), tapped or dragged up to
          open; open, the handle, dragged anywhere between the bar and the
          top, a tap stepping half → full → folded. Only a pane the URL names
          has one: the bar has to say what it is. */}
      {grab}
      {!folded && tabs.length > 1 && (
        <div
          ref={strip}
          role="tablist"
          aria-label="Open in the pane"
          data-testid="pane-tabs"
          data-drawer-grab
          className="flex shrink-0 touch-pan-x scroll-px-2 gap-1 overflow-x-auto overscroll-x-contain border-b border-border px-2 pb-1.5"
        >
          {tabs.map((key) => {
            const name = entryLabel(key);
            const selected = key === top;
            return (
              <div key={key} className={cn('flex max-w-[70%] min-w-0 shrink-0 items-center rounded-lg border text-[12.5px]', selected ? 'border-border bg-card text-foreground' : 'border-transparent text-muted-foreground')}>
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
                  {name}
                </button>
                <button
                  type="button"
                  onClick={() => closePreviewEntry(key)}
                  data-testid="pane-tab-close"
                  aria-label={`Close ${name}`}
                  className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-surface-hover"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {!folded && <div className="flex min-h-0 flex-1 flex-col overscroll-contain">{children}</div>}
    </div>
  );
}
