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

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isFullBleedPath, isViewportFitPath, READING_WIDTH_CLASS } from '@/features/navigation/pageWidth';
import { cn } from '@/utils/Helpers';

/** The page gutter (B-034b §3): 24px → 40px, 32px vertical. */
const GUTTER = '@container min-w-0 flex-1 px-4 py-6 pr-[calc(1rem+var(--rail-inset,0px))] transition-[padding] duration-200 sm:px-6 sm:pr-[calc(1.5rem+var(--rail-inset,0px))] lg:px-10 lg:py-8 lg:pr-[calc(2.5rem+var(--rail-inset,0px))]';

export function PageWidth(props: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const full = isFullBleedPath(pathname);
  const fit = isViewportFitPath(pathname) ? 'viewport' : 'reading';
  const gutter = useRef<HTMLDivElement>(null);

  // What window scrolling gave us for nothing: a new page starts at the top.
  useEffect(() => {
    gutter.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div
      ref={gutter}
      data-page-gutter={fit}
      className={cn(GUTTER, fit === 'viewport' ? 'flex min-h-0 flex-col overflow-hidden' : 'overflow-y-auto')}
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
