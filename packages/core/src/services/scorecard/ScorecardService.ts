/**
 * ScorecardService — the client-facing "are the agents doing a good job" view.
 *
 * One row per agent in the organization, answering two questions a business
 * user can act on: how often a person went with what the agent recommended
 * (agreement rate), and how sure the agent was of itself when it recommended
 * (average confidence). Alongside them sit the plain usage numbers the
 * Adoption page computes, over the same range.
 *
 * Why agreement comes from the alignment ledger and not from the Adoption
 * page's own agreement matrix: `decision_alignment` stores `agreed` and
 * `confidence` on the same row, so both numbers describe exactly the same
 * decisions. The Adoption matrix is read out of the activity event log, a
 * separate pipeline — pairing it with a confidence average from the ledger
 * would let two numbers on one row quietly disagree about what was counted.
 *
 * Why rows start from the agent list: the usage query groups over activity
 * events, so an agent nobody has used yet has no row there at all. A client
 * looking at the scorecard should see that agent with "not enough data", not
 * have it vanish.
 *
 * Members, not only admins, read this. It exposes per-agent aggregates only —
 * no per-person numbers — which is what keeps it safe to open up.
 */

import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, decisionAlignmentSchema, userActivityEventSchema } from '@/models/Schema';

/**
 * The period the scorecard covers: `from` inclusive, `to` exclusive. Every
 * column — agreement, confidence and usage — is read over the same range.
 */
export type ScorecardRange = { from: Date; to: Date };

/** Agreement and confidence for one agent, read from the alignment ledger. */
export type AgentAlignmentSummary = {
  /** agreed ÷ recommendations, or null when nothing it recommended has been decided. Null, never 0. */
  agreementRate: number | null;
  /** Mean confidence across decided recommendations that carried one, or null when none did. */
  averageConfidence: number | null;
  /** Decided recommendations — the denominator of the agreement rate. */
  recommendationsDecided: number;
  /** Of those, how many a person decided the way the agent recommended. */
  recommendationsAgreed: number;
  /** How many of those carried a confidence — the denominator of the average. */
  recommendationsWithConfidence: number;
};

export type ScorecardRow = AgentAlignmentSummary & {
  agentSlug: string;
  agentName: string;
  /** Distinct people who worked with the agent in the window. */
  peopleReached: number;
  conversations: number;
  /** Approve, reject, edit and rewrite decisions on the agent's work. */
  reviewDecisions: number;
  /** approvals ÷ review decisions — was the output taken without changes. Null when nothing was reviewed. */
  acceptedAsIsRate: number | null;
};

export type Scorecard = {
  from: string;
  to: string;
  rows: ScorecardRow[];
};

/**
 * Agreement rate and average confidence per agent, in one scan of the ledger.
 *
 * Both halves use the same filter as the rest of the alignment reads: only
 * rows where the agent stated a recommendation, and never `implicit` rows —
 * those carry an `approve` nobody actually said (see AlignmentService). So
 * "average confidence" means the agent's confidence across the very
 * recommendations the agreement rate is scoring. `avg()` skips nulls, so a
 * recommendation made without a confidence neither drags the mean to zero nor
 * counts in its denominator.
 * @param orgId - From the session, never from client input.
 * @param range - The period, `from` inclusive and `to` exclusive.
 */
export async function getAgentAlignmentSummaries(orgId: string, range: ScorecardRange): Promise<Map<string, AgentAlignmentSummary>> {
  const scoredRecommendation = sql`${decisionAlignmentSchema.recommended} is not null and not ${decisionAlignmentSchema.implicit}`;
  const rows = await db
    .select({
      agentSlug: decisionAlignmentSchema.agentSlug,
      recommendationsDecided: sql<number>`count(*) filter (where ${scoredRecommendation})::int`,
      agreed: sql<number>`count(*) filter (where ${decisionAlignmentSchema.agreed} and ${scoredRecommendation})::int`,
      recommendationsWithConfidence: sql<number>`count(${decisionAlignmentSchema.confidence}) filter (where ${scoredRecommendation})::int`,
      averageConfidence: sql<number | null>`avg(${decisionAlignmentSchema.confidence}) filter (where ${scoredRecommendation})`,
    })
    .from(decisionAlignmentSchema)
    .where(and(
      eq(decisionAlignmentSchema.orgId, orgId),
      isNotNull(decisionAlignmentSchema.agentSlug),
      gte(decisionAlignmentSchema.decidedAt, range.from),
      lt(decisionAlignmentSchema.decidedAt, range.to),
    ))
    .groupBy(decisionAlignmentSchema.agentSlug);
  return new Map(rows.map(row => [String(row.agentSlug), toAlignmentSummary(row)]));
}

/**
 * Turn the raw aggregate into the summary, keeping "no data" as null.
 * Postgres returns `avg()` of a real column as a numeric string, hence Number().
 * @param row - One grouped row from the ledger.
 * @param row.recommendationsDecided - Scored recommendations that were decided.
 * @param row.agreed - Of those, how many were decided the recommended way.
 * @param row.recommendationsWithConfidence - Of those, how many stated a confidence.
 * @param row.averageConfidence - Postgres `avg()` result; a numeric string or null.
 */
export function toAlignmentSummary(row: { recommendationsDecided: number; agreed: number; recommendationsWithConfidence: number; averageConfidence: number | string | null }): AgentAlignmentSummary {
  const recommendationsDecided = Number(row.recommendationsDecided);
  const recommendationsAgreed = Number(row.agreed);
  const recommendationsWithConfidence = Number(row.recommendationsWithConfidence);
  return {
    agreementRate: recommendationsDecided > 0 ? recommendationsAgreed / recommendationsDecided : null,
    averageConfidence: recommendationsWithConfidence > 0 && row.averageConfidence !== null ? Number(row.averageConfidence) : null,
    recommendationsDecided,
    recommendationsAgreed,
    recommendationsWithConfidence,
  };
}

/** The summary for an agent with nothing decided in the window. */
export function noAlignmentYet(): AgentAlignmentSummary {
  return { agreementRate: null, averageConfidence: null, recommendationsDecided: 0, recommendationsAgreed: 0, recommendationsWithConfidence: 0 };
}

type AgentListing = { slug: string; name: string; displayName: string | null; active: string | null };
type AgentUsage = { reach: number; conversations: number; approvals: number; rejections: number; revisions: number; approvalRate: number | null };

/**
 * Merge the agent list with its alignment and usage numbers into scorecard rows.
 *
 * Every active agent gets a row even with no data. An inactive agent (a
 * registry teaser, a retired one) is shown only if it has numbers in the
 * window, so a demo's placeholder agents do not pad the table with empty rows.
 * An agent slug that has numbers but no longer exists in the agent list is
 * still shown under its slug — its decisions happened and should be visible.
 *
 * Pure, so the "who gets a row" rule is testable without a database.
 * @param agents - The organization's agents.
 * @param alignmentByAgent - From {@link getAgentAlignmentSummaries}.
 * @param usageByAgent - From the Adoption service's per-agent rows.
 */
export function buildScorecardRows(agents: AgentListing[], alignmentByAgent: Map<string, AgentAlignmentSummary>, usageByAgent: Map<string, AgentUsage>): ScorecardRow[] {
  const namesBySlug = new Map<string, string>();
  const slugsToShow = new Set<string>();
  for (const agent of agents) {
    namesBySlug.set(agent.slug, agent.displayName || agent.name);
    if (agent.active !== 'false') {
      slugsToShow.add(agent.slug);
    }
  }
  for (const slug of alignmentByAgent.keys()) {
    slugsToShow.add(slug);
  }
  for (const slug of usageByAgent.keys()) {
    slugsToShow.add(slug);
  }

  const rows: ScorecardRow[] = [];
  for (const slug of slugsToShow) {
    const usage = usageByAgent.get(slug);
    rows.push({
      agentSlug: slug,
      agentName: namesBySlug.get(slug) ?? slug,
      ...(alignmentByAgent.get(slug) ?? noAlignmentYet()),
      peopleReached: usage?.reach ?? 0,
      conversations: usage?.conversations ?? 0,
      reviewDecisions: usage ? usage.approvals + usage.rejections + usage.revisions : 0,
      acceptedAsIsRate: usage?.approvalRate ?? null,
    });
  }
  return rows.sort(compareScorecardRows);
}

/**
 * Busiest agents first, then by name, then by slug (names need not be unique), so the table reads the same on every load.
 * @param a - One row.
 * @param b - The row it is compared with.
 */
function compareScorecardRows(a: ScorecardRow, b: ScorecardRow): number {
  return b.recommendationsDecided - a.recommendationsDecided
    || b.peopleReached - a.peopleReached
    || a.agentName.localeCompare(b.agentName)
    || a.agentSlug.localeCompare(b.agentSlug);
}

/**
 * Usage per agent over the range, from the activity event log.
 *
 * The same counts the Adoption page shows (its `getAgentRows`), but over an
 * arbitrary from/to range: the Adoption query only knows 7, 30 and 90 days
 * back from now, and it also runs agreement, label and eval queries this page
 * never shows. The event definitions match it exactly — keep them in step.
 * @param orgId - From the session, never from client input.
 * @param range - The period, `from` inclusive and `to` exclusive.
 */
export async function getAgentUsage(orgId: string, range: ScorecardRange): Promise<Map<string, AgentUsage>> {
  const event = userActivityEventSchema;
  const decision = sql`${event.metadata} ->> 'decision'`;
  const rows = await db
    .select({
      agentSlug: event.agentSlug,
      reach: sql<number>`count(distinct ${event.userId})::int`,
      conversations: sql<number>`count(*) filter (where ${event.eventType} = 'chat.conversation_created')::int`,
      approvals: sql<number>`count(*) filter (where ${event.eventType} = 'review.decided' and ${decision} = 'approved')::int`,
      rejections: sql<number>`count(*) filter (where ${event.eventType} = 'review.decided' and ${decision} = 'rejected')::int`,
      revisions: sql<number>`count(*) filter (where ${event.eventType} = 'review.decided' and ${decision} in ('edited', 'rewritten'))::int`,
    })
    .from(event)
    .where(and(
      eq(event.orgId, orgId),
      isNotNull(event.agentSlug),
      gte(event.createdAt, range.from),
      lt(event.createdAt, range.to),
    ))
    .groupBy(event.agentSlug);
  return new Map(rows.map(row => [String(row.agentSlug), toAgentUsage(row)]));
}

/**
 * Coerce the counts and derive the accepted-as-is rate, null when nothing was reviewed.
 * @param row - One grouped row of event counts.
 * @param row.reach - Distinct people.
 * @param row.conversations - Conversations started.
 * @param row.approvals - Approved as-is.
 * @param row.rejections - Turned down.
 * @param row.revisions - Edited or rewritten.
 */
function toAgentUsage(row: { reach: number; conversations: number; approvals: number; rejections: number; revisions: number }): AgentUsage {
  const approvals = Number(row.approvals);
  const rejections = Number(row.rejections);
  const revisions = Number(row.revisions);
  const decisions = approvals + rejections + revisions;
  return {
    reach: Number(row.reach),
    conversations: Number(row.conversations),
    approvals,
    rejections,
    revisions,
    approvalRate: decisions > 0 ? approvals / decisions : null,
  };
}

/**
 * The whole scorecard for an organization.
 * @param orgId - From the session, never from client input.
 * @param range - The period; alignment and usage read the same one.
 */
export async function getScorecard(orgId: string, range: ScorecardRange): Promise<Scorecard> {
  const [agents, alignmentByAgent, usageByAgent] = await Promise.all([
    db
      .select({ slug: agentSchema.slug, name: agentSchema.name, persona: agentSchema.persona, active: agentSchema.active })
      .from(agentSchema)
      .where(eq(agentSchema.orgId, orgId)),
    getAgentAlignmentSummaries(orgId, range),
    getAgentUsage(orgId, range),
  ]);
  const listings = agents.map(agent => ({ slug: agent.slug, name: agent.name, displayName: agent.persona?.displayName ?? null, active: agent.active }));
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    rows: buildScorecardRows(listings, alignmentByAgent, usageByAgent),
  };
}
