import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { patchProject, readProject } from '@/app/api/v1/projects/[id]/handlers';

/**
 * `GET /api/v1/rooms/:id` — the older path for `GET /api/v1/projects/:id`
 * (projects were called data rooms until 2026-10-27). Kept so callers and
 * tokens written against it keep working; new callers use the projects path.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  return readProject(caller, (await ctx.params).id);
}

/**
 * `PATCH /api/v1/rooms/:id` — the older path for `PATCH /api/v1/projects/:id`.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  return patchProject(caller, (await ctx.params).id, req);
}
