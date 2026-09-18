import { NextResponse } from 'next/server';
import { apiSyncSource } from '@/services/writeApi';
import { authApi, isErrorResponse, requireCapability, writeApiErrorResponse } from '../../../_shared';

/**
 * POST /api/v1/sources/:slug/sync
 *
 * Run this source now. Answers **202** with the checkpoint as it stands
 * (`{ run }`, or `{ run: null }` for a source that has never synced), the sync
 * itself runs on Temporal, because a crawl takes minutes and an HTTP request
 * should not. Poll `GET /api/v1/sources` for the outcome.
 *
 * **409** when a run already holds the source. A dead run is reported as
 * `abandoned` by the checkpoint reader itself after the takeover window, so a
 * crashed sync never leaves a source permanently unsyncable.
 *
 * Requires the `manage_sources` capability.
 * Auth: tenant API token or dashboard session.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'manage_sources');
  if (denied) {
    return denied;
  }
  const { slug } = await context.params;
  try {
    return NextResponse.json(await apiSyncSource(caller, slug), { status: 202 });
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
