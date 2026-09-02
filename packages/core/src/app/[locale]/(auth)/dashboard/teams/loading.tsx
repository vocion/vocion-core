import { Skeleton } from '@/components/ui/skeleton';

/**
 * Teams org-chart loading state — one wide shimmer band (the workspace
 * lead) + card shimmers in the same grid, so the populated page lands
 * with no layout shift (design §2a states).
 */
export default function TeamsLoading() {
  return (
    <div aria-busy>
      <div className="mb-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>

      <Skeleton className="h-36 w-full rounded-2xl" />

      <div className="mx-auto h-6 w-px bg-border" aria-hidden />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          // eslint-disable-next-line react/no-array-index-key -- static placeholder list
          <Skeleton key={i} className="h-48 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
