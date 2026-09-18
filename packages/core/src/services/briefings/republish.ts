/**
 * When a publish is the same briefing again, not a new one.
 *
 * The Briefings page showed pairs: two "Founder GTM Brief — Mon, Sep 15"
 * rows six seconds apart, two "Team report — Wednesday" rows forty seconds
 * apart. Every pair was one run of one agent calling `publish_briefing`
 * twice — once, then again after the contract trimmed something or the
 * model second-guessed a section. Each call made a row, and the reader got
 * two entries that were the same edition of the same brief.
 *
 * A briefing is one document per scope per publish; a second publish from
 * the same publisher into the same scope inside this window replaces the
 * first. Ten minutes is generous for a retry inside one agent run and far
 * short of the shortest real cadence (hourly), so a genuine later edition —
 * the morning brief and an afternoon refresh — still gets its own row.
 */

export const REPUBLISH_WINDOW_MS = 10 * 60 * 1000;

/**
 * Whether a new publish should replace the latest row in its scope.
 * @param prior - The latest briefing in the same scope, or null.
 * @param prior.createdAt - When it was published.
 * @param prior.publishedBy - Who published it (`agent:<slug>`, `job:<name>`, a user id).
 * @param publishedBy - Who is publishing now.
 * @param now - The clock.
 */
export function replacesPrior(
  prior: { createdAt: Date; publishedBy: string | null } | null,
  publishedBy: string | null,
  now: Date = new Date(),
): boolean {
  if (!prior || !publishedBy || prior.publishedBy !== publishedBy) {
    return false;
  }
  const age = now.getTime() - prior.createdAt.getTime();
  return age >= 0 && age < REPUBLISH_WINDOW_MS;
}
