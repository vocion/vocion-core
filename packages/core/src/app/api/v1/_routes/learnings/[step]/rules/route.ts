import { NextResponse } from 'next/server';
import { addRule, getNamespace } from '@/services/MemoryService';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../../_shared';

/**
 * GET /api/v1/learnings/:step/rules
 *
 * Every rule in a step. A 404 means the step itself is unknown.
 * Auth: tenant API token or dashboard session.
 * @param req
 * @param context
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ step: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { step } = await context.params;
  try {
    return NextResponse.json(await getNamespace(caller.orgId, step));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('unknown memory namespace')) {
      return jsonError('NOT_FOUND', message, 404);
    }
    console.error(`[api/v1/learnings] could not read rules for step "${step}"`, err);
    return jsonError('GET_LEARNINGS_FAILED', message, 500);
  }
}

/**
 * POST /api/v1/learnings/:step/rules
 *
 * Add a rule to a step. Body: `{ ruleText, source? }`. Returns the created row,
 * or a 409 with `error.code = NEAR_DUPLICATE` when the rule is too close to one
 * already on file (trigram-Jaccard check in the service).
 * Auth: tenant API token or dashboard session.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ step: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { step } = await context.params;

  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  if (typeof body.ruleText !== 'string' || body.ruleText.trim().length === 0) {
    return jsonError('INVALID_BODY', '`ruleText` is required (non-empty string)', 400);
  }
  const source = typeof body.source === 'string' ? body.source : undefined;

  try {
    const result = await addRule({
      orgId: caller.orgId,
      stepName: step,
      ruleText: body.ruleText,
      source,
      createdBy: caller.actorId,
    });
    if (!result.ok) {
      return jsonError('NEAR_DUPLICATE', result.detail, 409, {
        existingKey: result.existing?.existingKey,
        similarity: result.existing?.similarity,
      });
    }
    return NextResponse.json(result.rule, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('unknown memory namespace')) {
      return jsonError('NOT_FOUND', message, 404);
    }
    console.error(`[api/v1/learnings] could not add a rule to step "${step}"`, err);
    return jsonError('ADD_LEARNING_FAILED', message, 500);
  }
}
