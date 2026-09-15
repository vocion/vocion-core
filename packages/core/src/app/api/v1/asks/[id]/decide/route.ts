import { NextResponse } from 'next/server';
import { decideAsk } from '@/services/AskService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody, requireCapability } from '../../../_shared';
import { askErrorResponse, optStr, withAskUrl } from '../../_lib';

/**
 * POST /api/v1/asks/:id/decide
 *   { decision, note? }
 *
 * Record a person's answer. `decision` is `approve`, `reject`, `done`, or one
 * of the ask's own `options`. Only an open ask can be decided — a second
 * decision is a 409, because the first may already have been acted on by
 * whoever filed the ask. Requires the `approve` capability.
 * Auth: tenant API token or dashboard session.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'approve');
  if (denied) {
    return denied;
  }
  const id = readIdParam((await context.params).id, 'Ask');
  if (isErrorResponse(id)) {
    return id;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const decision = optStr(body, 'decision');
  if (!decision) {
    return jsonError('VALIDATION_FAILED', 'decision is required', 400);
  }
  try {
    const ask = await decideAsk({ orgId: caller.orgId, id, decision, note: optStr(body, 'note') ?? null, decidedBy: caller.actorId });
    return NextResponse.json({ ask: await withAskUrl(caller.orgId, ask) });
  } catch (error) {
    return askErrorResponse(error);
  }
}
