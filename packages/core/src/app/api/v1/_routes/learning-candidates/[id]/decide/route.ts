import { NextResponse } from 'next/server';
import { ruleChangeKind } from '@/libs/learning/ruleChange';
import { decideCandidate, getCandidate, unadoptCandidate } from '@/services/LearningCandidateService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody, requireCapability } from '../../../_shared';

/**
 * POST /api/v1/learning-candidates/:id/decide
 *
 * Approve a candidate into a real learning rule, or reject it. Body:
 * `{ action, reason? }` where `action` is `approve` or `reject` — the same
 * field name `POST /api/v1/reviews/decide` uses, so a client learns it once.
 *
 * Approving runs the same near-duplicate guard a hand-written rule goes
 * through: a candidate that restates a rule already on file comes back as a
 * 409 rather than quietly doubling up. Rejecting requires a reason — the reason
 * is the whole point of keeping rejected candidates — except when keeping the
 * status quo: turning down a merge or a retirement needs none.
 *
 * `action: "undo"` puts an approved merge or retirement back: the rules it
 * retired return as they were (they were expired, never deleted) and a merged
 * rule is removed. 409 for anything else.
 *
 * Deciding requires the `approve` capability.
 * Auth: tenant API token or dashboard session.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'approve');
  if (denied) {
    return denied;
  }

  const id = readIdParam((await context.params).id, 'Candidate');
  if (isErrorResponse(id)) {
    return id;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  if (body.action === 'undo') {
    const candidate = await getCandidate(caller.orgId, id);
    if (!candidate) {
      return jsonError('NOT_FOUND', `No learning candidate found with id ${id}`, 404);
    }
    if (candidate.status !== 'approved' || ruleChangeKind(candidate) === 'adopt') {
      return jsonError('CONFLICT', 'Only an approved merge or retirement can be undone here', 409);
    }
    const undone = await unadoptCandidate({
      orgId: caller.orgId,
      id,
      undoneBy: caller.actorId,
      reason: 'Undone — the rules it retired are back as they were.',
    });
    return NextResponse.json({ ok: undone.undone, undone });
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return jsonError('VALIDATION_FAILED', 'action must be "approve", "reject" or "undo"', 400);
  }

  const result = await decideCandidate({
    orgId: caller.orgId,
    id,
    decision: body.action,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    decidedBy: caller.actorId,
  });

  if (result.ok) {
    return NextResponse.json({ ok: true, candidate: result.candidate, ruleKey: result.ruleKey });
  }
  switch (result.error) {
    case 'not_found':
      return jsonError('NOT_FOUND', `No learning candidate found with id ${id}`, 404);
    case 'already_decided':
      return jsonError('CONFLICT', 'This candidate has already been decided', 409);
    case 'reason_required':
      return jsonError('VALIDATION_FAILED', 'A reason is required when rejecting a candidate', 400);
    case 'unknown_step':
      return jsonError('VALIDATION_FAILED', 'This candidate targets a learning step that does not exist', 400);
    case 'near_duplicate':
      return jsonError(
        'CONFLICT',
        `This rule is a near-duplicate of existing rule ${result.existing.existingKey}`,
        409,
        { existing: result.existing },
      );
    default:
      return jsonError('CONFLICT', 'Could not decide this candidate', 409);
  }
}
