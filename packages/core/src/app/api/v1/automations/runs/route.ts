import { NextResponse } from 'next/server';
import { automationRunFacets, listAutomationRuns } from '@/services/AutomationService';
import { authApi, jsonError } from '../../_shared';
import { runFilterFromSearchParams } from '../_runFilter';

/**
 * GET /api/v1/automations/runs — every fire, across every automation.
 *
 * The cross-automation query did not exist: `listAutomationRuns` took a slug
 * and had exactly one caller, asking for `limit 1`. So "has anything been
 * running" was a question only `psql` could answer, and nineteen hours of
 * silence on 3 September were found a week later while investigating something
 * else.
 *
 * Query: `slug`, `status`, `kind`, `invokedBy` (`schedule` | `test-run`),
 * `since`, `until`, `limit`, `cursor`. `facets=1` adds the values present, so
 * a client's filter list is never hardcoded.
 * @param req
 */
export async function GET(req: Request) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const url = new URL(req.url);
  const filter = runFilterFromSearchParams(url.searchParams);
  if ('error' in filter) {
    return jsonError('INVALID_QUERY', filter.error, 400);
  }
  const page = await listAutomationRuns(auth.orgId, filter.value);
  const facets = url.searchParams.get('facets') === '1'
    ? await automationRunFacets(auth.orgId)
    : undefined;
  return NextResponse.json({ ...page, ...(facets ? { facets } : {}) }, { status: 200 });
}
