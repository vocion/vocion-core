import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { regenerateBrief } from '@/services/PersonalizationQueueService';
import { jsonError } from '../../../../_shared';

/**
 * POST /api/v1/personalization/briefs/:id/regenerate — send a brief back to
 * be written again, with the reviewer's instruction.
 *
 * The note is required. A rewrite with no reason gives the next pass nothing
 * the last pass did not have, so the route refuses it rather than accepting a
 * regeneration that cannot improve anything.
 *
 * The lead returns to unbriefed with its tries reset, so the next scheduled
 * sweep picks it up. Nothing runs here: the write is the whole request.
 * @param _req
 * @param ctx
 * @param ctx.params
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId, orgId } = await clerkAuth();
  if (!userId || !orgId) {
    return jsonError('UNAUTHORIZED', 'Missing or invalid credentials', 401);
  }

  const { id } = await ctx.params;
  const briefId = Number(id);
  if (!Number.isInteger(briefId) || briefId <= 0) {
    return jsonError('BAD_REQUEST', 'Brief id must be a positive integer', 400);
  }

  const body = await _req.json().catch(() => null);
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (!note) {
    return jsonError('BAD_REQUEST', 'An instruction is required: a rewrite without a reason teaches the next pass nothing', 400);
  }

  const result = await regenerateBrief(orgId, { id: briefId, note: note.slice(0, 2000) });
  if (!result.regenerated) {
    return jsonError('NOT_FOUND', 'No brief with that id on this workspace queue', 404);
  }

  const { emitEvent } = await import('@/services/EventService');
  await emitEvent({
    orgId,
    type: 'personalization.brief_regenerate_requested',
    payload: { briefId, contactRef: result.contactRef, note },
    invokedBy: userId,
  });

  return NextResponse.json(result);
}
