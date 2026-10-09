/**
 * Briefs read aloud, for the callers that cannot sign in
 * (docs/guides/listen-to-your-brief.md):
 *
 *   - `GET /api/listen/feed/<token>` — the person's private podcast feed (RSS);
 *   - `GET /api/listen/feed/<token>/<briefingId>.mp3` — one episode;
 *   - `GET /api/listen/clip/<signed>.mp3` — one brief's MP3 for a text
 *     message's attachment (Twilio fetches it), signed and expiring
 *     (`libs/briefings/listenLink.ts`).
 *
 * A feed token is random and kept only as a hash; a revoked or unknown one is
 * a 404, and an episode must be one of that person's own spoken briefs. Sign-in
 * free, so it stays light — the database and the media store only — and is in
 * `FORBIDDEN_REACH` (`scripts/check-route-graph.ts`).
 */

import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { readClipToken } from '@/libs/briefings/listenLink';
import { db } from '@/libs/DB';
import { appBaseUrl } from '@/libs/links';
import { locateMedia } from '@/libs/tools/artifacts/media';
import { mediaResponse } from '@/libs/tools/artifacts/mediaResponse';
import { briefingSchema } from '@/models/Schema';
import { podcastXml, readPodcastFeed } from '@/services/briefings/audio/podcast';

const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow' };
const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', ...PRIVATE } });

/**
 * One brief's MP3 from the media store, when it is ready.
 * @param req - The request.
 * @param orgId - The brief's workspace.
 * @param briefingId - The brief.
 */
async function serveBrief(req: NextRequest, orgId: string, briefingId: number): Promise<Response> {
  const [row] = await db.select({ audio: briefingSchema.audio }).from(briefingSchema).where(and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.id, briefingId))).limit(1);
  const audio = row?.audio;
  if (!audio || audio.status !== 'ready') {
    return notFound();
  }
  const m = /^\/api\/media\/([^/]+)\/([^/]+)$/.exec(audio.url);
  const found = m ? await locateMedia(orgId, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)) : null;
  return found ? mediaResponse(req, found, audio.filename, PRIVATE) : notFound();
}

/**
 * @param req - The request.
 * @param ctx - The route.
 * @param ctx.params - The path segments.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const [kind, a, b] = path;
  if (kind === 'clip' && a && !b) {
    const claim = readClipToken(a);
    return claim ? serveBrief(req, claim.orgId, claim.briefingId) : notFound();
  }
  if (kind === 'feed' && a) {
    const feed = await readPodcastFeed(a);
    if (!feed) {
      return notFound();
    }
    if (!b) {
      const base = appBaseUrl() || req.nextUrl.origin;
      return new NextResponse(podcastXml(feed, base, a), { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'private, max-age=300', ...PRIVATE } });
    }
    const id = Number.parseInt(b.replace(/\.mp3$/, ''), 10);
    if (!Number.isSafeInteger(id) || !feed.episodes.some(e => e.id === id)) {
      return notFound();
    }
    return serveBrief(req, feed.personalOrgId, id);
  }
  return notFound();
}
