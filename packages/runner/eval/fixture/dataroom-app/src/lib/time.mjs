// Dates as the product shows and keys them: always UTC.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');

export function toDate(value) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

/** "Oct 1, 2026" */
export function formatDay(value) {
  const d = toDate(value);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Oct 1" */
export function formatShortDay(value) {
  const d = toDate(value);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "2026-10-01" */
export function isoDay(value) {
  const d = toDate(value);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "2026-10-01 09:30" */
export function isoMinute(value) {
  const d = toDate(value);
  return `${isoDay(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function daysBetween(a, b) {
  return Math.floor((toDate(b) - toDate(a)) / 86400000);
}

export function hoursBetween(a, b) {
  return (toDate(b) - toDate(a)) / 3600000;
}

export function addDays(value, n) {
  return new Date(toDate(value).getTime() + n * 86400000).toISOString();
}

export function addMinutes(value, n) {
  return new Date(toDate(value).getTime() + n * 60000).toISOString();
}
