import { NextResponse } from 'next/server';
import { apiEmitEvent, WriteApiError } from '@/services/writeApi';
import { jsonError } from '../_shared';

/**
 * POST /api/v1/events
 *
 * Emit an inbound event; the trigger runner fans it out to the workflows
 * subscribed to that type. Body: `{ type, payload?, dedupeKey? }`. A repeated
 * `dedupeKey` no-ops (redelivered webhooks are safe). Auth: `Bearer vcn_live_…`.
 *
 * Provider webhooks (HubSpot, Gmail push, calendar, DocuSign) are thin adapters
 * that normalize their payload and POST here.
 * @param req
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError('VALIDATION_FAILED', 'Request body must be JSON', 400);
  }
  try {
    const out = await apiEmitEvent(req.headers.get('authorization'), {
      type: String(body.type ?? ''),
      payload: (body.payload as Record<string, unknown>) ?? {},
      dedupeKey: typeof body.dedupeKey === 'string' ? body.dedupeKey : undefined,
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof WriteApiError) {
      return jsonError(e.code, e.message, e.status);
    }
    throw e;
  }
}
