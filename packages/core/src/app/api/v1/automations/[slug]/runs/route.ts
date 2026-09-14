import { NextResponse } from 'next/server';
import { listAutomationRuns } from '@/services/AutomationService';
import { authApi, jsonError } from '../../../_shared';
import { runFilterFromSearchParams } from '../../_runFilter';

/**
 * GET /api/v1/automations/<slug>/runs — one automation's fires, newest first.
 *
 * The same filters and cursor as the cross-automation log, with `slug` pinned
 * from the path so the two cannot disagree.
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
  const filter = runFilterFromSearchParams(new URL(req.url).searchParams, { slug });
  if ('error' in filter) {
    return jsonError('INVALID_QUERY', filter.error, 400);
  }
  return NextResponse.json(await listAutomationRuns(auth.orgId, filter.value), { status: 200 });
}
