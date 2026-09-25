import { ListSkeleton } from '@/components/patterns/Skeletons';

/**
 * The workspace pages' loading state — Work, Products, Performance, Activity.
 *
 * Next holds the OLD page on screen until a server component resolves, and
 * shows nothing meanwhile unless the segment has a `loading.tsx`. These pages
 * read the database and then DERIVE their rows on top of that read, so a
 * click looked like it did nothing and then the page jumped. The app was not
 * slow so much as silent — prod TTFB is 250-340ms.
 *
 * Scoped to THIS segment, not the whole dashboard. The first attempt put one
 * boundary over the entire tree and broke an unrelated E2E — reproducibly, on
 * a rerun. A `loading.tsx` wraps its segment in Suspense, and a route that
 * calls `redirect()` or `notFound()` during render (the inbox does, in seven
 * places) then streams a shell before resolving the redirect, so a navigation
 * already in flight aborts (`net::ERR_ABORTED`).
 *
 * A shell is only safe where the page actually renders a page. This one does:
 * its own redirects sit on paths a reader does not arrive on — a broken
 * session, an unknown slug, a manifest that declares `href` — not on the
 * normal render. The shape is the list archetype's (`patterns/Skeletons`).
 */
export default function WorkspacePageLoading() {
  return <ListSkeleton />;
}
