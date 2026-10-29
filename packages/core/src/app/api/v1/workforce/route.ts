import { NextResponse } from 'next/server';
import { workforceCommand, WorkforceError } from '@/services/workforce/contracts';
import { readWorkforceOutcomes, recordWorkforceCommand } from '@/services/workforce/ledger';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireWorkspaceAdmin, writeApiErrorResponse } from '../_shared';

/**
 * Full metadata snapshot for reconciliation. Replay exports by workspace + eventKey.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireWorkspaceAdmin(caller, 'read workforce outcomes');
  if (denied) {
    return denied;
  }
  const params = new URL(req.url).searchParams;
  const days = Number(params.get('days') ?? 7);
  if (![1, 7, 30, 90].includes(days)) {
    return jsonError('VALIDATION_FAILED', 'days must be 1, 7, 30 or 90', 400);
  }
  const until = new Date();
  return NextResponse.json(await readWorkforceOutcomes(caller.orgId, new Date(until.getTime() - days * 86_400_000), until, params.get('test') === 'true'), { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireWorkspaceAdmin(caller, 'record workforce outcomes');
  if (denied) {
    return denied;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const parsed = workforceCommand.safeParse(body);
  if (!parsed.success) {
    return jsonError('VALIDATION_FAILED', 'Invalid workforce command', 400);
  }
  if (parsed.data.kind === 'review' && caller.source !== 'session') {
    return jsonError('FORBIDDEN', 'Human outcome reviews require a signed-in reviewer', 403);
  }
  try {
    return NextResponse.json(await recordWorkforceCommand(caller.orgId, caller.actorId, parsed.data));
  } catch (error) {
    if (error instanceof WorkforceError) {
      return jsonError(error.status === 404 ? 'NOT_FOUND' : error.status === 409 ? 'CONFLICT' : 'VALIDATION_FAILED', error.message, error.status);
    }
    return writeApiErrorResponse(error);
  }
}
