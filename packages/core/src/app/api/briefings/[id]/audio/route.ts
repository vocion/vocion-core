/**
 * GET /api/briefings/:id/audio — a brief read aloud (docs/guides/listen-to-your-brief.md),
 * to a signed-in reader of the brief's workspace: the session's workspace must
 * hold the brief, exactly as the brief's own page requires. Streams with byte
 * ranges from disk (Safari's player will not start without them), or
 * redirects to a presigned GET when the media store is S3 (`mediaResponse`).
 *
 * Reads only: the audio is made by `briefings.audio` (`routers/Briefings.ts`),
 * which the player calls first. Kept light — the session, one row and the media
 * store — so the route does not compile the server (`scripts/check-route-graph.ts`).
 */

import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { locateMedia } from '@/libs/tools/artifacts/media';
import { mediaResponse } from '@/libs/tools/artifacts/mediaResponse';
import { briefingSchema } from '@/models/Schema';

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No audio for this brief' } }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * @param req - The request.
 * @param ctx - The route.
 * @param ctx.params - The brief.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { orgId, userId } = await clerkAuth();
  if (!orgId || !userId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to listen' } }, { status: 401 });
  }
  const briefingId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(briefingId) || briefingId <= 0) {
    return notFound();
  }
  const [row] = await db.select({ audio: briefingSchema.audio }).from(briefingSchema).where(and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.id, briefingId))).limit(1);
  const audio = row?.audio;
  if (!audio || audio.status !== 'ready') {
    return notFound();
  }
  const m = /^\/api\/media\/([^/]+)\/([^/]+)$/.exec(audio.url);
  const found = m ? await locateMedia(orgId, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)) : null;
  if (!found) {
    return notFound();
  }
  return mediaResponse(req, found, audio.filename);
}
