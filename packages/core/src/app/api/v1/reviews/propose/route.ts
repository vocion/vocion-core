import { NextResponse } from 'next/server';
import { apiProposeReview } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/propose
 *
 * Put a proposed action into the review queue. Body:
 *
 *   { actionId, input, agentSlug?, rationale?, confidence?, suggestedDecision?,
 *     suggestedDecisionReason?,
 *     suggestedSnoozeUntil?, dedupKey?, expiresInDays? }
 *
 * `suggestedDecision` is what the proposing agent thinks the reviewer should
 * do — `approve`, `reject` or `snooze`. It is advisory: it never releases the
 * action, and a `reject` or `snooze` recommendation additionally keeps the
 * item out of the trust ladder's reach. Anything outside those three values is
 * a 400 rather than a silently dropped field.
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
      // Passed through as the caller wrote it, valid or not: apiProposeReview
      // is where it is checked, so a bad value comes back as a 400 naming the
      // three it could have been instead of vanishing on the way in.
      suggestedDecision: typeof body.suggestedDecision === 'string' ? body.suggestedDecision : undefined,
      suggestedDecisionReason: typeof body.suggestedDecisionReason === 'string' ? body.suggestedDecisionReason : undefined,
      suggestedSnoozeUntil: typeof body.suggestedSnoozeUntil === 'string' ? body.suggestedSnoozeUntil : undefined,
      dedupKey: typeof body.dedupKey === 'string' ? body.dedupKey : undefined,
      expiresInDays: typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
