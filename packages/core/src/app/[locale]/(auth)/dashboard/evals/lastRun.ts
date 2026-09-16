/**
 * What a dataset card says about the last time anyone ran it.
 *
 * The list page is where someone decides which dataset to open, and the
 * question they are actually asking is "is this measured recently enough to
 * trust?". A pass rate on its own cannot answer that: 90% from March and 90%
 * from this morning look identical on the card and mean different things.
 *
 * Kept out of the page so the rules can be tested. They are all about not
 * overstating what we know:
 *
 * - Never run says so, and is not a zero.
 * - A run still going says so, rather than showing the run before it as if
 *   nothing were happening.
 * - A failed run says it failed. "Last run 2 days ago" next to an old pass
 *   rate would read as a healthy dataset when the last attempt fell over.
 * - The pass rate comes from the newest run that actually finished, so a run
 *   in progress never blanks out the number someone had yesterday.
 */

/** The parts of a run this file needs. */
export type RunForCard = {
  status: string;
  startedAt: Date | string;
  metrics?: { passRate?: number | null } | null;
};

export type LastRunSummary = {
  /** Reads on the card, e.g. "last run 2 days ago". */
  text: string;
  /** True when the wording is about something that went wrong. */
  warning: boolean;
  /** Full timestamp for the hover title, or null when there is nothing to date. */
  exactTime: string | null;
  /** From the newest finished run, not the newest run. */
  passRate: number | null;
};

/**
 * "just now", "3 hours ago", "2 days ago", then a plain date.
 *
 * Coarser than the artifact version indicator on purpose: eval runs are a
 * daily-to-weekly thing, and minute precision on a card is noise.
 * @param at - When the run started.
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
 * Sum up a dataset's runs for its card.
 * @param runs - This dataset's runs, newest first, as `listRuns` returns them.
 * @param now - The clock, injectable so tests do not depend on the real one.
 */
export function summariseLastRun(runs: RunForCard[], now: number = Date.now()): LastRunSummary {
  const finished = runs.find(run => run.status === 'succeeded');
  const passRate = typeof finished?.metrics?.passRate === 'number' ? finished.metrics.passRate : null;
  const newest = runs[0];
  if (!newest) {
    return { text: 'never run', warning: false, exactTime: null, passRate: null };
  }

  const startedAt = newest.startedAt instanceof Date ? newest.startedAt : new Date(newest.startedAt);
  const exactTime = startedAt.toLocaleString();
  if (newest.status === 'running') {
    return { text: 'running now', warning: false, exactTime, passRate };
  }
  if (newest.status === 'failed') {
    return { text: `last run failed ${timeAgo(startedAt, now)}`, warning: true, exactTime, passRate };
  }
  return { text: `last run ${timeAgo(startedAt, now)}`, warning: false, exactTime, passRate };
}
