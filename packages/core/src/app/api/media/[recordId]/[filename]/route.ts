import type { NextRequest } from 'next/server';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { db } from '@/libs/DB';
import { canOpenArtifact } from '@/libs/share/audience';
import { locateMedia, mediaUrl, parseRange } from '@/libs/tools/artifacts/media';
import { artifactSchema } from '@/models/Schema';

/** A presigned GET lives this long: long enough to start playing, never days. */
const PRESIGN_SECONDS = 600;

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Recording not found' } }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * `GET /api/media/:recordId/:filename` — a recording the media store kept
 * (`libs/tools/artifacts/media.ts`), to a signed-in member of its org or a
 * workspace token. The key is built from the CALLER's org, so another org's
 * file is not reachable by any path; the artifact that claims the URL decides
 * its audience, exactly as `/api/artifacts` does. On disk it streams and
 * answers byte ranges (a phone's player will not start without them); in S3
 * it is a redirect to a presigned GET that lasts minutes.
 * @param req - The request.
 * @param ctx - The route.
 * @param ctx.params - The record and the file.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ recordId: string; filename: string }> }) {
  const { recordId, filename } = await ctx.params;
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const [claim] = await db
    .select({ shareAudience: artifactSchema.shareAudience, shareOwnerId: artifactSchema.shareOwnerId })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, caller.orgId), eq(artifactSchema.url, mediaUrl(recordId, filename))))
    .limit(1);
  if (claim && !canOpenArtifact({ audience: claim.shareAudience, ownerId: claim.shareOwnerId }, { userId: caller.source === 'session' ? caller.actorId : null, hasToken: false, isMember: true })) {
    return notFound();
  }
  const found = await locateMedia(caller.orgId, recordId, filename);
  if (!found) {
    return notFound();
  }
  if (found.store === 's3') {
    const { presignGet } = await import('@/libs/aws/s3');
    const url = await presignGet({ bucket: found.bucket, key: found.key, region: found.region, expiresIn: PRESIGN_SECONDS });
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const base = {
    'Content-Type': found.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${filename}"`,
  };
  const range = parseRange(req.headers.get('range'), found.size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${found.size}` } });
  }
  const { start, end } = range ?? { start: 0, end: found.size - 1 };
  const body = Readable.toWeb(createReadStream(found.abs, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: { ...base, 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${found.size}` } : {}) },
  });
}
