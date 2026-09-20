import { NextResponse } from 'next/server';
import { getObjectTypeBySlug, listBusinessObjectPage, upsertBusinessObjectByExternalKey } from '@/services/BusinessObjectService';
import { UpsertBusinessObjectValidation } from '@/validations/BusinessObjectValidation';
import { authApi, isErrorResponse, jsonError, readJsonBody, readPagination, requireCapability } from '../_shared';

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

/**
 * POST /api/v1/objects
 *
 * Write one object instance, or upsert it by the external key its owning system knows it by.
 *
 * Body: `{ type, title, status?, metadata?, externalKey?: { system, id } }`.
 * The counterpart to `POST /objects/types`, which registers the shape. With
 * an `externalKey` this org has already written,
 * the row is updated in place (`metadata` shallow-merged, `title` and `status`
 * replaced) and the reply is 200; otherwise a new object is 201. The key is
 * the owning system's own handle — a deploy script recording a `release`
 * sends `{system: 'deploy', id: '<product>@<tag>'}` and can post the
 * post-deploy health result later against the same key without forking the
 * row. The `type` must already be registered for this org (404 otherwise);
 * this endpoint never invents a shape. Same capability as registering a
 * type.
 *
 * Auth: a tenant API token (`Authorization: Bearer vcn_live_…`) or a
 * signed-in dashboard session.
 * @param req
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'approve');
  if (denied) {
    return denied;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const parsed = UpsertBusinessObjectValidation.safeParse(body);
  if (!parsed.success) {
    return jsonError('VALIDATION_FAILED', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 400);
  }
  if (!(await getObjectTypeBySlug(caller.orgId, parsed.data.type))) {
    return jsonError('NOT_FOUND', `Object type "${parsed.data.type}" is not registered for this workspace`, 404);
  }
  const { object, created } = await upsertBusinessObjectByExternalKey(
    { typeSlug: parsed.data.type, title: parsed.data.title, status: parsed.data.status, metadata: parsed.data.metadata, externalKey: parsed.data.externalKey },
    caller.orgId,
    caller.actorId,
  );
  return NextResponse.json({ object }, { status: created ? 201 : 200 });
}
