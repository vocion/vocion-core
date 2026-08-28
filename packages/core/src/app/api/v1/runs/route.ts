import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { workflowRunSchema, workflowSchema } from '@/models/Schema';
import { authApi, jsonError } from '../_shared';

/**
 * GET /api/v1/runs
 *
 * List recent workflow runs across the tenant. Supports query params:
 * status, rating (up|down), limit. Returns rows sorted by createdAt
 * desc. Operation runs are gone with the operations layer; per-tool
 * activity lives on /dashboard/activity (tool_call rows).
 * @param req
 */
export async function GET(req: Request) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const rating = url.searchParams.get('rating');
  const limitRaw = url.searchParams.get('limit');
  const limit = Math.max(1, Math.min(500, Number.parseInt(limitRaw ?? '100', 10) || 100));

  if (rating && rating !== 'up' && rating !== 'down') {
    return jsonError('VALIDATION_FAILED', 'rating must be "up" or "down"', 400);
  }

  const workflowRuns = await db
    .select({
      id: workflowRunSchema.id,
      status: workflowRunSchema.status,
      rating: workflowRunSchema.rating,
      workspaceSha: workflowRunSchema.workspaceSha,
      createdBy: workflowRunSchema.createdBy,
      createdAt: workflowRunSchema.createdAt,
      feedbackNote: workflowRunSchema.feedbackNote,
      slug: workflowSchema.slug,
    })
    .from(workflowRunSchema)
    .leftJoin(workflowSchema, eq(workflowRunSchema.workflowId, workflowSchema.id))
    .where(and(
      eq(workflowRunSchema.orgId, auth.orgId),
      status ? eq(workflowRunSchema.status, status) : undefined,
      rating ? eq(workflowRunSchema.rating, rating) : undefined,
    ))
    .orderBy(desc(workflowRunSchema.createdAt))
    .limit(limit);

  return NextResponse.json({ runs: workflowRuns.map(r => ({ kind: 'workflow' as const, ...r })) });
}
