import { NextResponse } from 'next/server';
import { listMissionRunsPage, MISSION_RUN_LIST_MAX } from '@/services/MissionService';
import { authApi, isErrorResponse, jsonError } from '../_shared';

/**
 * GET /api/v1/mission-runs — the run list across every mission.
 *
 * The read an operator hunts a runaway with: `?status=running` says what is
 * in flight right now, `missionSlug` narrows it to one mission's runs, and
 * `total` is how many matched — so "sixty debrief runs" is one call, not a
 * count in `psql`. Each row is the run's identity and state, with `causedBy`
 * (the automation fires behind it, newest first) so the loop that made it can
 * be followed; the plan and the task outputs are on
 * `GET /api/v1/mission-runs/:id`.
 *
 * Query parameters:
 * - `status` — only the runs in that state (`planning`, `running`, `paused`, `awaiting_review`, `completed`, `failed`, `cancelled`).
 * - `missionSlug` — only the runs of that mission template.
 * - `limit` — how many rows, newest first (default 50, maximum 200).
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const missionSlug = url.searchParams.get('missionSlug') ?? undefined;
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? undefined : Number.parseInt(rawLimit, 10);
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    return jsonError('VALIDATION_FAILED', `limit must be a positive integer (maximum ${MISSION_RUN_LIST_MAX})`, 400);
  }
  const page = await listMissionRunsPage(caller.orgId, { status, missionSlug, limit });
  return NextResponse.json(page);
}
