import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { patchProject, readProject } from '@/app/api/v1/projects/[id]/handlers';

/**
 * `GET /api/v1/projects/:id` — the project as JSON (title, status, meta).
 * A dashboard session or a `vcn_live_` token; the caller's org must own the
 * project. `/api/v1/rooms/:id` answers the same, for callers written before
 * projects were renamed from data rooms (2026-10-27).
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
 * `PATCH /api/v1/projects/:id` — a person editing the project's own knowledge
 * from its page: the wiki (`notes`), the instructions (`rules`), whether the
 * collector may file into it. Everything else changes through the agent's
 * `update_project`, so the page stays one obvious path per field. A
 * dashboard session or a `vcn_live_` token; the caller's org must own the
 * project.
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
