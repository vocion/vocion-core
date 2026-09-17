/**
 * What a briefing agent is allowed to supply — the narrow surface between the
 * model and the document.
 *
 * "Structural over prompting" (CLAUDE.md): the model is not asked to obey the
 * content rules, it is *unable* to break them, because the fields that would
 * break them are not on its tool. It contributes observations and judgement;
 * the code contributes structure.
 *
 * | The model supplies | The code decides |
 * |---|---|
 * | metrics it read, with provenance and any target | which sections exist, and in what order |
 * | one clause of narration per changed key | which keys changed at all, and their deltas |
 * | why each waiting decision matters NOW | which decisions are shown, how many, and their order |
 * | today's clock, the exceptions, the detail tables | the on-track verdict |
 * | an agent-activity line, when something mattered | every budget, the redaction, the history, the sources |
 *
 * There is deliberately no `previous`, `delta`, `direction`, `onTrack`,
 * `changes`, `history`, `provenance.sources` or section-ordering field here.
 */

import { z } from 'zod';
import { AgentActivitySchema, BriefingExceptionSchema, BriefingMetricSchema, CriticalPathItemSchema, DetailTableSchema } from './document';

/**
 * A metric as the model reports it: what it read, from where, and against
 * what target. Everything comparative is stripped — `joinDeltas` owns that.
 */
export const AgentMetricSchema = BriefingMetricSchema.omit({ previous: true, delta: true, direction: true });

export const PublishBriefingInputSchema = z.object({
  // Deliberately no date in the example. The model copied the one that used to
  // be here verbatim, publishing a brief on the 17th titled "Wed, Sep 16".
  // The publisher stamps the real date (`briefings/title.ts`).
  title: z.string().min(1).describe('NAME the briefing, with no date in it — the publisher adds the date. e.g. "Revenue Briefing"'),
  rollup: z.boolean().optional().describe('true = the cross-team workspace briefing (workspace lead only). Team leads omit it.'),
  summary: z.string().optional().describe('ONE sentence on the state of the business. Not a section list, not a status report.'),
  metrics: z.array(AgentMetricSchema).max(12).default([]).describe('What you read, with provenance. Report everything worth reading; the code ranks and keeps the top few.'),
  narratives: z.record(z.string(), z.string()).default({}).describe('metric key → one clause explaining a move. A clause for a key that did not move is dropped.'),
  whyNow: z.record(z.string(), z.string()).default({}).describe('inbox item key → why THIS matters today. "$450K unsigned" is data; "unsigned while delivery started" is a briefing.'),
  incidents: z.record(z.string(), z.string()).default({}).describe('inbox item key → why it is a genuine incident. The ONLY way a brief shows more than three decisions.'),
  criticalPath: z.array(CriticalPathItemSchema).max(12).default([]).describe('What is on the clock TODAY, with `order` as minutes from midnight and `date` as the YYYY-MM-DD it falls on. Every item needs its date: the publisher drops anything not dated today, including anything copied from a previous briefing.'),
  exceptions: z.array(BriefingExceptionSchema).max(12).default([]).describe('Only actual exceptions: off-plan, contradictory, stalled or missing. Never "nothing is wrong".'),
  detail: z.array(DetailTableSchema).max(6).default([]).describe('The compact tables behind "View full pipeline".'),
  agentActivity: AgentActivitySchema.optional().describe('ONLY when something mattered: a failure, unusual spend, stalled work, a missed SLA, a human intervention, or a major completed outcome.'),
  targetSet: z.boolean().optional().describe('True when this workspace has set an outcome target, even if nothing readable measures it yet.'),
});

export type PublishBriefingInput = z.infer<typeof PublishBriefingInputSchema>;

/**
 * The date and update labels, from the clock — never from the model.
 * @param at - The clock.
 * @param timeZone - The workspace's timezone.
 */
export function briefingLabels(at: Date, timeZone = 'UTC'): { dateLabel: string; updatedLabel: string } {
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(at);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone }).format(at);
  return { dateLabel, updatedLabel: `Updated ${time}` };
}
