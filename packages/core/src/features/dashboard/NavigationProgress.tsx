'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { beginNavigation, endNavigation, isInAppNavigation, NAVIGATION_STALE_MS, navigationPending, subscribeNavigation } from './navigationInFlight';

/**
 * The thin bar along the top edge that says a page is on its way.
 *
 * One component, mounted once in the shell bar, drawn for every navigation
 * however it started: a link anywhere in the document (the bar listens for
 * the click), or code that called `beginNavigation()`. It ends when the
 * pathname or query lands, and gives up after `NAVIGATION_STALE_MS` so a
 * navigation that never resolves does not leave a bar creeping forever.
 *
 * Chris, on his phone, 2026-09-24: "I keep clicking and wondering what's
 * happening." A skeleton answers that once the new segment starts rendering;
 * this answers it at the tap, before anything else has moved (backlog 013).
 *
 * Quiet by design: 2px, the brand amber, an ease-out sweep that stalls near
 * the end until the page lands and then completes and fades. No spinner, no
 * words. Reduced motion keeps the bar and drops the sweep.
 */
export function NavigationProgress() {
  const pending = useSyncExternalStore(subscribeNavigation, navigationPending, () => false);
  const pathname = usePathname();
  const search = useSearchParams();
  const searchKey = search?.toString() ?? '';
  const landed = useRef(`${pathname}?${searchKey}`);

  // A click on an in-app link begins it, wherever the link is.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) {
        return;
      }
      if (isInAppNavigation(anchor, event, window.location)) {
        beginNavigation();
      }
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);

  // The page landed: the URL changed under us.
  useEffect(() => {
    const now = `${pathname}?${searchKey}`;
    if (now !== landed.current) {
      landed.current = now;
      endNavigation();
    }
  }, [pathname, searchKey]);

  // A navigation that never lands is not reported forever.
  useEffect(() => {
    if (!pending) {
      return;
    }
    const timer = setTimeout(endNavigation, NAVIGATION_STALE_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-hidden={!pending}
      data-testid="navigation-progress"
      data-state={pending ? 'active' : 'idle'}
      className="nav-progress pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5"
    >
      <div className="nav-progress-bar h-full bg-brand-amber" />
    </div>
  );
}
