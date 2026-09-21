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

import { timeAgo } from '@/libs/timeAgo';

/** What the database already worked out about a dataset's runs. */
export type RunFactsForCard = {
  runCount: number;
  latestStatus: string | null;
  latestStartedAt: Date | string | null;
  lastPassRate: number | null;
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
 * Sum up a dataset's runs for its card.
 * @param facts - What `summariseDatasetRuns` found, or null for a dataset with
 * no runs at all.
 * @param now - The clock, injectable so tests do not depend on the real one.
 */
export function summariseLastRun(facts: RunFactsForCard | null | undefined, now: number = Date.now()): LastRunSummary {
  if (!facts || facts.runCount === 0 || !facts.latestStartedAt) {
    return { text: 'never run', warning: false, exactTime: null, passRate: null };
  }

  const passRate = typeof facts.lastPassRate === 'number' ? facts.lastPassRate : null;
  const startedAt = facts.latestStartedAt instanceof Date ? facts.latestStartedAt : new Date(facts.latestStartedAt);
  const exactTime = startedAt.toLocaleString();
  if (facts.latestStatus === 'running') {
    return { text: 'running now', warning: false, exactTime, passRate };
  }
  if (facts.latestStatus === 'failed') {
    return { text: `failed ${timeAgo(startedAt, now)}`, warning: true, exactTime, passRate };
  }
  return { text: timeAgo(startedAt, now), warning: false, exactTime, passRate };
}
