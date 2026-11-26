import { NextResponse } from 'next/server';
import { getMissionRunReport } from '@/services/MissionService';
import { authApi, jsonError, readIdParam } from '../../_shared';

/**
 * GET /api/v1/mission-runs/:id
 *
 * Fetches one mission run's full report: status, timing, error, and the
 * per-task plan with each agent's own output text (see
 * `MissionRunReport` in `services/MissionService.ts`). This is the read
 * path a caller reaches for after `GET /api/v1/missions/:slug/runs` lists
 * the run it wants the detail on.
 *
 * The run-level `status`/`error` can read "completed"/null even when a
 * task inside the run failed — the run engine records that failure on the
 * task, not the run — so read `plan.tasks[].status`/`.error` for the real
 * outcome, not just the top-level fields.
 *
 * A missing id, or an id belonging to another org's run, 404s — same
 * cross-org handling as every other `/api/v1` resource, so a wrong-tenant
 * token cannot distinguish "no such run" from "that run is not yours."
 * @param req
 * @param context
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const { id: idParam } = await context.params;
  const id = readIdParam(idParam, 'Mission run');
  if (typeof id !== 'number') {
    return id;
  }

  const report = await getMissionRunReport(id, auth.orgId);
  if (!report) {
    return jsonError('NOT_FOUND', `No mission run found with id ${id}`, 404);
  }
  return NextResponse.json(report);
}
