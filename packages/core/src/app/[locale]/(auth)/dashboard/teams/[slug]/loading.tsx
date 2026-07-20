import { Skeleton } from '@/components/ui/skeleton';

/** Team detail loading state — mirrors the hero + rail + roster layout so the loaded page lands with no shift. */
export default function TeamDetailLoading() {
  return (
    <div aria-busy>
      <Skeleton className="mb-5 h-4 w-28" />

      <div className="flex gap-5 border-b border-border pb-7">
        <Skeleton className="size-14 rounded-2xl" />
        <div className="flex-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-3 w-24" />
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
        </div>
      </div>

      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Skeleton className="order-2 h-64 rounded-xl lg:order-1" />
        <div className="order-1 flex flex-col gap-3 lg:order-2">
          {Array.from({ length: 3 }).map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key -- static placeholder list
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
