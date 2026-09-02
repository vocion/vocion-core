/**
 * ObservabilityService — light-weight aggregates for the
 * /dashboard/observability page. Heavier slicing lives in Langfuse.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { toolCallSchema, workflowRunSchema } from '@/models/Schema';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function countRunsLast24h(orgId: string): Promise<{ toolCalls: number; workflowRuns: number }> {
  const since = new Date(Date.now() - DAY_MS);

  const [toolRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(toolCallSchema)
    .where(and(eq(toolCallSchema.orgId, orgId), gte(toolCallSchema.createdAt, since)));
  const [workflowRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workflowRunSchema)
    .where(and(eq(workflowRunSchema.orgId, orgId), gte(workflowRunSchema.createdAt, since)));

  return {
    toolCalls: toolRow?.n ?? 0,
    workflowRuns: workflowRow?.n ?? 0,
  };
}
