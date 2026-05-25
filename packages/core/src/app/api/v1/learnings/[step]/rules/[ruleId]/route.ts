import { NextResponse } from 'next/server';
import { removeLearning, updateLearning } from '@/services/LearningsService';
import { authApi, jsonError } from '../../../../_shared';

/**
 * PATCH / DELETE a learning rule by id. The step in the URL is for
 * readability + future scoping; the service uses ruleId alone.
 */

export async function PATCH(req: Request, context: { params: Promise<{ step: string; ruleId: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { ruleId } = await context.params;
  const id = Number.parseInt(ruleId, 10);
  if (!Number.isFinite(id)) {
    return jsonError('INVALID_PARAM', `ruleId must be a number, got ${JSON.stringify(ruleId)}`, 400);
  }

  let body: { ruleText?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }
  if (typeof body.ruleText !== 'string' || body.ruleText.trim().length === 0) {
    return jsonError('INVALID_BODY', '`ruleText` is required (non-empty string)', 400);
  }

  const result = await updateLearning({ orgId: auth.orgId, ruleId: id, ruleText: body.ruleText });
  if (!result.ok) {
    return jsonError('NOT_FOUND', `learning rule ${id} not found`, 404);
  }
  return NextResponse.json(result.rule);
}

export async function DELETE(_req: Request, context: { params: Promise<{ step: string; ruleId: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { ruleId } = await context.params;
  const id = Number.parseInt(ruleId, 10);
  if (!Number.isFinite(id)) {
    return jsonError('INVALID_PARAM', `ruleId must be a number, got ${JSON.stringify(ruleId)}`, 400);
  }
  const result = await removeLearning({ orgId: auth.orgId, ruleId: id });
  if (!result.ok) {
    return jsonError('NOT_FOUND', `learning rule ${id} not found`, 404);
  }
  return NextResponse.json({ removedId: result.removedId });
}
