'use client';

/**
 * How much of the window a page gets — the width cap, and who scrolls.
 *
 * The rule itself is pure and lives beside the nav registry
 * (`features/navigation/pageWidth.ts`); this is the seam that applies it, and
 * it is a client component for one reason: a server layout is not told which
 * page is rendering inside it, and the pathname is. `usePathname` is resolved
 * on the server render too, so there is no flash — the frame is right on the
 * first paint, including the first paint after a client navigation.
 *
 * **The window never scrolls.** The shell is exactly the viewport tall and the
 * page gutter is the scroller, so the sidebar, the top bar and every pane
 * header stay put. Before this, the shell was `min-h-svh` and each working
 * surface guessed at the chrome above it (`h-[calc(100vh-6rem)]` against 8rem
 * of real chrome), which put a third scrollbar on the window and carried the
 * whole shell with it (Chris, 2026-09-18: *"scroll in scroll bug for chat /
 * overall window too"*). A guess is now impossible: `h-full` is the height the
 * shell measured.
 *
 * Two shapes, decided by the route:
 *
 * - **`reading` / default** — the page is read top to bottom. It is capped at
 *   a reading width and the gutter scrolls it. ONE scroller.
 * - **`viewport`** — a two-pane working surface. The gutter is a flex column
 *   that does not scroll; the page fills it with `h-full` and the scrolling
 *   happens inside its panes. ONE scroller per column.
 *
 * The gutter resets to the top on a navigation, which the window used to do
 * for free.
 */

import { useEffect, useRef } from 'react';
import { isFullBleedPath, isViewportFitPath, READING_WIDTH_CLASS } from '@/features/navigation/pageWidth';
import { usePathname } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * The page gutter (B-034b §3): 24px → 40px, 32px vertical.
 *
 * With ONE exception at the bottom: a page carrying a sticky decision bar
 * gives up the gutter's bottom padding. A sticky box is constrained to its
 * scroller's CONTENT box, so that padding is a strip the bar can never reach
 * — measured at 24px in both Chromium and WebKit, at every scroll position —
 * and the page's own content scrolls through it under the stuck bar. On a
 * phone that reads as a decision bar floating a finger's width off the bottom
 * with the content sliding past beneath it (Chris, 2026-09-19: *"the action
 * bar isn't fixed to the bottom"*). The bar carries its own bottom padding
 * and the safe-area inset, so nothing is lost by dropping the gutter's.
 */
const GUTTER = '@container min-w-0 flex-1 px-4 pt-6 pb-6 pr-[calc(1rem+var(--rail-inset,0px))] transition-[padding] duration-200 has-[[data-pattern=sticky-action-bar]]:pb-0 sm:px-6 sm:pr-[calc(1.5rem+var(--rail-inset,0px))] lg:px-10 lg:pt-8 lg:pb-8 lg:pr-[calc(2.5rem+var(--rail-inset,0px))]';

export function PageWidth(props: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const full = isFullBleedPath(pathname);
  const fit = isViewportFitPath(pathname) ? 'viewport' : 'reading';
  const gutter = useRef<HTMLDivElement>(null);

  // What window scrolling gave us for nothing: a new page starts at the top.
  useEffect(() => {
    gutter.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // A viewport-fit page is an app screen, not a document: the header and the
  // composer stay put and only the transcript scrolls. Below `md` the
  // document is otherwise the scroller, so on a phone the whole shell could
  // be dragged and rubber-banded — header off the top, composer floating mid
  // screen (Chris, 2026-09-25: "Should I be able to drag around the header
  // and compose bar on mobile?"). The lock lives on <html> for exactly as
  // long as such a page is mounted (`global.css`, `html[data-viewport-fit]`).
  useEffect(() => {
    if (fit !== 'viewport') {
      return;
    }
    const root = document.documentElement;
    root.dataset.viewportFit = '';
    window.scrollTo({ top: 0 });
    return () => {
      delete root.dataset.viewportFit;
    };
  }, [fit]);

  return (
    <div
      ref={gutter}
      data-page-gutter={fit}
      // Below `md` the DOCUMENT scrolls (see AppShell), so a reading page must
      // not open a scroller of its own — two scrollers is the bug this file
      // exists to have fixed. A viewport-fit route (a two-pane working
      // surface, chat) still bounds itself to the screen at every width:
      // scrolling the window through a chat transcript is not a page, and a
      // full-page capture of one would be meaningless anyway. `dvh`, not `svh`:
      // with the document locked, the pane must follow Safari's toolbar as it
      // collapses, or a strip of nothing opens under the composer. `60px` is the
      // top bar's own height (`AppSidebarHeader`, `h-[60px]`) — below `md` the
      // shell no longer bounds its children, so the pane subtracts the chrome
      // above it itself or the composer lands under the fold.
      className={cn(
        GUTTER,
        fit === 'viewport'
          ? 'flex h-[calc(100dvh-60px)] min-h-0 flex-col overflow-hidden md:h-auto'
          : 'md:overflow-y-auto',
      )}
    >
      {/* Deliberately the same plain block box it has always been, minus the
          cap: every dashboard page lays itself out inside this, and turning
          the wrapper into a flex container would quietly re-flow all of them.
          A viewport-fit route is the exception it opted into. */}
      <div
        data-page-width={full ? 'full' : 'reading'}
        className={cn(full ? 'w-full' : READING_WIDTH_CLASS, fit === 'viewport' && 'flex min-h-0 flex-1 flex-col')}
      >
        {props.children}
      </div>
    </div>
  );
}
