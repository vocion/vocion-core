/**
 * Where a briefing lives. Pure, so a client component can build the link
 * without dragging the database into its bundle — the reason these two are
 * not in `store.ts`.
 *
 * One brief, one URL (`docs/specs/briefing-v2.md` §10): the page shows the
 * last few and hands the rest to the archive, where search and filter live.
 */

/**
 * The page for one brief.
 * @param id - Briefing id.
 */
export function briefingHref(id: number): string {
  return `/dashboard/briefings/${id}`;
}

/** Every brief, searchable and filterable. */
export const BRIEFING_ARCHIVE_HREF = '/dashboard/briefings/archive';
