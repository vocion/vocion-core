import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { getBulkJob } from '@/services/personalization/bulkRegenerate';
import { jsonError } from '../../../_shared';

/** One bulk job, with its per-lead outcomes: what the job page polls. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await clerkAuth();
  if (!userId || !orgId) {
    return jsonError('UNAUTHORIZED', 'Missing or invalid credentials', 401);
  }
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return jsonError('BAD_REQUEST', 'Job id must be a positive integer', 400);
  }
  const job = await getBulkJob(orgId, jobId);
  if (!job) {
    return jsonError('NOT_FOUND', 'No bulk job with that id on this workspace', 404);
  }
  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    note: job.note,
    total: job.total,
    done: job.done,
    failed: job.failed,
    status: job.status,
    outcomes: job.outcomes,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}
