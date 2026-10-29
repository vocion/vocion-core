import type { AdoptionWindow } from './AdoptionService';
import { sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { amplitudeKeyStatus } from '@/services/analytics/amplitudeKey';
import { getScorecard } from '@/services/scorecard/ScorecardService';

/**
 * Configuration and recorded activity are evidence, never proof of delivered value.
 * @param orgId - Workspace from the authenticated session.
 * @param days - Validated reporting window.
 */
export async function getWorkforceInventory(orgId: string, days: AdoptionWindow | 1) {
  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - days * 86_400_000);
  const [inventory, teamsResult, coverageResult, amplitude, scorecard] = await Promise.all([
    db.execute(sql`
      WITH activity AS (
        SELECT agent_slug, count(*) AS events, max(created_at) AS last_activity_at
        FROM user_activity_event
        WHERE org_id = ${orgId} AND created_at >= ${since} AND created_at < ${generatedAt}
          AND event_type IN ('chat.message_sent', 'review.decided', 'review.feedback', 'learning.added')
          AND user_id NOT LIKE '%:%' AND user_id NOT IN ('system', 'eval-runner', '')
        GROUP BY agent_slug
      ), tools AS (
        SELECT agent_slug, count(*) AS calls, max(created_at) AS last_tool_at
        FROM tool_call
        WHERE org_id = ${orgId} AND created_at >= ${since} AND created_at < ${generatedAt}
        GROUP BY agent_slug
      )
      , spend AS (
        SELECT agent_slug, count(*)::int AS model_calls, sum(micro_cents) AS micro_cents, max(created_at) AS last_model_at
        FROM model_call WHERE org_id = ${orgId} AND created_at >= ${since} AND created_at < ${generatedAt}
        GROUP BY agent_slug
      )
      SELECT a.slug, a.name, a.description, a.active, a.team_slug,
        a.skill_slugs, a.playbook_slugs,
        COALESCE(t.accountable_user_id, p.accountable_user_id) AS owner_user_id,
        COALESCE(x.events, 0)::int AS human_events,
        COALESCE(c.calls, 0)::int AS tool_calls,
        x.last_activity_at, c.last_tool_at, s.model_calls, s.micro_cents, s.last_model_at
      FROM agent a
      LEFT JOIN team t ON t.org_id = a.org_id AND t.slug = a.team_slug
      LEFT JOIN project p ON p.id = a.org_id
      LEFT JOIN activity x ON x.agent_slug = a.slug
      LEFT JOIN tools c ON c.agent_slug = a.slug
      LEFT JOIN spend s ON s.agent_slug = a.slug
      WHERE a.org_id = ${orgId}
      ORDER BY a.name, a.slug
    `),
    db.execute(sql`
      SELECT t.slug, t.name, t.goal, t.lead_agent_slug,
        COALESCE(t.accountable_user_id, p.accountable_user_id) AS owner_user_id
      FROM team t LEFT JOIN project p ON p.id = t.org_id
      WHERE t.org_id = ${orgId} ORDER BY t.name, t.slug
    `),
    db.execute(sql`
      SELECT count(*)::int AS events, max(created_at) AS last_event_at,
        count(*) FILTER (WHERE agent_slug IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM agent a WHERE a.org_id = ${orgId} AND a.slug = e.agent_slug))::int AS unlinked_events
      FROM user_activity_event e
      WHERE org_id = ${orgId} AND created_at >= ${since} AND created_at < ${generatedAt}
    `),
    amplitudeKeyStatus(orgId),
    getScorecard(orgId, { from: since, to: generatedAt }),
  ]);
  const agents = inventory.rows.map(r => ({
    slug: String(r.slug),
    name: String(r.name),
    purpose: r.description == null ? null : String(r.description),
    enabled: r.active === 'true' ? true : r.active === 'false' ? false : null,
    teamSlug: r.team_slug == null ? null : String(r.team_slug),
    ownerUserId: r.owner_user_id == null ? null : String(r.owner_user_id),
    skills: (r.skill_slugs ?? []) as string[],
    playbooks: (r.playbook_slugs ?? []) as string[],
    humanEvents: Number(r.human_events),
    toolCalls: Number(r.tool_calls),
    modelCalls: Number(r.model_calls ?? 0),
    modelCostUsd: r.micro_cents == null ? null : Number(r.micro_cents) / 100_000_000,
    reviewDecisions: scorecard.rows.find(a => a.agentSlug === r.slug)?.reviewDecisions ?? 0,
    acceptedAsIsRate: scorecard.rows.find(a => a.agentSlug === r.slug)?.acceptedAsIsRate ?? null,
    lastModelCallAt: r.last_model_at == null ? null : new Date(r.last_model_at as string).toISOString(),
    lastHumanActivityAt: r.last_activity_at == null ? null : new Date(r.last_activity_at as string).toISOString(),
    lastToolCallAt: r.last_tool_at == null ? null : new Date(r.last_tool_at as string).toISOString(),
  }));
  const coverage = coverageResult.rows[0]!;
  return {
    schemaVersion: 1,
    workspaceId: orgId,
    generatedAt: generatedAt.toISOString(),
    window: { days, from: since.toISOString(), to: generatedAt.toISOString() },
    agents,
    teams: teamsResult.rows.map(r => ({
      slug: String(r.slug),
      name: String(r.name),
      goal: r.goal == null ? null : String(r.goal),
      leadAgentSlug: r.lead_agent_slug == null ? null : String(r.lead_agent_slug),
      ownerUserId: r.owner_user_id == null ? null : String(r.owner_user_id),
    })),
    coverage: {
      localEvents: Number(coverage.events),
      lastLocalEventAt: coverage.last_event_at == null ? null : new Date(coverage.last_event_at as string).toISOString(),
      unlinkedAgentEvents: Number(coverage.unlinked_events),
      completeness: 'unverified' as const,
      amplitudeConfiguration: amplitude.effective,
      amplitudeDelivery: 'unverified' as const,
    },
  };
}

export type WorkforceInventory = Awaited<ReturnType<typeof getWorkforceInventory>>;
