/**
 * Rendering a briefing for the agent — as a CITABLE source, not bare prose.
 *
 * Extracted from the tool so it can be tested without a database, and because
 * the rule it encodes is the one that failed in production: until this,
 * `search_knowledge` was the only tool in the registry whose output carried a
 * citation number. Everything else — briefings, CRM lookups, mail threads —
 * returned prose the model had no way to cite even when it wanted to.
 *
 * So a turn answered entirely from `get_briefing`, which is exactly what
 * "what should I do right now?" produces, laid out a whole day's schedule with
 * no source marker anywhere. The one item in it that was wrong looked
 * identical to the ones that were right, and there was nothing to click.
 *
 * Design principle 10 — show your work: every claim traceable to what produced
 * it, in one move from where it is read.
 */
import type { RuntimeContext } from '../types';

/** The fields of a briefing row this rendering needs. */
export type CitableBriefing = {
  id: number;
  title: string;
  content: string;
  createdAt: Date;
};

/**
 * Whether a briefing was published today, in local terms.
 * @param d - The briefing's `createdAt`.
 * @param now - Reference instant; injectable so tests do not depend on the clock.
 */
export function isFromToday(d: Date, now: Date = new Date()): boolean {
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/**
 * Render a briefing as tool output, claiming the next citation number for the
 * turn and emitting the briefing as a source the reader can open.
 *
 * Uses the same `documents` event and the same `citationSeq` counter as
 * `search_knowledge`, so the `[n]` marker, the source chip and the sources
 * panel all keep working with no new machinery (design principle 6).
 * @param ctx - The run context, for the citation counter and the event sink.
 * @param brief - The briefing being read.
 * @param label - How the briefing was scoped, e.g. `your team (revenue)`.
 * @param now - Reference instant for the staleness line.
 * @returns The tool output, beginning with its citation marker.
 */
export function renderBriefingForAgent(
  ctx: RuntimeContext,
  brief: CitableBriefing,
  label: string,
  now: Date = new Date(),
): string {
  const when = brief.createdAt.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const status = isFromToday(brief.createdAt, now)
    ? `current (published today, ${when})`
    : `STALE — last published ${when}, not today; consider refresh_briefing`;

  const citation = ++ctx.citationSeq.current;
  ctx.emit({
    type: 'documents',
    documents: [{
      document_id: `briefing:${brief.id}`,
      semantic_identifier: brief.title,
      link: `/dashboard/briefings/${brief.id}`,
      source_type: 'briefing',
      blurb: brief.content.slice(0, 2000),
      updated_at: brief.createdAt.toISOString(),
      citationIndex: citation,
    }],
  });

  return [
    `[${citation}] Latest ${label} briefing — "${brief.title}" — ${status}`,
    '',
    brief.content,
    '',
    '---',
    `REMINDER (harness): cite [${citation}] on every claim you take from this briefing — a meeting and its time, a dollar amount, a deal stage, how long something has waited — so the reader can open it and check. An uncited claim about the reader's own day is the failure this marker exists to prevent.`,
    'The brief above is CONTEXT, not your answer. If you surface actionable/owed touches to the user, your workspace rules still apply — emit the required recommend_action card for EACH touch you name BEFORE writing your answer; never substitute a "want me to draft it?" question for a card.',
  ].join('\n');
}
