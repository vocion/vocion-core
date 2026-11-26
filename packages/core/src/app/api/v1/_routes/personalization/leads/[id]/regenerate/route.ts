import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { regenerateLeadArtifact } from '@/services/PersonalizationQueueService';
import { jsonError } from '../../../../_shared';

/**
 * POST /api/v1/personalization/leads/:id/regenerate — rewrite ONE of a lead's
 * three artifacts, optionally with an instruction.
 *
 * The lead page has three Regenerate controls, one beside each artifact
 * (`docs/specs/personalization-v2.md`), replacing the single control that used
 * to sit at the bottom of the metadata column and silently mean "the brief".
 *
 * The instruction is required for the brief and optional for the other two:
 * rewriting a brief with no reason gives the next pass nothing the last pass
 * did not have, while "write these sends again" is a legitimate ask on its own.
 * Either way the note becomes the new artifact version's change summary.
 *
 * Nothing runs here: the write plus the event is the whole request, and the
 * subscribed automation does the pass in the background.
 * @param req - The request.
 * @param ctx - Route context.
 * @param ctx.params - `{ id }`, the `lead_brief` row.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await clerkAuth();
  if (!userId || !orgId) {
    return jsonError('UNAUTHORIZED', 'Missing or invalid credentials', 401);
  }

  const { id } = await ctx.params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return jsonError('BAD_REQUEST', 'Lead id must be a positive integer', 400);
  }

  const body = await req.json().catch(() => null);
  const target = body?.target;
  if (target !== 'brief' && target !== 'recommendation' && target !== 'sequence') {
    return jsonError('BAD_REQUEST', 'target must be one of: brief, recommendation, sequence', 400);
  }
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : '';
  if (target === 'brief' && !note) {
    return jsonError('BAD_REQUEST', 'An instruction is required: a brief rewrite without a reason teaches the next pass nothing', 400);
  }

  const result = await regenerateLeadArtifact(orgId, { id: leadId, target, ...(note ? { note } : {}) });
  if (!result.regenerated) {
    return jsonError('NOT_FOUND', 'No lead with that id on this workspace queue', 404);
  }

  const {
    emitEvent,
    PERSONALIZATION_ARTIFACT_REGENERATE_REQUESTED,
    PERSONALIZATION_BRIEF_REGENERATE_REQUESTED,
  } = await import('@/services/EventService');
  await emitEvent({
    orgId,
    type: PERSONALIZATION_ARTIFACT_REGENERATE_REQUESTED,
    payload: { leadId, target, contactRef: result.contactRef, contactName: result.contactName, note },
    invokedBy: userId,
    // The subscribed automation runs a whole agent pass; a reviewer's click
    // must not hold this request open for it.
    dispatchMode: 'background',
  });
  // A brief rewrite still emits the older, narrower event: a workspace
  // automation already subscribes to it, and removing it here would quietly
  // stop working for every workspace that has not been updated.
  if (target === 'brief') {
    await emitEvent({
      orgId,
      type: PERSONALIZATION_BRIEF_REGENERATE_REQUESTED,
      payload: { briefId: leadId, contactRef: result.contactRef, contactName: result.contactName, note },
      invokedBy: userId,
      dispatchMode: 'background',
    });
  }

  return NextResponse.json(result);
}
