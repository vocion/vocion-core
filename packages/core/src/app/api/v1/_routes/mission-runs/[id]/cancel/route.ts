import { NextResponse } from 'next/server';
import { cancelMission, getMissionRun } from '@/services/MissionService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';

/**
 * POST /api/v1/mission-runs/:id/cancel  { reason? } — stop one mission run.
 *
 * The run is settled `cancelled` with the reason (default "cancelled by
 * user"); the loop's own final write honours a settled run and does not
 * overwrite it (`settleRun` in `services/missions/runtime.ts`). The same
 * service path as the dashboard and the `mission_cancel` MCP tool.
 *
 * A run that is already `completed`, `failed` or `cancelled` answers 409 —
 * there is nothing left to stop, and re-labelling a finished run as
 * cancelled would rewrite what happened. A missing id, or another org's,
 * 404s.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await context.params).id, 'Mission run');
  if (isErrorResponse(id)) {
    return id;
  }
  let reason: string | undefined;
  if (req.headers.get('content-length') !== '0' && req.body) {
    const body = await readJsonBody(req);
    if (isErrorResponse(body)) {
      return body;
    }
    if (body.reason !== undefined && typeof body.reason !== 'string') {
      return jsonError('VALIDATION_FAILED', '`reason` must be a string', 400);
    }
    reason = typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim().slice(0, 500) : undefined;
  }
  const run = await getMissionRun(id, caller.orgId);
  if (!run) {
    return jsonError('NOT_FOUND', `No mission run found with id ${id}`, 404);
  }
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return jsonError('MISSION_RUN_SETTLED', `mission run ${id} is already ${run.status}`, 409);
  }
  const cancelled = await cancelMission(id, caller.orgId, reason);
  return NextResponse.json({ id: cancelled.id, status: cancelled.status, error: cancelled.error, completedAt: cancelled.completedAt });
}
