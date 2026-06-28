import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { skillRunSchema, skillSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';
import { authApi, jsonError } from '../_shared';

/**
 * GET /api/v1/runs
 *
 * List recent skill + workflow runs across the tenant. Supports query
 * params: kind (skill|workflow), status, rating (up|down), limit.
 * Returns rows sorted by createdAt desc. Same shape as the dashboard
 * audit view.
 * @param req
 */
export async function GET(req: Request) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind');
  const status = url.searchParams.get('status');
  const rating = url.searchParams.get('rating');
  const limitRaw = url.searchParams.get('limit');
  const limit = Math.max(1, Math.min(500, Number.parseInt(limitRaw ?? '100', 10) || 100));

  if (kind && kind !== 'skill' && kind !== 'workflow') {
    return jsonError('VALIDATION_FAILED', 'kind must be "skill" or "workflow"', 400);
  }
  if (rating && rating !== 'up' && rating !== 'down') {
    return jsonError('VALIDATION_FAILED', 'rating must be "up" or "down"', 400);
  }

  const skillRuns = kind === 'workflow'
    ? []
    : await db
        .select({
          id: skillRunSchema.id,
          status: skillRunSchema.status,
          rating: skillRunSchema.rating,
          workspaceSha: skillRunSchema.workspaceSha,
          createdBy: skillRunSchema.createdBy,
          createdAt: skillRunSchema.createdAt,
          feedbackNote: skillRunSchema.feedbackNote,
          slug: skillSchema.slug,
        })
        .from(skillRunSchema)
        .leftJoin(skillSchema, eq(skillRunSchema.skillId, skillSchema.id))
        .where(and(
          eq(skillRunSchema.orgId, auth.orgId),
          status ? eq(skillRunSchema.status, status) : undefined,
          rating ? eq(skillRunSchema.rating, rating) : undefined,
        ))
        .orderBy(desc(skillRunSchema.createdAt))
        .limit(limit);

  const workflowRuns = kind === 'skill'
    ? []
    : await db
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

  const runs = [
    ...skillRuns.map(r => ({ kind: 'skill' as const, ...r })),
    ...workflowRuns.map(r => ({ kind: 'workflow' as const, ...r })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return NextResponse.json({ runs });
}
