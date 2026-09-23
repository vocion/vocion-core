import type { InboxSort, InboxTab } from '@/services/inbox/kinds';

/**
 * Merging a patch into a query string, without a stale snapshot.
 *
 * `useSearchParams()` hands back a value captured at RENDER. Any write that
 * fires later from a closure — a debounce, a timeout, an async handler —
 * rebuilds the URL from that older snapshot and silently drops everything that
 * changed in between.
 *
 * That is not hypothetical. Selecting a filter token clears the field's text,
 * which calls the search handler, which schedules a debounced write 300ms
 * later from the snapshot taken BEFORE the token existed. The filter appeared
 * in the URL and then reverted a third of a second later, which is exactly
 * what a person sees as "it flashed and went away".
 *
 * So the merge takes the CURRENT query string as an argument and the caller
 * reads it at call time. Pure, so the race is a test rather than a bug report.
 */

/**
 * @param current - The query string as it is right now (`window.location.search`).
 * @param patch - Keys to set; `null` or `''` removes the key.
 * @returns The merged query string, without a leading `?`.
 */
export function mergeSearch(current: string, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') {
      next.delete(k);
    } else {
      next.set(k, v);
    }
  }
  return next.toString();
}

/**
 * The sort a tab opens on when the URL names none: a queue is read oldest
 * first, a record of decisions newest first. ONE definition, read by the page
 * (to sort) and by the controls (to know which choice to leave out of the
 * URL). They disagreed once: the controls stripped "newest" as the default
 * while the open tab's page default was "oldest", so choosing newest on the
 * open queue wrote nothing and the select snapped back (Valerie, 2026-09-23,
 * with the enroll filter on).
 * @param tab - The inbox tab.
 */
export function defaultSortFor(tab: InboxTab): InboxSort {
  return tab === 'decided' ? 'newest' : 'oldest';
}
