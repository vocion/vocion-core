/**
 * WHAT HAPPENED TO A FEATURE, IN ORDER (Chris, 2026-09-30, #269: "information
 * that's out of order when I open up the connected work … most recent thing
 * doesn't have the work that we approved").
 *
 * Two rules, pure and client-safe, used by the loader
 * (`services/factory/featureReportData.ts`) and the compact list on the page
 * (`features/dashboard/factory/FeatureActivity.tsx`):
 *
 *   - NEWEST FIRST, strictly. Where it started ("Requested in chat by …") is
 *     the oldest entry, so it closes the list rather than sitting above
 *     newer rows.
 *   - A REPEATED AGENT RUN IS ONE ROW. A check that ran six times reads
 *     "ran 6 times · last 2m ago", opening the newest; the rows are grouped
 *     on the run's own title, never on which automation fired it.
 *
 * And the compact preview keeps the work a person approved in reach: when the
 * newest engineering run is not among its first rows, it takes the last slot
 * (it is older than the rows above it, so the order still holds).
 */

/** One row of a feature's activity, as the page draws it. */
export type ActivityRow = {
  kind: 'conversation' | 'mission_run' | 'worker_run';
  id: number;
  title: string;
  at: Date;
  status: string | null;
  detail: string | null;
  /** The conversation the feature was requested in. */
  origin?: boolean;
  /** How many agent runs this row stands for, when it collapses repeats (the newest is `id`). */
  count?: number;
};

const time = (d: Date): number => new Date(d).getTime();

/**
 * Newest first, with repeated agent runs collapsed into their newest one.
 * @param rows - Every row, in any order.
 */
export function collapseActivity<T extends ActivityRow>(rows: readonly T[]): T[] {
  const sorted = [...rows].sort((a, b) => time(b.at) - time(a.at));
  const seen = new Map<string, T>();
  const out: T[] = [];
  for (const row of sorted) {
    if (row.kind !== 'mission_run') {
      out.push(row);
      continue;
    }
    const key = row.title.trim().toLowerCase();
    const newest = seen.get(key);
    if (newest) {
      newest.count = (newest.count ?? 1) + (row.count ?? 1);
      continue;
    }
    const copy = { ...row };
    seen.set(key, copy);
    out.push(copy);
  }
  return out;
}

/**
 * The first `limit` rows, with the newest engineering run kept in reach: if it
 * is not among them, it takes the last slot.
 * @param rows - Rows, newest first (`collapseActivity`).
 * @param limit - How many the preview shows.
 */
export function previewActivity<T extends ActivityRow>(rows: readonly T[], limit = 3): T[] {
  const shown = rows.slice(0, limit);
  const build = rows.find(r => r.kind === 'worker_run');
  if (!build || shown.includes(build) || shown.length < limit) {
    return shown;
  }
  return [...shown.slice(0, limit - 1), build];
}

/**
 * "ran 6 times" for a collapsed row, or null.
 * @param row - The row.
 */
export function repeatLabel(row: Pick<ActivityRow, 'count'>): string | null {
  return row.count && row.count > 1 ? `ran ${row.count} times` : null;
}
