import { Skeleton } from '@/components/ui/skeleton';

/**
 * The dashboard's loading state — one file, every page under it.
 *
 * Next holds the OLD page on screen until a server component resolves, and
 * shows nothing at all in the meantime unless the segment has a `loading.tsx`.
 * Forty-one segments under `/dashboard` had none, so every navigation to a
 * page that reads the database — which is most of them, and the workspace
 * pages derive their rows on top of that — looked like a click that did
 * nothing, then a jump. The app was not slow so much as silent.
 *
 * It lives at the `dashboard` segment rather than in each page because Next
 * resolves the NEAREST ancestor: one file covers every child that has not
 * written a closer one, and a page with a distinctive shape (teams) still
 * overrides it with its own.
 *
 * The shape is the one almost every page here shares — a title, a line of
 * description, then rows — so the real page lands in the same places the
 * shimmer held and nothing jumps when it arrives.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy aria-label="Loading">
      <div className="mb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </div>

      {/* A row is a title line over a muted line, which is what a block draws
          and what a table row collapses to on a phone. Widths vary because a
          column of identical bars reads as a progress bar, not as content. */}
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
