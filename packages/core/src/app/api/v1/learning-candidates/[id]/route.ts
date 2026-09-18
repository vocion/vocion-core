import { NextResponse } from 'next/server';
import { getCandidate, updateCandidate } from '@/services/LearningCandidateService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../_shared';

/**
 * GET /api/v1/learning-candidates/:id
 *
 * One candidate. An id this org does not own is a 404.
 * Auth: tenant API token or dashboard session.
 * @param req
 * @param context
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await context.params).id, 'Candidate');
  if (isErrorResponse(id)) {
    return id;
  }
  const candidate = await getCandidate(caller.orgId, id);
  if (!candidate) {
    return jsonError('NOT_FOUND', `No learning candidate found with id ${id}`, 404);
  }
  return NextResponse.json(candidate);
}

/**
 * PATCH /api/v1/learning-candidates/:id
 *
 * Reword a pending candidate, point it at a different learning step, change
 * its memory type, or re-scope it. Body: `{ editedRuleText?, stepName?,
 * memoryType?, scopeKind?, scopeRef? }` (scopeKind: null clears back to
 * workspace scope).
 *
 * The original `ruleText` is never overwritten, so what the classifier actually
 * proposed stays on the record. A candidate that has already been decided
 * cannot be edited — that would rewrite history.
 * Auth: tenant API token or dashboard session.
 * @param req
 * @param context
 * @param context.params
 */
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await context.params).id, 'Candidate');
  if (isErrorResponse(id)) {
    return id;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }

  const result = await updateCandidate({
    orgId: caller.orgId,
    id,
    editedRuleText: typeof body.editedRuleText === 'string' ? body.editedRuleText : undefined,
    stepName: typeof body.stepName === 'string' ? body.stepName : undefined,
    memoryType: typeof body.memoryType === 'string' ? body.memoryType : undefined,
    // null clears a scope back to workspace; absent leaves it alone.
    scopeKind: typeof body.scopeKind === 'string' || body.scopeKind === null ? body.scopeKind as string | null : undefined,
    scopeRef: typeof body.scopeRef === 'string' || body.scopeRef === null ? body.scopeRef as string | null : undefined,
  });

  if (result.ok) {
    return NextResponse.json(result.candidate);
  }
  if (result.error === 'not_found') {
    return jsonError('NOT_FOUND', `No learning candidate found with id ${id}`, 404);
  }
  if (result.error === 'already_decided') {
    return jsonError('CONFLICT', 'This candidate has already been decided and cannot be edited', 409);
  }
  return jsonError('VALIDATION_FAILED', 'editedRuleText must not be empty', 400);
}
