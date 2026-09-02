import { NextResponse } from 'next/server';
import { checkDedup } from '@/services/LearningsService';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../../../_shared';

/**
 * POST /api/v1/learnings/:step/rules/check
 *
 * Would adding this rule be refused as a near-duplicate? Body: `{ ruleText }`.
 *
 * Returns `{ ok: true }` when the text is new, or `{ ok: false, existingId,
 * existingRule, similarity }` when it restates a rule already in the step. This
 * is a read — it writes nothing — so a client can warn while someone is still
 * typing instead of failing the save.
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
    return jsonError('VALIDATION_FAILED', '`ruleText` is required (non-empty string)', 400);
  }

  try {
    return NextResponse.json(await checkDedup(caller.orgId, step, body.ruleText));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('unknown learning step')) {
      return jsonError('NOT_FOUND', message, 404);
    }
    // Anything else is a genuine fault: log it and let it surface as a 500
    // with a stack trace rather than minting an error code of its own.
    console.error(`[api/v1/learnings] dedup check failed for step "${step}"`, err);
    throw err;
  }
}
