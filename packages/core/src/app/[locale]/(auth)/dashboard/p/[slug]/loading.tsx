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
 * Scoped to this segment on purpose. The first attempt put one boundary over
 * the whole `dashboard` tree, which broke an unrelated E2E: a `loading.tsx`
 * wraps its segment in Suspense, and a route that calls `redirect()` or
 * `notFound()` DURING render (the inbox does, in seven places) then streams a
 * shell first and resolves the redirect on the client — so an in-flight
 * navigation aborts (`net::ERR_ABORTED`). A shell is only safe where the page
 * actually renders a page. Slow routes that redirect mid-render need the
 * redirect hoisted above the boundary before they can have one.
 *
 * The shape is what a list page draws — title, description, rows — so the
 * real page lands where the shimmer held it and nothing jumps on arrival.
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
