import { NextResponse } from 'next/server';
import { authApi, isErrorResponse, jsonError, readIdParam, writeApiErrorResponse } from '@/app/api/v1/_shared';
import { verifySeoPublication } from '@/services/seo/publicationVerification';

/**
 * Check only the stored published URL; workspace and actor come from the authenticated session.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  if (caller.source !== 'session') {
    return jsonError('FORBIDDEN', 'Sign in as the client strategy owner to verify publication.', 403);
  }
  const id = readIdParam((await ctx.params).id, 'page');
  if (isErrorResponse(id)) {
    return id;
  }
  try {
    return NextResponse.json(await verifySeoPublication(caller.orgId, id, caller.actorId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return writeApiErrorResponse(error);
  }
}
