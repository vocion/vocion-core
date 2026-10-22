import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { browserRunSchema } from '@/models/Schema';
import { latestFrame, sessionKeyOf } from '@/services/browser/liveFrames';

/**
 * `GET /api/browser-runs/:id/frame` — the browser's picture right now, as a
 * JPEG: the latest frame of the person's browser while the run is live (the
 * pane asks several times a second), else the page as it stood when the run
 * ended. Session only — it is read too often to spend the API's rate limit —
 * and only within the run's workspace.
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
  const [row] = await db.select({ id: browserRunSchema.id, userId: browserRunSchema.userId, routineRunId: browserRunSchema.routineRunId, status: browserRunSchema.status, shot: browserRunSchema.finalShotUrl }).from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.id, Number(id)))).limit(1);
  if (!row) {
    return new NextResponse(null, { status: 404 });
  }
  const frame = ['queued', 'running', 'waiting'].includes(row.status) ? latestFrame(sessionKeyOf({ ...row, orgId })) : null;
  if (frame) {
    return new Response(new Uint8Array(frame.jpeg), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Frame-Seq': String(frame.seq) } });
  }
  if (row.shot) {
    return NextResponse.redirect(new URL(row.shot, _req.nextUrl.origin), { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
  }
  return new NextResponse(null, { status: 204 });
}
