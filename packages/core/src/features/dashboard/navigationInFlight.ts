/**
 * The one record of "a navigation is in flight" — what the top progress bar
 * draws and what anything that starts a navigation by hand reports to.
 *
 * Next has no global navigation event. A `<Link>` knows its own transition
 * (`useLinkStatus`), and that is what the sidebar's icons and the cards read;
 * but the person's question on a phone is about the PAGE — "did my tap do
 * anything?" — and the answer has to be in one place whatever was tapped.
 * So: a click on any in-app link begins it (the bar listens at the document),
 * a row that navigates in code calls `beginNavigation()` itself, and the
 * pathname changing ends it. A navigation that never lands (a download, a
 * cancelled fetch, a link that turned out to be external) is timed out rather
 * than left running.
 *
 * Pure module: no React, no DOM, so the rule is unit-tested as a rule.
 */

let inFlight = 0;
let listeners: Array<() => void> = [];

/** How long a navigation may run before the bar stops claiming it (ms). */
export const NAVIGATION_STALE_MS = 12_000;

function emit() {
  for (const l of listeners) {
    l();
  }
}

/** Whether a navigation is in flight right now. */
export function navigationPending(): boolean {
  return inFlight > 0;
}

/**
 * Starts one navigation. Call it where a navigation is started in code (a row
 * that `router.push`es); link clicks are picked up at the document.
 */
export function beginNavigation(): void {
  inFlight += 1;
  emit();
}

/** Ends every in-flight navigation — the page landed (or the bar gave up). */
export function endNavigation(): void {
  if (inFlight === 0) {
    return;
  }
  inFlight = 0;
  emit();
}

/**
 * Subscribes to changes; the shape `useSyncExternalStore` wants.
 * @param listener - Called on every begin and end.
 * @returns Unsubscribe.
 */
export function subscribeNavigation(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

/**
 * Whether a click on an anchor is a navigation THIS document will make — as
 * opposed to a new tab, a download, a hash jump, another origin, or the
 * page it is already on. The bar starts only for those; the rest never
 * land on a new pathname, so they would never end.
 * @param anchor - The anchor the click reached.
 * @param anchor.href
 * @param anchor.target
 * @param anchor.hasAttribute
 * @param event - The click's modifiers and button.
 * @param event.metaKey
 * @param event.ctrlKey
 * @param event.shiftKey
 * @param event.altKey
 * @param event.button
 * @param event.defaultPrevented
 * @param current - Where the document is now (`location`).
 * @param current.origin
 * @param current.pathname
 * @param current.search
 */
export function isInAppNavigation(
  anchor: { href: string; target: string; hasAttribute: (name: string) => boolean },
  event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number; defaultPrevented: boolean },
  current: { origin: string; pathname: string; search: string },
): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(anchor.href, current.origin);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) {
    return false;
  }
  // Same page: a hash jump or a re-tap of the current tab — nothing to wait for.
  return url.pathname !== current.pathname || url.search !== current.search;
}
