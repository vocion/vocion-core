/**
 * A PERSON CLICKS, A SCRIPT TELEPORTS (Chris, 2026-10-05: "I want to see what it looks like
 * when someone is actually using it. The recording is just jumping from screen to screen like
 * a magic non human script."). When a demo moves to another page and a link to it is on the
 * screen, the demo clicks that link; it jumps straight to the address only when nothing on
 * screen leads there. This is the one reading of "which link leads there", shared with the
 * runner's copy in `packages/runner/src/qa.mjs`.
 */

function pathOf(url: URL): string {
  return `${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;
}

/**
 * The href on the page that leads to the target, or null. A link counts when it resolves (from
 * the page it is on) to the target's path and query, on the same origin; the hash is ignored.
 * The first such href wins — the page's own order, which is reading order.
 * @param hrefs - The `href` attributes on the page, as written.
 * @param pageUrl - The page they are on.
 * @param target - Where the demo wants to go, absolute.
 */
export function hrefLeadingTo(hrefs: readonly (string | null | undefined)[], pageUrl: string, target: string): string | null {
  let want: URL;
  let here: URL;
  try {
    want = new URL(target);
    here = new URL(pageUrl);
  } catch {
    return null;
  }
  if (want.origin !== here.origin) {
    return null;
  }
  const wanted = pathOf(want);
  for (const href of hrefs) {
    if (typeof href !== 'string' || !href.trim() || /^(?:javascript|mailto|tel):/i.test(href)) {
      continue;
    }
    try {
      const u = new URL(href, pageUrl);
      if (u.origin === want.origin && pathOf(u) === wanted) {
        return href;
      }
    } catch {
      // not a URL
    }
  }
  return null;
}

/** How a person pauses: a look at a page before acting, and a breath after each action. */
export const HUMAN_BEATS = { afterNavigationMs: 700, afterActionMs: 350, keystrokeMs: 55 } as const;
