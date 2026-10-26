import { NextResponse } from 'next/server';
import { checkJevNow } from '@/services/routing/health';
import { authApi, isErrorResponse } from '../../../_shared';

/**
 * POST /api/v1/routing/health/check
 * Ask Jev one yes/no question now with the key this workspace spends, and say
 * whether it answered (ADR 0006, health): `ok`, the `outcome` (`auth` is a
 * rejected key, `no_key` none set), latency and the Jev build. One tiny call
 * at most every 30 seconds per workspace; within that the last result comes
 * back with `cached: true`. Never returns the key. Auth: tenant API token or
 * dashboard session.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  return NextResponse.json(await checkJevNow(caller.orgId));
}
