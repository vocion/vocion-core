import { NextResponse } from 'next/server';
import { decideCandidate } from '@/services/LearningCandidateService';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireCapability } from '../../../_shared';

/**
 * POST /api/v1/learning-candidates/:id/decide
 *
 * Approve a candidate into a real learning rule, or reject it. Body:
 * `{ decision, reason? }` where `decision` is `approve` or `reject`.
 *
 * Approving runs the same near-duplicate guard a hand-written rule goes
 * through: a candidate that restates a rule already on file comes back as a
 * 409 rather than quietly doubling up. Rejecting requires a reason — the reason
 * is the whole point of keeping rejected candidates.
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

  const id = Number.parseInt((await context.params).id, 10);
  if (!Number.isFinite(id)) {
    return jsonError('VALIDATION_FAILED', 'Candidate id must be an integer', 400);
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return jsonError('VALIDATION_FAILED', 'decision must be "approve" or "reject"', 400);
  }

  const result = await decideCandidate({
    orgId: caller.orgId,
    id,
    decision: body.decision,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    decidedBy: caller.actorId,
  });

  if (result.ok) {
    return NextResponse.json({ ok: true, candidate: result.candidate, ruleId: result.ruleId });
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
        `This rule is a near-duplicate of existing rule #${result.existing.existingId}`,
        409,
        { existing: result.existing },
      );
    default:
      return jsonError('CONFLICT', 'Could not decide this candidate', 409);
  }
}
