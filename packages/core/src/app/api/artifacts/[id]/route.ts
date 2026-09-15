import type { NextRequest } from 'next/server';
import { serveArtifact } from './_serve';

/** `GET /api/artifacts/:id` — an artifact row id or a content-addressed file id; the filename is inferred. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return serveArtifact(req, id);
}
