import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authApi, isErrorResponse, jsonError, readIdParam, writeApiErrorResponse } from '@/app/api/v1/_shared';
import { getDataRoom } from '@/services/DataRoomService';
import { captureSeoBaseline } from '@/services/seo/measurement';
import { readSeoReadiness, renderSeoMeasurementReport } from '@/services/seo/readiness';

/**
 * Download actual client progress, including missing evidence.
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
  const [project, readiness] = await Promise.all([getDataRoom(caller.orgId, id), readSeoReadiness(caller.orgId, id)]);
  if (!project || !readiness) {
    return jsonError('NOT_FOUND', 'Client project not found.', 404);
  }
  return new Response(renderSeoMeasurementReport(project.title, readiness), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="seo-progress-${id}.md"`, 'Cache-Control': 'private, no-store' } });
}

/**
 * Capture a real Search Console observation without replacing the initial baseline.
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
    return jsonError('FORBIDDEN', 'Sign in as the strategy owner to capture measurements.', 403);
  }
  const id = readIdParam((await ctx.params).id, 'project');
  if (isErrorResponse(id)) {
    return id;
  }
  const parsed = z.object({ expectedRevision: z.number().int().nonnegative() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError('VALIDATION_FAILED', 'Include the current roadmap revision.', 400);
  }
  try {
    return NextResponse.json(await captureSeoBaseline(caller.orgId, id, caller.actorId, parsed.data.expectedRevision));
  } catch (error) {
    return writeApiErrorResponse(error);
  }
}
