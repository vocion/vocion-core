import { NextResponse } from 'next/server';
import { apiProposeReview } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/propose
 *
 * Put a proposed action into the review queue. Body:
 *
 *   { actionId, input, agentSlug?, rationale?, confidence?, dedupKey?, expiresInDays? }
 *
 * The proposal always lands `pending` — it rides the normal autonomy gate, so
 * this endpoint can never fire an action outright. Repeating a call with the
 * same `dedupKey` refreshes the existing item instead of duplicating it.
 * Requires the `approve` capability.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  try {
    return NextResponse.json(await apiProposeReview(caller, {
      actionId: String(body.actionId ?? ''),
      input: (body.input as Record<string, unknown>) ?? {},
      agentSlug: typeof body.agentSlug === 'string' ? body.agentSlug : undefined,
      rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
      dedupKey: typeof body.dedupKey === 'string' ? body.dedupKey : undefined,
      expiresInDays: typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
