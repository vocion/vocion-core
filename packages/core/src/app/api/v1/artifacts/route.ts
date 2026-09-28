import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { businessObjectSchema } from '@/models/Schema';
import { createArtifact } from '@/services/ArtifactService';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../_shared';

/**
 * POST /api/v1/artifacts
 *
 * Attach an artifact — a screenshot, a video, a report — to a record in this
 * workspace. The factory worker has posted its QA evidence here since the
 * capture pass was written, and the route did not exist: every screenshot,
 * video and QA report answered 404 and reached no page (run 364, 2026-09-26).
 *
 * Body: `{ recordType: 'object', recordId, recordRole?, kind, title, spec }`.
 * The record must be this workspace's. An image travels as `spec.url` (or
 * `spec.href`) with an `image/*` `spec.contentType` — an https URL or an
 * inline `data:` URL — and is stored on the artifact's own `url`, which is
 * what every gallery draws.
 *
 * Auth: a tenant API token (`Authorization: Bearer vcn_live_…`) or a
 * signed-in dashboard session.
 * @param req - The request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const b = (body ?? {}) as { recordType?: string; recordId?: string | number; recordRole?: string; kind?: string; title?: string; spec?: Record<string, unknown> };
  if (b.recordType !== 'object') {
    return jsonError('VALIDATION_FAILED', 'recordType must be "object" (a business object in this workspace).', 400);
  }
  const recordId = Number(b.recordId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return jsonError('VALIDATION_FAILED', 'recordId must be the id of a record in this workspace.', 400);
  }
  const [record] = await db
    .select({ id: businessObjectSchema.id })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, caller.orgId), eq(businessObjectSchema.id, recordId)))
    .limit(1);
  if (!record) {
    return jsonError('NOT_FOUND', `No record #${recordId} in this workspace.`, 404);
  }
  const kind = typeof b.kind === 'string' && b.kind ? b.kind : 'markdown';
  const spec = b.spec && typeof b.spec === 'object' ? b.spec : {};
  const contentType = typeof spec.contentType === 'string' ? spec.contentType : '';
  const src = typeof spec.url === 'string' ? spec.url : typeof spec.href === 'string' ? spec.href : null;
  const imageUrl = src && /^(?:image|video)\//.test(contentType) && /^(?:https:\/\/|data:(?:image|video)\/)/.test(src) ? src : null;
  try {
    const { artifact } = await createArtifact({
      orgId: caller.orgId,
      kind,
      title: String(b.title ?? kind).slice(0, 200),
      spec,
      url: imageUrl,
      record: { type: 'object', id: String(recordId), role: typeof b.recordRole === 'string' ? b.recordRole : null },
      author: { kind: 'agent', id: caller.actorId ?? 'api' },
      changeSummary: 'Attached over the API',
    } as never);
    return NextResponse.json({ artifact: { id: artifact.id, kind: artifact.kind, title: artifact.title } }, { status: 201 });
  } catch (e) {
    return jsonError('VALIDATION_FAILED', (e as Error).message.slice(0, 300), 400);
  }
}
