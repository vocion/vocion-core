import { NextResponse } from 'next/server';
import { apiListAutoExecuted } from '@/services/writeApi';
import { authApi, isErrorResponse, readPagination, writeApiErrorResponse } from '../../_shared';

/**
 * GET /api/v1/reviews/auto-executed
 *
 * Proposals the confidence gate executed without a human — the audit surface
 * for the trust ladder, newest first. Takes `limit` and `offset`.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { limit, offset } = readPagination(new URL(req.url));
  try {
    return NextResponse.json(await apiListAutoExecuted(caller, { limit, offset }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
