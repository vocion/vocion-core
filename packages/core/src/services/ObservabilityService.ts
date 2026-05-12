/**
 * ObservabilityService — light-weight aggregates for the
 * /dashboard/observability page. Heavier slicing lives in Langfuse.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { skillRunSchema, workflowRunSchema } from '@/models/Schema';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function countRunsLast24h(orgId: string): Promise<{ skillRuns: number; workflowRuns: number }> {
  const since = new Date(Date.now() - DAY_MS);

  const [skillRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(skillRunSchema)
    .where(and(eq(skillRunSchema.orgId, orgId), gte(skillRunSchema.createdAt, since)));
  const [workflowRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workflowRunSchema)
    .where(and(eq(workflowRunSchema.orgId, orgId), gte(workflowRunSchema.createdAt, since)));

  return {
    skillRuns: skillRow?.n ?? 0,
    workflowRuns: workflowRow?.n ?? 0,
  };
}
