import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { exportProject } from '@/app/api/v1/projects/[id]/handlers';

/**
 * `GET /api/v1/rooms/:id/export` — the older path for
 * `GET /api/v1/projects/:id/export` (projects were called data rooms until
 * 2026-10-27). The same markdown bundle.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  return exportProject(caller, (await ctx.params).id);
}
