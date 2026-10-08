/**
 * A day on the members screen: "Sep 15". UTC, so a date reads the same on the
 * server render and in every browser, and the joined, invited and expiry
 * dates on one list all read in one format.
 */

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * @param at - A date, or the ISO string a date arrives as; null when unknown.
 * @returns "Sep 15", or "—" when there is no date to show.
 */
export function day(at: Date | string | null): string {
  if (!at) {
    return '—';
  }
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? '—' : DAY.format(d);
}
