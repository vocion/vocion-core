import { NextResponse } from 'next/server';
import { submitSkillRunFeedback } from '@/services/SkillService';
import { authApi, jsonError } from '../../../_shared';

/**
 * POST /api/v1/runs/:id/feedback
 *
 * Submit (or update) post-hoc feedback on a skill run. Body:
 *
 *   { "rating": "up" | "down" | null, "note": string | null }
 *
 * Rating is idempotent — posting the same body twice is a no-op.
 * Works whether or not the run was previously approved/rejected.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { id: idStr } = await context.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return jsonError('VALIDATION_FAILED', 'Run id must be an integer', 400);
  }

  const body = await req.json().catch(() => null) as { rating?: string; note?: string } | null;
  if (!body) {
    return jsonError('VALIDATION_FAILED', 'JSON body required', 400);
  }
  if (body.rating !== undefined && body.rating !== null && body.rating !== 'up' && body.rating !== 'down') {
    return jsonError('VALIDATION_FAILED', 'rating must be "up", "down", or null', 400);
  }

  const updated = await submitSkillRunFeedback({
    orgId: auth.orgId,
    runId: id,
    submittedBy: 'api',
    rating: (body.rating ?? null) as 'up' | 'down' | null,
    note: body.note ?? null,
  });

  if (!updated) {
    return jsonError('NOT_FOUND', `No skill run found with id ${id}`, 404);
  }

  return NextResponse.json({
    id: updated.id,
    rating: updated.rating,
    feedbackNote: updated.feedbackNote,
    feedbackBy: updated.feedbackBy,
    feedbackAt: updated.feedbackAt,
  });
}
