#!/usr/bin/env tsx
/**
 * One-time backfill: synthesize historical `user_activity_event` rows from
 * the existing activity tables, preserving original timestamps, so the
 * adoption dashboard has history from day one.
 *
 * Idempotent: every synthesized event is resource-anchored, and the table's
 * partial unique index (org_id, event_type, resource_type, resource_id)
 * makes re-runs no-ops (INSERT ... ON CONFLICT DO NOTHING). Run it AFTER
 * the live hooks are deployed; double-counting can't happen because live
 * events for the same resource hit the same index.
 *
 * Known approximations (documented, deliberate):
 *  - `chat.message_sent` attributes user turns to the conversation's
 *    creator — historical messages don't carry a per-turn author.
 *  - Historical workflow/mission approvals carry no reviewer, so no
 *    `review.decided` rows are synthesized for them (feedback is).
 *
 * Usage: npm run adoption:backfill
 */
import process from 'node:process';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  agentSchema,
  conversationMessageSchema,
  conversationSchema,
  learningSchema,
  missionRunSchema,
  skillRunSchema,
  skillSchema,
  userActivityEventSchema,
  workflowRunSchema,
} from '@/models/Schema';
import { agentSlugFromPrincipal } from '@/services/adoption/attribution';
import { isHumanActor } from '@/services/adoption/events';

type EventRow = typeof userActivityEventSchema.$inferInsert;

async function insertBatch(rows: EventRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await db.insert(userActivityEventSchema).values(chunk).onConflictDoNothing().returning({ id: userActivityEventSchema.id });
    inserted += res.length;
  }
  return inserted;
}

async function main() {
  const out: EventRow[] = [];

  // Agent attribution, same honest-or-null rule as live capture
  // (services/adoption/attribution.ts): a skill maps to an agent only when
  // exactly one agent in the org lists it. One pass, not per-row queries.
  const [allAgents, allSkills] = await Promise.all([
    db.select({ orgId: agentSchema.orgId, slug: agentSchema.slug, skillSlugs: agentSchema.skillSlugs }).from(agentSchema),
    db.select({ id: skillSchema.id, orgId: skillSchema.orgId, slug: skillSchema.slug }).from(skillSchema),
  ]);
  const skillAgent = new Map<number, string | null>();
  for (const s of allSkills) {
    const owners = allAgents.filter(a => a.orgId === s.orgId && (a.skillSlugs ?? []).includes(s.slug));
    skillAgent.set(s.id, owners.length === 1 ? owners[0]!.slug : null);
  }

  // chat.conversation_created — conversation.createdBy is the author.
  const convs = await db
    .select()
    .from(conversationSchema)
    .where(isNotNull(conversationSchema.createdBy));
  for (const c of convs) {
    if (isHumanActor(c.createdBy)) {
      out.push({
        orgId: c.orgId,
        projectId: c.projectId,
        userId: c.createdBy,
        agentSlug: c.agentSlug,
        eventType: 'chat.conversation_created',
        resourceType: 'conversation',
        resourceId: String(c.id),
        createdAt: c.createdAt,
      });
    }
  }

  // chat.message_sent — user turns, attributed to the conversation creator.
  const msgs = await db
    .select({
      id: conversationMessageSchema.id,
      createdAt: conversationMessageSchema.createdAt,
      orgId: conversationSchema.orgId,
      projectId: conversationSchema.projectId,
      agentSlug: conversationSchema.agentSlug,
      createdBy: conversationSchema.createdBy,
    })
    .from(conversationMessageSchema)
    .innerJoin(conversationSchema, eq(conversationMessageSchema.conversationId, conversationSchema.id))
    .where(and(eq(conversationMessageSchema.role, 'user'), isNotNull(conversationSchema.createdBy)));
  for (const m of msgs) {
    if (isHumanActor(m.createdBy)) {
      out.push({
        orgId: m.orgId,
        projectId: m.projectId,
        userId: m.createdBy!,
        agentSlug: m.agentSlug,
        eventType: 'chat.message_sent',
        resourceType: 'conversation_message',
        resourceId: String(m.id),
        createdAt: m.createdAt,
      });
    }
  }

  // review.decided (skill) — reviewedBy + reviewedAt with decision latency.
  const skillDecisions = await db
    .select()
    .from(skillRunSchema)
    .where(and(isNotNull(skillRunSchema.reviewedBy), inArray(skillRunSchema.status, ['approved', 'rejected'])));
  for (const r of skillDecisions) {
    if (isHumanActor(r.reviewedBy)) {
      const at = r.reviewedAt ?? r.createdAt;
      out.push({
        orgId: r.orgId,
        projectId: r.projectId,
        userId: r.reviewedBy,
        agentSlug: skillAgent.get(r.skillId) ?? null,
        eventType: 'review.decided',
        resourceType: 'skill_run',
        resourceId: String(r.id),
        metadata: {
          kind: 'skill',
          decision: r.status as 'approved' | 'rejected',
          ...(r.reviewedAt ? { latencyMs: r.reviewedAt.getTime() - r.createdAt.getTime() } : {}),
        },
        createdAt: at,
      });
    }
  }

  // review.feedback — skill / workflow / mission runs with feedbackBy.
  // Attribution mirrors live capture: skill → unique owning agent,
  // mission → the run's team lead, workflow → none.
  const feedbackSources = [
    {
      kind: 'skill' as const,
      resource: 'skill_run',
      rows: await db.select().from(skillRunSchema).where(isNotNull(skillRunSchema.feedbackBy)),
      agentSlugFor: (r: typeof skillRunSchema.$inferSelect) => skillAgent.get(r.skillId) ?? null,
    },
    {
      kind: 'workflow' as const,
      resource: 'workflow_run',
      rows: await db.select().from(workflowRunSchema).where(isNotNull(workflowRunSchema.feedbackBy)),
      agentSlugFor: () => null,
    },
    {
      kind: 'mission' as const,
      resource: 'mission_run',
      rows: await db.select().from(missionRunSchema).where(isNotNull(missionRunSchema.feedbackBy)),
      agentSlugFor: (r: typeof missionRunSchema.$inferSelect) => r.team?.lead ?? null,
    },
  ];
  for (const src of feedbackSources) {
    for (const r of src.rows) {
      if (isHumanActor(r.feedbackBy)) {
        out.push({
          orgId: r.orgId,
          projectId: r.projectId,
          userId: r.feedbackBy,
          agentSlug: src.agentSlugFor(r as never),
          eventType: 'review.feedback',
          resourceType: src.resource,
          resourceId: String(r.id),
          metadata: {
            kind: src.kind,
            rating: (r.rating as 'up' | 'down' | null) ?? null,
            hasNote: !!r.feedbackNote,
          },
          createdAt: r.feedbackAt ?? r.createdAt,
        });
      }
    }
  }

  // learning.added — agent-targeted learnings carry an 'agent:<slug>' source.
  const learnings = await db.select().from(learningSchema).where(isNotNull(learningSchema.createdBy));
  for (const l of learnings) {
    if (isHumanActor(l.createdBy)) {
      out.push({
        orgId: l.orgId,
        projectId: l.projectId,
        userId: l.createdBy,
        agentSlug: agentSlugFromPrincipal(l.source),
        eventType: 'learning.added',
        resourceType: 'learning',
        resourceId: String(l.id),
        createdAt: l.createdAt,
      });
    }
  }

  const inserted = await insertBatch(out);
  console.log(`✓ Backfill: ${inserted} events inserted (${out.length - inserted} already present) from ${out.length} candidates.`);

  // Refresh membership last_active_at from the (now fuller) event stream —
  // only forward, never backward.
  await db.execute(sql`
    UPDATE account_membership m
    SET last_active_at = e.last_at
    FROM (
      SELECT user_id, max(created_at) AS last_at
      FROM user_activity_event
      GROUP BY user_id
    ) e
    WHERE e.user_id = m.user_id
      AND (m.last_active_at IS NULL OR m.last_active_at < e.last_at)
  `);
  console.log('✓ Membership last_active_at refreshed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
