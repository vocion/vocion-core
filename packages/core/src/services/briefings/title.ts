/**
 * The date on a briefing's title is stamped by code, not written by the model.
 *
 * `publish_briefing` asked the model for a title and showed it the example
 * `"Revenue Briefing — Wed, Sep 16"`. It did what a model does with an example
 * containing a concrete date: it copied it. A briefing published on the 17th
 * was titled "Wed, Sep 16", and another was titled for a day that had not
 * happened yet — so the Briefings list disagreed with itself about when its
 * own entries were from, and a reader had no way to tell which was right.
 *
 * The model has no clock, and a date is not judgement — it is a fact the
 * publisher already holds. So the model names the briefing and the publisher
 * dates it (CLAUDE.md, structural over prompting; design principle 10, which
 * asks that anything dated be shown with its date).
 */

/**
 * A trailing date the model wrote, in the shapes it actually produces:
 * `— Wed, Sep 16`, `- Sep 16, 2026`, `(Wed Sep 16)`. Anchored at the end,
 * with no nested quantifiers, so it cannot backtrack super-linearly.
 */
const TRAILING_DATE
  = /[\s—–\-(]*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]{0,6},?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.?\s*\d{1,2}(?:,?\s*\d{4})?\)?$|[\s—–\-(]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.?\s*\d{1,2}(?:,?\s*\d{4})?\)?$/i;

/**
 * The title a briefing is published under: the model's name for it, dated by
 * the publisher.
 * @param modelTitle - Whatever the model supplied.
 * @param now - When it is being published. Injectable so tests do not depend on the clock.
 * @returns e.g. `Revenue Briefing — Thu, Sep 17, 2026`.
 */
export function briefingTitle(modelTitle: string, now: Date = new Date()): string {
  // Strip any date the model wrote. Whatever it says, it is a guess, and a
  // guess that disagrees with the row's own `created_at` is worse than none.
  const name = modelTitle.replace(TRAILING_DATE, '').trim().replace(/[\s—–\-,:]+$/, '').trim();
  const stamped = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${name || 'Briefing'} — ${stamped}`;
}
