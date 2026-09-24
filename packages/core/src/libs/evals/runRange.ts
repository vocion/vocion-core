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
 * The longest period, in days, a range with both ends may cover. Shared by the
 * server, which refuses anything longer, and the date picker, which says so
 * before the request is sent. The scorecard uses the same year.
 *
 * Only a range with both ends is held to it: "all time" and "since September"
 * are real questions, and paging plus the trend chart's own limit bound what
 * they cost. A closed range longer than a year is almost always a typo in a
 * year, and saying so beats quietly answering a different question.
 */
export const MAX_RUN_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

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
 * Refuses rather than guesses: a bad date, a backwards range or one longer
 * than {@link MAX_RUN_RANGE_DAYS} is an error,
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
  // An hour of slack: a range of whole local days that crosses a
  // daylight-saving change is an hour longer than its day count.
  if (from.date && to.date && to.date.getTime() - from.date.getTime() > MAX_RUN_RANGE_DAYS * DAY_MS + HOUR_MS) {
    return { ok: false, message: `A period can be at most ${MAX_RUN_RANGE_DAYS} days. Leave out \`from\` or \`to\` to ask for everything since or before a date.` };
  }
  return { ok: true, range: { from: from.date, to: to.date } };
}
