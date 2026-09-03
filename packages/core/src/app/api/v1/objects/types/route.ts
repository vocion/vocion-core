import { NextResponse } from 'next/server';
import { AuthzDeniedError, enforce } from '@/services/authz';
import { createObjectType, getObjectTypeBySlug, listObjectTypes } from '@/services/BusinessObjectService';
import { CreateObjectTypeValidation } from '@/validations/BusinessObjectValidation';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../_shared';

export async function GET(req: Request) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const types = await listObjectTypes(auth.orgId);
  return NextResponse.json({
    types: types.map(t => ({
      slug: t.slug,
      label: t.label,
      description: t.description,
      icon: t.icon,
      sourceRelevance: t.sourceRelevance ?? {},
      updatedAt: t.updatedAt,
    })),
  });
}

/**
 * POST /api/v1/objects/types
 *
 * Register an object type for this org — the record shape an agent may
 * propose candidates against. Body is `{ slug, label, description?, icon?,
 * schema? }`, where `schema` is the JSON Schema the payload is checked
 * against and may carry `propertyOrder` to fix the review card's field order.
 *
 * A workspace apply is the usual way these arrive; this is the same thing
 * over HTTP, for a panel or a test that stands one up directly. Re-posting an
 * existing slug is a 409, not a silent overwrite.
 * @param req
 */
export async function POST(req: Request) {
  const auth = await authApi(req);
  if (isErrorResponse(auth)) {
    return auth;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  // Registering a record shape is a workspace-level write, not a read — the
  // same capability the queue writes require.
  try {
    enforce(auth.principal, { kind: 'action', action: 'approve', scope: { orgId: auth.orgId } }, 'mutate');
  } catch (error) {
    if (error instanceof AuthzDeniedError) {
      return jsonError('FORBIDDEN', `Not allowed to register an object type: ${error.decision.reason}`, 403);
    }
    throw error;
  }

  const parsed = CreateObjectTypeValidation.safeParse(body);
  if (!parsed.success) {
    return jsonError('VALIDATION_FAILED', parsed.error.issues.map(issue => issue.message).join('; '), 400);
  }

  const existing = await getObjectTypeBySlug(auth.orgId, parsed.data.slug);
  if (existing) {
    return jsonError('ALREADY_EXISTS', `Object type "${parsed.data.slug}" is already registered`, 409);
  }

  const [created] = await createObjectType(parsed.data, auth.orgId);
  return NextResponse.json({ type: created }, { status: 201 });
}
