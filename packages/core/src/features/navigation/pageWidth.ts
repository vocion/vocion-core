/**
 * How much of the window a page is allowed to use.
 *
 * The shell caps every page at a reading width, because prose that runs the
 * whole of a 27" monitor is unreadable — that cap is right for a list, a
 * detail page, a settings form, anything a person READS. It is wrong for the
 * pages that are a two-pane WORKING surface, where a document sits beside a
 * conversation and every pixel of width makes the document more legible
 * (Chris, 2026-09-18, on `/dashboard/chat/132?artifact=251` in a 1990px
 * window: *"this should be full width / better use of the space"* — the cap
 * was leaving ~450px of the window empty).
 *
 * So this is an OPT-OUT, not a removal: the cap stays the default and a route
 * declares itself full-bleed here. The declaration is a route rule rather than
 * a runtime context because the shell renders ABOVE the page — a page cannot
 * tell its own ancestor how wide to be without a state change after mount, and
 * that is a visible jump on every navigation. A pathname is known before the
 * first paint, on the server and the client alike.
 *
 * What the route does NOT decide is how the page then spends the width: the
 * conversation surface opens the whole window only while a pane is beside it,
 * and falls back to the same reading column when it is alone
 * (`features/dashboard/artifacts/ConversationSplit.tsx`). One decision per
 * owner — the shell answers "does this route need the window", the page
 * answers "what do I do with it".
 */

import { AllLocales } from '@/utils/AppConfig';

/** The reading-width cap, and the classes that apply it. One number, one place. */
export const PAGE_READING_MAX_WIDTH = 1180;
export const READING_WIDTH_CLASS = 'mx-auto w-full max-w-[1180px]';

/**
 * The full-bleed surfaces, as patterns over the dashboard path.
 *
 * Each is a two-pane working surface whose second pane is a rendered sheet:
 * a wider pane is a bigger, more readable document, not a longer line of
 * prose. A page is NOT listed just because it happens to be wide —
 * `/dashboard/rooms/[id]` (a Detail with a right column) and `/gtm/proposals`
 * (a List) are both read top-to-bottom and keep the cap.
 */
const FULL_BLEED_PATTERNS: readonly RegExp[] = [
  // One conversation beside ONE artifact (`?artifact=<id>`). The page itself
  // re-centres when no artifact is open.
  /^\/dashboard\/chat\/\d+$/,
  // One artifact on its own page — a table or a chart takes the window, and
  // `ArtifactPane` keeps a measure on the kinds that are prose.
  /^\/dashboard\/artifacts\/\d+$/,
];

/**
 * Deliberately NOT here, and both were measured before deciding (2026-09-19,
 * 1920px, rail collapsed):
 *
 * - `/dashboard/artifacts/<id>/open` — the document's own wrapper. Its iframe
 *   would go 1180px → 1584px, but the sheet inside it is `width: 8.5in;
 *   margin: 0 auto`, so those 404px arrive as grey either side of an
 *   identically-sized document. More window, not more document.
 * - `/dashboard/rooms/<id>` (a Detail with a right column) and `/gtm/proposals`
 *   (a List): read top to bottom, so the cap is doing its job.
 */

/**
 * The path with the things that are not the route stripped off: the locale
 * prefix next-intl adds for a non-default locale, the `/w/<workspace>` entry
 * prefix, a trailing slash and any query or hash a caller passed in whole.
 * @param pathname - `usePathname()`, or a full href.
 */
export function normalizePagePath(pathname: string): string {
  const path = (pathname || '/').split('?')[0]!.split('#')[0]!;
  const segments = path.split('/').filter(Boolean);
  if (segments.length > 0 && (AllLocales as readonly string[]).includes(segments[0]!)) {
    segments.shift();
  }
  // `/w/<slug>/dashboard/…` — the workspace-scoped form of every link
  // (`libs/links.ts`). The entry route redirects, but a link is a link.
  if (segments[0] === 'w' && segments.length > 1) {
    segments.splice(0, 2);
  }
  return `/${segments.join('/')}`;
}

/**
 * Whether this route is a full-bleed working surface — the shell drops its
 * reading-width cap for it.
 * @param pathname - `usePathname()`.
 */
export function isFullBleedPath(pathname: string): boolean {
  const path = normalizePagePath(pathname);
  return FULL_BLEED_PATTERNS.some(re => re.test(path));
}
