import { NextResponse } from 'next/server';
import { getAutomationRun } from '@/services/AutomationService';
import { authApi, jsonError } from '../../../../_shared';

/**
 * GET /api/v1/automations/<slug>/runs/<runId> — one fire.
 *
 * What a caller polls after an `async` run: the row carries the status, the
 * error, the typed result and the target run id, so a test run can return in
 * milliseconds and still show what the pass found when it lands.
 * @param req
 * @param context
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ slug: string; runId: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const { slug, runId } = await context.params;
  const id = Number(runId);
  if (!Number.isInteger(id) || id < 1) {
    return jsonError('INVALID_QUERY', '`runId` must be a positive integer', 400);
  }
  const run = await getAutomationRun(auth.orgId, id);
  if (!run || run.slug !== slug) {
    return jsonError('NOT_FOUND', `No run ${id} for automation "${slug}"`, 404);
  }
  return NextResponse.json(run, { status: 200 });
}
