import { NextResponse } from 'next/server';
import { getAsk } from '@/services/AskService';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../_shared';

/**
 * GET /api/v1/asks/:id — one ask, with its decision when it has one.
 * Cross-org and missing ids both 404. Auth: tenant API token or dashboard session.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await context.params).id, 'Ask');
  if (isErrorResponse(id)) {
    return id;
  }
  const ask = await getAsk(caller.orgId, id);
  return ask ? NextResponse.json({ ask }) : jsonError('NOT_FOUND', `No ask ${id}`, 404);
}
