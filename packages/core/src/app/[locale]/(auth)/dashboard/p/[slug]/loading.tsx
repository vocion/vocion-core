import { Skeleton } from '@/components/ui/skeleton';

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
 * normal render.
 */
export default function WorkspacePageLoading() {
  return (
    <div aria-busy aria-label="Loading">
      <div className="mb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </div>

      {/* Widths vary: a column of identical bars reads as a progress bar
          rather than as content waiting to arrive. */}
      <div className="flex flex-col gap-3">
        {[88, 72, 94, 64, 80].map((w, i) => (
          <div key={w} className="rounded-lg border border-border p-4">
            <Skeleton className="h-5" style={{ width: `${w > 80 ? 62 : 48}%` }} />
            <Skeleton className="mt-2.5 h-3.5" style={{ width: `${w}%` }} />
            {i % 2 === 0 && <Skeleton className="mt-2 h-3.5 w-1/3" />}
          </div>
        ))}
      </div>
    </div>
  );
}
