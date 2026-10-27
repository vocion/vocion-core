import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { unfileProjectSource } from '@/app/api/v1/projects/[id]/handlers';

/**
 * `DELETE /api/v1/rooms/:id/sources` — the older path for
 * `DELETE /api/v1/projects/:id/sources` (projects were called data rooms
 * until 2026-10-27). Same query parameters, same answer.
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
