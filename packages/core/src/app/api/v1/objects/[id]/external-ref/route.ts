import { NextResponse } from 'next/server';
import { linkExternalRecord } from '@/services/BusinessObjectService';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../../_shared';

/**
 * POST /api/v1/objects/:id/external-ref
 *
 * Tie a business object to the record another system now holds for it. Body:
 *
 *   { system, id }
 *
 * e.g. `{ "system": "strapi", "id": "412" }` after an admin panel published
 * an approved candidate. The usual path is to pass the same `externalRef` on
 * `POST /api/v1/reviews/decide`, which approves and links in one call; this
 * endpoint exists for the repair case — the record was published but the
 * decide call never landed. Idempotent.
 *
 * Auth: tenant API token or dashboard session.
 * @param req
 * @param context
 * @param context.params - Route params carrying the business object id.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { id } = await context.params;
  const objectId = Number.parseInt(id, 10);
  if (!Number.isFinite(objectId) || objectId <= 0) {
    return jsonError('VALIDATION_FAILED', `"${id}" is not a business object id`, 400);
  }

  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const system = typeof body.system === 'string' ? body.system.trim() : '';
  const externalId = typeof body.id === 'string' ? body.id.trim() : '';
  // Both halves or neither: half a link is worse than none, because it reads
  // as "published" to anything filtering on the system.
  if (system === '' || externalId === '') {
    return jsonError('VALIDATION_FAILED', 'system and id are both required', 400);
  }

  const linked = await linkExternalRecord(caller.orgId, objectId, { system, id: externalId });
  if (!linked) {
    return jsonError('NOT_FOUND', `No business object ${objectId} in this org`, 404);
  }

  return NextResponse.json({
    ok: true,
    object: {
      id: linked.id,
      title: linked.title,
      status: linked.status,
      externalSystem: linked.externalSystem,
      externalId: linked.externalId,
    },
  });
}
