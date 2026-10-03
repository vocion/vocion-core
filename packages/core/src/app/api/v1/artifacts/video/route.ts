import { Buffer } from 'node:buffer';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { mediaMaxBytes, videoExt } from '@/libs/tools/artifacts/media';
import { businessObjectSchema } from '@/models/Schema';
import { fileRecording, QA_VIDEO_ROLE } from '@/services/artifacts/recordings';
import { authApi, isErrorResponse, jsonError } from '../../_shared';

const ROLE = /^[a-z][\w-]{0,39}$/;

/**
 * Read a request body up to `max` bytes, or say it was over.
 * @param req - The request.
 * @param max - The cap.
 */
async function readCapped(req: Request, max: number): Promise<Buffer | 'too_large'> {
  if (!req.body) {
    return Buffer.alloc(0);
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return 'too_large';
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * POST /api/v1/artifacts/video?recordId=<id>&title=…&caption=…&name=…&role=qa-video
 *
 * A recording, as the raw body (`Content-Type: video/webm` or `video/mp4`),
 * kept by Vocion's media store — on disk, or in `VOCION_MEDIA_BUCKET` when it
 * is set — and filed on the record AND on the feature request that record
 * belongs to (its `requestId`), so the request's page plays it. The factory
 * worker sends its repo tests' recordings here: it never needs a bucket of its
 * own. Capped (`VOCION_MEDIA_MAX_BYTES`, 200 MB by default); an over-cap body
 * is refused with the cap in the sentence.
 *
 * Not behind the proxy (`proxy.ts` matcher): a request the proxy matches has
 * its body cut at 10 MB.
 *
 * Auth: a tenant API token or run token (`Authorization: Bearer …`), or a
 * signed-in dashboard session.
 * @param req - The request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const q = new URL(req.url).searchParams;
  const contentType = req.headers.get('content-type') ?? '';
  if (!videoExt(contentType)) {
    return jsonError('UNSUPPORTED_MEDIA_TYPE', `Content-Type must be video/webm or video/mp4, not "${contentType.slice(0, 60) || 'none'}".`, 415);
  }
  const recordId = Number(q.get('recordId'));
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return jsonError('VALIDATION_FAILED', 'recordId must be the id of a record in this workspace.', 400);
  }
  const role = q.get('role')?.trim() || QA_VIDEO_ROLE;
  if (!ROLE.test(role)) {
    return jsonError('VALIDATION_FAILED', 'role must be a short lowercase word, like qa-video.', 400);
  }
  const max = mediaMaxBytes();
  const capLine = `A recording may be ${Math.round(max / 1024 / 1024)} MB at most`;
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    return jsonError('PAYLOAD_TOO_LARGE', `${capLine}; this one is ${(declared / 1024 / 1024).toFixed(1)} MB.`, 413);
  }
  const [record] = await db
    .select({ id: businessObjectSchema.id, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, caller.orgId), eq(businessObjectSchema.id, recordId)))
    .limit(1);
  if (!record) {
    return jsonError('NOT_FOUND', `No record #${recordId} in this workspace.`, 404);
  }
  const body = await readCapped(req, max);
  if (body === 'too_large') {
    return jsonError('PAYLOAD_TOO_LARGE', `${capLine}; this one is larger.`, 413);
  }
  if (body.byteLength === 0) {
    return jsonError('VALIDATION_FAILED', 'The body is empty: send the video bytes.', 400);
  }
  // The feature request this record belongs to, when it says — and only when it is this workspace's.
  const metaRequestId = Number((record.metadata as Record<string, unknown> | null)?.requestId);
  let requestId: number | null = null;
  if (Number.isInteger(metaRequestId) && metaRequestId > 0 && metaRequestId !== recordId) {
    const [request] = await db
      .select({ id: businessObjectSchema.id })
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.orgId, caller.orgId), eq(businessObjectSchema.id, metaRequestId)))
      .limit(1);
    requestId = request?.id ?? null;
  }
  const caption = (q.get('caption') ?? '').slice(0, 300);
  const title = (q.get('title') ?? caption ?? '').slice(0, 120) || 'Recording';
  const filed = await fileRecording({
    orgId: caller.orgId,
    keptUnder: requestId ?? recordId,
    name: (q.get('name') ?? title).slice(0, 80),
    data: body,
    contentType,
    records: [...(requestId ? [{ id: requestId, role }] : []), { id: recordId, role }],
    title,
    caption: caption || title,
    provenance: { by: caller.actorId, recordId, ...(requestId ? { requestId } : {}) },
    author: { kind: 'agent', id: caller.actorId },
  });
  if (!filed.ok) {
    return jsonError(filed.tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED', filed.reason, filed.tooLarge ? 413 : 400);
  }
  return NextResponse.json({ url: filed.url, bytes: filed.bytes, store: filed.store, artifactIds: filed.artifactIds, requestId }, { status: 201 });
}
