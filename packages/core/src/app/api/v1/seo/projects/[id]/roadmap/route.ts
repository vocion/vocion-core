import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authApi, isErrorResponse, jsonError, readIdParam, writeApiErrorResponse } from '@/app/api/v1/_shared';
import { readSeoRoadmap, roadmapSchema, updateSeoRoadmap } from '@/services/seo/roadmap';

/**
 * Read a roadmap inside the authenticated workspace.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await ctx.params).id, 'project');
  if (isErrorResponse(id)) {
    return id;
  }
  try {
    return NextResponse.json(await readSeoRoadmap(caller.orgId, id, caller.actorId));
  } catch (error) {
    return writeApiErrorResponse(error);
  }
}

/**
 * A human owner edits execution planning; publishing retains its own gates.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  if (caller.source !== 'session') {
    return jsonError('FORBIDDEN', 'Sign in as the strategy owner to edit this roadmap.', 403);
  }
  const id = readIdParam((await ctx.params).id, 'project');
  if (isErrorResponse(id)) {
    return id;
  }
  const parsed = z.object({ expectedRevision: z.number().int().nonnegative(), roadmap: roadmapSchema }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError('VALIDATION_FAILED', parsed.error.issues.map(i => i.message).join('; '), 400);
  }
  try {
    return NextResponse.json(await updateSeoRoadmap(caller.orgId, id, caller.actorId, parsed.data.expectedRevision, parsed.data.roadmap));
  } catch (error) {
    return writeApiErrorResponse(error);
  }
}
