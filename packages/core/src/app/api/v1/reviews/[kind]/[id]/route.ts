import { NextResponse } from 'next/server';
import { apiGetReview } from '@/services/writeApi';
import { authApi, isErrorResponse, readIdParam, writeApiErrorResponse } from '../../../_shared';

/**
 * GET /api/v1/reviews/:kind/:id
 *
 * One queue item in full: the proposed input, the agent's confidence envelope
 * (confidence, rationale, evidence), the action's own review card when it
 * defines one, and the underlying row.
 *
 * `GET /api/v1/reviews` returns thin rows so the queue stays cheap to poll;
 * this is what a client renders a single record from.
 *
 * An id the caller's org does not own is a 404 — never another tenant's data.
 * Auth: tenant API token or dashboard session.
 * @param req
 * @param context
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { kind, id: rawId } = await context.params;
  const id = readIdParam(rawId, 'Review');
  if (isErrorResponse(id)) {
    return id;
  }
  try {
    return NextResponse.json(await apiGetReview(caller, kind, id));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
