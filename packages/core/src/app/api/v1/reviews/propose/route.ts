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
 *
 * The response says which of those happened, so a caller re-posting the same
 * page knows what it actually did:
 *
 *   { runId, status, outcome: 'created' | 'refreshed' | 'already_decided', decidedAt? }
 *
 * `already_decided` means a person judged this record before and nothing was
 * written — `runId`, `status` and `decidedAt` describe that earlier decision.
 * Only actions that opt in (`dedupAgainstDecided`) ever answer it.
 *
 * Re-posting a record whose CONTENT changed behaves three ways, depending on
 * what moved. Changing a field the dedup key is built from makes it a
 * different record, so it comes back `created`. Changing any other field
 * while the item is still pending comes back `refreshed`, and the reviewer
 * sees the new payload. Changing any other field after the item was decided
 * comes back `already_decided` and the edit is dropped — nothing is stored
 * and nobody is notified, so a caller that cares about late edits has to
 * compare `decidedAt` itself and take it up outside the queue.
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
