import { NextResponse } from 'next/server';
import { listMissionRunReportsForMission } from '@/services/MissionService';
import { authApi, jsonError, readPagination } from '../../../_shared';

/**
 * GET /api/v1/missions/:slug/runs
 *
 * Lists the most recent runs of one mission template, newest first, each
 * carrying its full task-level report — `plan.tasks[]` with each task's
 * `status`, `error`, and `output` (the agent's own free-text report of what
 * it did, or why it proposed nothing).
 *
 * Built so a caller outside the dashboard can read what a mission run
 * actually did without shelling into Postgres. On 2026-09-08 a manual run
 * completed with `status: completed` and `error: null` while its one task
 * had failed and reported "0 proposals" in `plan.tasks[0].output` — the only
 * way to read that was psql over SSH. A downstream source registry that
 * writes one row per source per run (leaving `found`/`refreshed`/`failed`
 * null until it can read a report) is the first caller of this route.
 *
 * `?limit=` caps how many runs come back (default 50, max 200 — the same
 * clamp `readPagination` applies to every other `/api/v1` list route). A
 * mission that does not exist, or belongs to another org, 404s rather than
 * 403ing: a wrong-tenant token must not be able to tell "not found" from
 * "not yours" apart.
 * @param req
 * @param context
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;
  const { limit } = readPagination(new URL(req.url));

  const reports = await listMissionRunReportsForMission(auth.orgId, slug, limit);
  if (!reports) {
    return jsonError('NOT_FOUND', `No mission found for slug "${slug}"`, 404);
  }
  return NextResponse.json({ runs: reports });
}
