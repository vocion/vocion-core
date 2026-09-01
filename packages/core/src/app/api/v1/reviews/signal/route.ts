import { NextResponse } from 'next/server';
import { apiRecordSignal } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/signal
 *
 * Record a triage signal on a pending action without deciding it — the API
 * twin of the dashboard's Skip and Save-for-later buttons. Body:
 * `{ id, signal, hint? }` where `signal` is one of `approve`, `edit`,
 * `reject`, `skip`, `save`, `rewrite`.
 *
 * `signal` shares some words with the `action` field of
 * `POST /api/v1/reviews/decide`, but means something different: this endpoint
 * never decides anything. The item stays in the queue and only the signal is
 * recorded, which is what the trust ladder learns from. To actually approve or
 * reject an item, call `/api/v1/reviews/decide`.
 *
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
    return NextResponse.json(await apiRecordSignal(caller, {
      id: Number(body.id),
      signal: String(body.signal),
      hint: typeof body.hint === 'string' ? body.hint : undefined,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
