import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { unfileProjectSource } from '@/app/api/v1/projects/[id]/handlers';

/**
 * `DELETE /api/v1/projects/:id/sources?document=<id>` (or `?artifact=<id>`) —
 * take a source out of a project: the undo of a filing, the collector's
 * included. The document stays in the knowledge base; the project forgets
 * the link and will not auto-file that document again. A dashboard session
 * or a `vcn_live_` token; the caller's org must own the project.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  return unfileProjectSource(caller, (await ctx.params).id, req);
}
