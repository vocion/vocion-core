// Deprecated: use ./time.mjs. This reads and writes dates in the server's local time zone, which
// is why its output changes with TZ. Kept until the last callers move.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');

export function parse(value) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

/** Tokens: YYYY, MMM (Oct), MM, DD, D, HH, mm. */
export function format(value, pattern) {
  const d = parse(value);
  const parts = { YYYY: d.getFullYear(), MMM: MONTHS[d.getMonth()], MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), D: d.getDate(), HH: pad(d.getHours()), mm: pad(d.getMinutes()) };
  return pattern.replace(/YYYY|MMM|MM|DD|D|HH|mm/g, t => String(parts[t]));
}

export function daysBetween(a, b) {
  return Math.floor((parse(b) - parse(a)) / 86400000);
}

export function addDays(value, n) {
  return new Date(parse(value).getTime() + n * 86400000);
}
