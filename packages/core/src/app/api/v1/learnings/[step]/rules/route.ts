import { NextResponse } from 'next/server';
import { addLearning } from '@/services/LearningsService';
import { authApi, jsonError } from '../../../_shared';

/**
 * POST a new learning rule into a step. Body: { ruleText: string,
 * source?: string }. Returns the created row, OR a 409 with
 * `error.code = NEAR_DUPLICATE` when the rule is too similar to an
 * existing one (per the service's trigram-Jaccard dedup check).
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ step: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { step } = await context.params;

  let body: { ruleText?: unknown; source?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }
  if (typeof body.ruleText !== 'string' || body.ruleText.trim().length === 0) {
    return jsonError('INVALID_BODY', '`ruleText` is required (non-empty string)', 400);
  }
  const source = typeof body.source === 'string' ? body.source : undefined;

  try {
    const result = await addLearning({
      orgId: auth.orgId,
      stepName: step,
      ruleText: body.ruleText,
      source,
      createdBy: 'dashboard',
    });
    if (!result.ok) {
      return jsonError('NEAR_DUPLICATE', result.detail, 409, {
        existingId: result.existing?.existingId,
        similarity: result.existing?.similarity,
      });
    }
    return NextResponse.json(result.rule, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('unknown learning step')) {
      return jsonError('NOT_FOUND', message, 404);
    }
    return jsonError('ADD_LEARNING_FAILED', message, 500);
  }
}
