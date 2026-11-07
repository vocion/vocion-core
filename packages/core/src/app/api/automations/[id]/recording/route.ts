import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { routineSchema } from '@/models/Schema';

/** A playable address per automation, kept a little under the hour its signature lasts. */
const KEEP_MS = 40 * 60_000;
const playable: Map<string, { url: string; until: number }> = ((globalThis as { __vocionTaughtRecording?: Map<string, { url: string; until: number }> }).__vocionTaughtRecording ??= new Map());

/**
 * `GET /api/automations/:id/recording` — the recording an automation was taught from, for the
 * player on its teaching panel and on "What Vocion found in the recording". Redirects to the video
 * file Slate signs for a short while, read with the workspace's Slate credential; 404 when the
 * automation has no recording or Slate will not give one (the page then links to Slate instead).
 * Session only, within the automation's workspace.
 * @param _req - The request.
 * @param ctx - The route.
 * @param ctx.params - Its params.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId, orgId } = await clerkAuth();
  if (!userId || !orgId || !/^\d{1,12}$/.test(id)) {
    return new NextResponse(null, { status: 404 });
  }
  const [row] = await db.select({ source: routineSchema.source }).from(routineSchema).where(and(eq(routineSchema.orgId, orgId), eq(routineSchema.id, Number(id)))).limit(1);
  const source = row?.source?.url;
  if (!source) {
    return new NextResponse(null, { status: 404 });
  }
  const key = `${orgId}:${source}`;
  let hit = playable.get(key);
  if (!hit || hit.until < Date.now()) {
    const { slateCredentialsForOrg, slatePlayableUrl } = await import('@/libs/slate/recording');
    const creds = await slateCredentialsForOrg(orgId, userId);
    if (!creds.ok) {
      return new NextResponse(creds.message, { status: 404 });
    }
    const url = await slatePlayableUrl(creds.credentials, source);
    if (!url.ok) {
      return new NextResponse(url.message, { status: 404 });
    }
    hit = { url: url.data, until: Date.now() + KEEP_MS };
    playable.set(key, hit);
  }
  return new Response(null, { status: 302, headers: { 'Location': hit.url, 'Cache-Control': 'private, no-store' } });
}
