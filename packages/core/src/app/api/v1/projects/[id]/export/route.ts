import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { exportProject } from '@/app/api/v1/projects/[id]/handlers';

/**
 * `GET /api/v1/projects/:id/export` — the whole project as one markdown file:
 * the "download context for an LLM" bundle. Same text `read_project` hands
 * the agent, so what a person pastes into a chat is what the agent wrote from.
 * A dashboard session or a `vcn_live_` token; the caller's org must own the
 * project.
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
