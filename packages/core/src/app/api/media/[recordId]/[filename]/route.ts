import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { db } from '@/libs/DB';
import { canOpenArtifact } from '@/libs/share/audience';
import { locateMedia, mediaUrl } from '@/libs/tools/artifacts/media';
import { mediaResponse } from '@/libs/tools/artifacts/mediaResponse';
import { artifactSchema } from '@/models/Schema';

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Recording not found' } }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * `GET /api/media/:recordId/:filename` — a recording the media store kept
 * (`libs/tools/artifacts/media.ts`), to a signed-in member of its org or a
 * workspace token. The key is built from the CALLER's org, so another org's
 * file is not reachable by any path; the artifact that claims the URL decides
 * its audience, exactly as `/api/artifacts` does. On disk it streams and
 * answers byte ranges (a phone's player will not start without them); in S3
 * it is a redirect to a presigned GET that lasts minutes (`mediaResponse`).
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
  return mediaResponse(req, found, filename);
}
