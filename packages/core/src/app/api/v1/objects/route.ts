import { NextResponse } from 'next/server';
import { listBusinessObjectPage } from '@/services/BusinessObjectService';
import { authApi, isErrorResponse, readPagination } from '../_shared';

/**
 * GET /api/v1/objects
 *
 * A page of the caller's business objects — including the candidates an agent
 * proposed and a human has or has not yet decided on.
 *
 * Query parameters:
 * - `type` — an object type slug, e.g. `event-candidate`.
 * - `status` — `candidate` | `approved` | `rejected` | `active`.
 * - `linked` — `true` for objects already tied to a downstream record,
 *   `false` for approved ones still waiting to be published.
 * - `search` — case-insensitive match on the title.
 * - `limit`, `offset` — the page window. The response carries the real total.
 *
 * Filtering, ordering and counting all happen in the database, so a panel
 * paging a long queue never pulls more than one page.
 *
 * Auth: a tenant API token (`Authorization: Bearer vcn_live_…`) or a
 * signed-in dashboard session.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);
  const linked = url.searchParams.get('linked');

  const page = await listBusinessObjectPage(caller.orgId, {
    typeSlug: url.searchParams.get('type') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    linked: linked === null ? undefined : linked === 'true',
    search: url.searchParams.get('search') ?? undefined,
    limit,
    offset,
  });

  return NextResponse.json(page);
}
