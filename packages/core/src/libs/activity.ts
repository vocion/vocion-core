import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { skillRunSchema, skillSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';

/**
 * Aggregate run counts for a primitive drilldown's "Recent activity"
 * strip. Single fetch; done in Postgres so drilldowns stay snappy even
 * as the run history grows.
 */

type ActivitySummary = {
  total: number;
  approved: number;
  up: number;
  down: number;
  lastRunAt: Date | null;
};

export async function getSkillActivity(orgId: string, slug: string): Promise<ActivitySummary> {
  const [skill] = await db.select({ id: skillSchema.id }).from(skillSchema).where(and(eq(skillSchema.orgId, orgId), eq(skillSchema.slug, slug))).limit(1);
  if (!skill) {
    return { total: 0, approved: 0, up: 0, down: 0, lastRunAt: null };
  }
  const rows = await db
    .select({
      status: skillRunSchema.status,
      rating: skillRunSchema.rating,
      createdAt: skillRunSchema.createdAt,
    })
    .from(skillRunSchema)
    .where(and(eq(skillRunSchema.orgId, orgId), eq(skillRunSchema.skillId, skill.id)))
    .orderBy(desc(skillRunSchema.createdAt))
    .limit(500);

  return summarize(rows);
}

export async function getWorkflowActivity(orgId: string, slug: string): Promise<ActivitySummary> {
  const [wf] = await db.select({ id: workflowSchema.id }).from(workflowSchema).where(and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.slug, slug))).limit(1);
  if (!wf) {
    return { total: 0, approved: 0, up: 0, down: 0, lastRunAt: null };
  }
  const rows = await db
    .select({
      status: workflowRunSchema.status,
      rating: workflowRunSchema.rating,
      createdAt: workflowRunSchema.createdAt,
    })
    .from(workflowRunSchema)
    .where(and(eq(workflowRunSchema.orgId, orgId), eq(workflowRunSchema.workflowId, wf.id)))
    .orderBy(desc(workflowRunSchema.createdAt))
    .limit(500);

  return summarize(rows);
}

function summarize(rows: Array<{ status: string | null; rating: string | null; createdAt: Date }>): ActivitySummary {
  const total = rows.length;
  let approved = 0;
  let up = 0;
  let down = 0;
  for (const r of rows) {
    if (r.status === 'approved' || r.status === 'completed' || r.status === 'auto') {
      approved++;
    }
    if (r.rating === 'up') {
      up++;
    }
    if (r.rating === 'down') {
      down++;
    }
  }
  return {
    total,
    approved,
    up,
    down,
    lastRunAt: rows[0]?.createdAt ?? null,
  };
}
