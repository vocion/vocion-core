/**
 * POST /rpc/sources/[id]/session — keep a sign-in on one connector, from a
 * session file uploaded behind Advanced on its form ("Upload a session file").
 *
 * Body: the file `npm run squarespace:session -- --out` writes, or a bare
 * browser storage state. Admins only, like every other change to a
 * connection. Only a connector that keeps a sign-in takes one, and only for
 * its own domains (`libs/browser/keptSignIn.ts`); the state is sealed under
 * the workspace's key and never sent back.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { acceptSignIn, SignInRefusedError } from '@/services/browser/keptSignIn';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId, userId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can sign a connection in' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'The file is not JSON: upload the session file the sign-in command wrote.' }, { status: 400 });
  }
  try {
    const sourceId = Number.parseInt(id, 10);
    const kept = await acceptSignIn({ orgId, sourceId, raw: body, savedFrom: 'a session file uploaded in the app', savedBy: userId ?? null });
    const { resumeWaitingOnSignIn } = await import('@/services/publish/squarespaceSignIn');
    const resumed = kept.site ? await resumeWaitingOnSignIn(orgId, { sourceId, siteUrl: kept.site }).catch(() => []) : [];
    return Response.json({ ok: true, signIn: kept, resumed });
  } catch (error) {
    if (error instanceof SignInRefusedError) {
      return Response.json({ error: error.message, field: error.field }, { status: error.status });
    }
    console.error('[rpc/sources/session] could not keep a sign-in', { errorName: error instanceof Error ? error.name : 'unknown' });
    return Response.json({ error: 'Could not keep the sign-in.' }, { status: 500 });
  }
}
