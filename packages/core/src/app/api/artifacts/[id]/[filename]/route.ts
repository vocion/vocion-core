import type { NextRequest } from 'next/server';
import { serveArtifact } from '../_serve';

/**
 * `GET /api/artifacts/:id/:filename` — the canonical served URL; the filename sets the content type and download name.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; filename: string }> }) {
  const { id, filename } = await ctx.params;
  return serveArtifact(req, id, filename);
}
