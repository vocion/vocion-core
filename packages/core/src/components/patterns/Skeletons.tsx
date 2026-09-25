import { Skeleton } from '@/components/ui/skeleton';

/**
 * The page's own shape in grey, for the moment between a tap and the page.
 *
 * One skeleton per archetype, beside the patterns they stand in for: a list
 * page (rows or blocks), a report (one record's whole story, the wiki page
 * included), and a conversation. A route's `loading.tsx` renders the one
 * that matches and nothing else — no spinner, no words, nothing that sounds
 * like an agent (backlog 013).
 *
 * Widths vary on purpose: a column of identical bars reads as a progress bar
 * rather than as content waiting to arrive. Every skeleton is `aria-busy`
 * with a label, so a screen reader hears "loading" once and not a list of
 * empty boxes.
 */

/** A list page: title, one line under it, then rows of varying width. */
export function ListSkeleton() {
  return (
    <div aria-busy aria-label="Loading" data-skeleton="list">
      <div className="mb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </div>
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

/**
 * A report or a wiki page: a title, a context line, then sections of prose
 * under hairlines — the reading column, not a grid.
 */
export function ReportSkeleton() {
  return (
    <div aria-busy aria-label="Loading" data-skeleton="report">
      <div className="mb-8">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="max-w-prose">
        {[[92, 78, 85], [70, 88], [95, 60, 82, 74]].map((lines, s) => (
          <div key={lines.join('-')} className={s === 0 ? '' : 'mt-8 border-t border-border/60 pt-8'}>
            <Skeleton className="mb-3 h-4 w-32" />
            {lines.map(w => <Skeleton key={w} className="mt-2 h-3.5" style={{ width: `${w}%` }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A conversation: two exchanges in the reading column, the composer at the
 * bottom edge — the surface as it will be, with nothing said in it yet.
 */
export function ConversationSkeleton() {
  return (
    <div aria-busy aria-label="Loading" data-skeleton="conversation" className="flex h-full min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col gap-8 px-4 pt-16 sm:px-6">
        {[[58, 0], [0, 84, 90, 66], [40, 0], [0, 76, 88]].map((lines, i) => (
          <div key={lines.join('-')} className={i % 2 === 0 ? 'flex justify-end' : ''}>
            {i % 2 === 0
              ? <Skeleton className="h-9 rounded-2xl" style={{ width: `${lines[0] ?? 50}%` }} />
              : (
                  <div className="w-full">
                    <Skeleton className="mb-3 size-5 rounded-full" />
                    {lines.slice(1).map(w => <Skeleton key={w} className="mt-2 h-3.5" style={{ width: `${w}%` }} />)}
                  </div>
                )}
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
        <Skeleton className="h-12 rounded-2xl" />
      </div>
    </div>
  );
}
