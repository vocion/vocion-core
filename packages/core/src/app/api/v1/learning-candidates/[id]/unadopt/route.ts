import { NextResponse } from 'next/server';
import { getCandidate, unadoptCandidate } from '@/services/LearningCandidateService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody, requireCapability } from '../../../_shared';
import { readActorOverride, readBoundedText } from '../../_lib';

/** Stored on the candidate when the caller gives no reason. */
const DEFAULT_REASON = 'Retired over the API.';
const REASON_MAX = 500;

/**
 * POST /api/v1/learning-candidates/:id/unadopt
 *
 * Take an adopted rule back. The rule leaves the store, so the agent stops
 * reading it on its next turn, and the candidate goes to `rejected` with the
 * reason, so the evidence stays and the same wording is not re-adopted the
 * next time someone says it. An approved merge or retirement is put back the
 * same way: the rules it retired return as they were (`unadoptCandidate`).
 *
 * Body: `{ reason?, undoneBy? }`. `reason` (≤500 characters) is stored as the
 * rejection reason. `undoneBy` names the person a tenant token acts for, as
 * `<app>:<id>` (an id, never an email) — an app with its own admin screen
 * records its user, not the token. Only a token may set it; a dashboard
 * session is recorded as itself.
 *
 * A rule already gone (removed by hand, consolidated away) is not an error:
 * the candidate still flips. 404 when the candidate does not exist, 409 when it
 * is not adopted. Requires the `approve` capability.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
 * @param context - The route context.
 * @param context.params - The `id` path segment.
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
  const reason = readBoundedText(body, 'reason', REASON_MAX);
  if (isErrorResponse(reason)) {
    return reason;
  }
  const undoneBy = readActorOverride(body, 'undoneBy', caller);
  if (isErrorResponse(undoneBy)) {
    return undoneBy;
  }

  const candidate = await getCandidate(caller.orgId, id);
  if (!candidate) {
    return jsonError('NOT_FOUND', `No learning candidate found with id ${id}`, 404);
  }
  if (candidate.status !== 'approved') {
    return jsonError('CONFLICT', 'Only an approved candidate can be unadopted', 409);
  }

  const undone = await unadoptCandidate({ orgId: caller.orgId, id, undoneBy, reason: reason ?? DEFAULT_REASON });
  return NextResponse.json({ ok: true, candidate: await getCandidate(caller.orgId, id), ruleKey: undone.ruleKey });
}
