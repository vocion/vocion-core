import { NextResponse } from 'next/server';
import { apiEmitEvent } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../_shared';

/**
 * POST /api/v1/events
 *
 * Emit an inbound event; the trigger runner fans it out to the workflows
 * subscribed to that type. Body: `{ type, payload?, dedupeKey? }`. A repeated
 * `dedupeKey` no-ops (redelivered webhooks are safe). Auth: a tenant API token (`Bearer vcn_live_…`) or a dashboard session.
 *
 * Provider webhooks (HubSpot, Gmail push, calendar, DocuSign) are thin adapters
 * that normalize their payload and POST here.
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
    const out = await apiEmitEvent(caller, {
      type: String(body.type ?? ''),
      payload: (body.payload as Record<string, unknown>) ?? {},
      dedupeKey: typeof body.dedupeKey === 'string' ? body.dedupeKey : undefined,
    });
    return NextResponse.json(out);
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
