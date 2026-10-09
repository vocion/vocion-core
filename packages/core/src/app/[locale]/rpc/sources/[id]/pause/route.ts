/**
 * POST /rpc/sources/[id]/pause — pause or resume one connection.
 *
 * Body `{ paused: boolean }`. Admins only, like every other change to what a
 * workspace reads. A paused connection keeps its documents and its credential
 * and reads nothing new until it is resumed (`setSourcePaused`).
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { setSourcePaused } from '@/services/SourceSyncService';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can pause a connection' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }
  let body: { paused?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }
  if (typeof body.paused !== 'boolean') {
    return Response.json({ error: 'Missing paused' }, { status: 400 });
  }
  const found = await setSourcePaused(orgId, Number.parseInt(id, 10), body.paused);
  if (!found) {
    return Response.json({ error: 'Source not found' }, { status: 404 });
  }
  return Response.json({ ok: true, paused: body.paused });
}
