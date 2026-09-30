'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * WHERE THE PERSON CAME FROM, inside the app (Chris, 2026-09-30, on #269:
 * pressing Merge on the merge card took him on to the next recommendation —
 * "I would have liked if this went back to our work page").
 *
 * A decision page walks a queue for a person who is working the queue; for a
 * person who opened one card from somewhere else — the Work page, a feature
 * page, a chat link — deciding it is the end of the errand, and they go back
 * to where they were. This remembers the page before the current one, as the
 * browser shows it (path and query), for the one client-side session of the
 * tab. A page opened fresh (a new tab, a link from GitHub) came from nowhere
 * in the app, and its decision walks the queue as before.
 */

let current: string | null = null;
let previous: string | null = null;

/**
 * Record each page the person lands on. Mounted once, in the app shell.
 */
export function NavigationTrail(): null {
  const pathname = usePathname();
  useEffect(() => {
    visited(`${window.location.pathname}${window.location.search}`);
  }, [pathname]);
  return null;
}

/**
 * Note a page as the current one; the one before it becomes where the person
 * came from. The same page again (a query change, a refresh) moves nothing.
 * @param url - The page, path and query.
 */
export function visited(url: string): void {
  const path = url.split('?')[0];
  if (current !== null && current.split('?')[0] === path) {
    current = url;
    return;
  }
  previous = current;
  current = url;
}

/** The in-app page the person was on before this one, or null. */
export function cameFrom(): string | null {
  return previous;
}

/** Tests: forget the trail. */
export function resetTrailForTests(): void {
  current = null;
  previous = null;
}
