import { z } from 'zod';

/**
 * The window of eval runs someone asked for, by when each run started.
 *
 * `from` is inclusive and `to` is exclusive, the same as the scorecard's
 * periods, so a range of whole days never counts a midnight run twice. Either
 * end can be missing: no `from` means since the first run, no `to` means up to
 * now. A range with neither end is "all time".
 */
export type RunRange = { from?: Date; to?: Date };

/**
 * The most runs one trend chart reads.
 *
 * Nothing about a period stops a dataset on an online schedule from holding
 * thousands of runs in it, and every one is a point in the SVG. Past this the
 * chart shows the newest ones and says so, rather than cutting the history off
 * without a word the way the old fifty-run list did.
 */
export const MAX_TREND_RUNS = 1000;

export type RunRangeResult = { ok: true; range: RunRange } | { ok: false; message: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const IsoDateTime = z.iso.datetime({ offset: true });

/**
 * One end of the range, or an error message naming it.
 *
 * A bare `YYYY-MM-DD` is read as midnight UTC, which is what someone calling
 * the API with `?from=2026-09-01` means far more often than midnight wherever
 * the server happens to run. A full timestamp must carry its offset, so no end
 * of a range is ever read in a timezone the caller did not pick.
 * @param value - The raw value, or null/empty when the caller left it out.
 * @param name - `from` or `to`, for the message.
 */
function parseRangeEnd(value: string | null | undefined, name: string): { ok: true; date?: Date } | { ok: false; message: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true };
  }
  const candidate = DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value;
  if (!IsoDateTime.safeParse(candidate).success) {
    return { ok: false, message: `\`${name}\` must be a date (YYYY-MM-DD) or an ISO 8601 timestamp with an offset, e.g. 2026-09-01T00:00:00Z.` };
  }
  // zod checks the calendar too, so 2026-02-31 is refused here rather than
  // rolled into March by Date.
  return { ok: true, date: new Date(candidate) };
}

/**
 * Read a run range from untrusted input — a URL's query string or an API call.
 *
 * Refuses rather than guesses: a bad date or a backwards range is an error,
 * never quietly widened to "all time", because an unfiltered list that looks
 * filtered is the one answer a caller cannot tell is wrong.
 * @param input - The raw `from` and `to`, either of which may be missing.
 * @param input.from - Start, inclusive.
 * @param input.to - End, exclusive.
 */
export function parseRunRange(input: { from?: string | null; to?: string | null }): RunRangeResult {
  const from = parseRangeEnd(input.from, 'from');
  if (!from.ok) {
    return from;
  }
  const to = parseRangeEnd(input.to, 'to');
  if (!to.ok) {
    return to;
  }
  if (from.date && to.date && to.date.getTime() <= from.date.getTime()) {
    return { ok: false, message: '`to` must be after `from`.' };
  }
  return { ok: true, range: { from: from.date, to: to.date } };
}
