/**
 * "How long ago" in one phrase — the ONE of these in the product.
 *
 * It started on the evals page (`dashboard/evals/lastRun.ts`); the Proposals
 * board needs the same reading for "how long has this proposal been sitting",
 * and two spellings of the same sentence on two pages is the defect principle
 * 6 names. Pure, with the clock injected, so both callers' tests are
 * deterministic.
 */

/**
 * "just now", "3 hours ago", "2 days ago", then a plain date.
 *
 * Coarse on purpose: the things it dates — an eval run, a proposal's last
 * movement — are daily-to-weekly, and minute precision is noise.
 * @param at - When it happened.
 * @param now - The clock, injectable so tests do not depend on the real one.
 */
export function timeAgo(at: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(hours / 24);
  if (days <= 14) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return `on ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/**
 * The same reading with the sentence glue off, for a fixed-width column where
 * "on Sep 3, 2026" would truncate and "Sep 3, 2026" fits.
 * @param at - When it happened.
 * @param now - The clock.
 */
export function ageLabel(at: Date, now: number): string {
  const said = timeAgo(at, now);
  return said.startsWith('on ') ? said.slice(3) : said;
}

/**
 * The same distance at heartbeat precision, either direction: "12s ago",
 * "3m ago", "2h ago", "in 4m", "in 2d", then the plain date past two weeks.
 *
 * `timeAgo` is coarse because what it dates moves daily; a worker heartbeats
 * every thirty seconds and its lease runs out in minutes, so on the factory
 * floor "just now" would hide the one thing a person is looking for —
 * whether the worker is still alive. Same clock injection, same date
 * fallback; this is the fine end of the one reading, not a second one.
 * @param at - The moment.
 * @param now - The clock, injectable so tests do not depend on the real one.
 */
export function relativeLabel(at: Date, now: number): string {
  const delta = Math.round((now - at.getTime()) / 1000);
  const seconds = Math.abs(delta);
  const say = (n: number, unit: string) => (delta < 0 ? `in ${n}${unit}` : `${n}${unit} ago`);
  if (seconds < 60) {
    return say(seconds, 's');
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return say(minutes, 'm');
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return say(hours, 'h');
  }
  const days = Math.round(hours / 24);
  if (days <= 14) {
    return say(days, 'd');
  }
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
