/**
 * `/rpc/sources/[id]` — edit or delete one configured source.
 *
 *   PATCH  → replace the source's config from { configJson }
 *   DELETE → remove the source and everything ingested from it
 *
 * The Sources page's Edit dialog posts here. Editing a source is how a changed
 * instance URL, an added collection or a different page size gets applied
 * without deleting and re-adding — which would throw away the ingested
 * documents and their embeddings.
 */

import { ZodError } from 'zod';
import { clerkAuth as auth } from '@/libs/Auth';
import { logger } from '@/libs/Logger';
import { deleteSource, updateSourceConfig } from '@/services/SourceSyncService';

/**
 * Read and check the source id out of the route params.
 * @param ctx - Route context carrying the dynamic segments.
 */
async function readSourceId(ctx: { params: Promise<{ id: string }> }): Promise<number | null> {
  const params = await ctx.params;
  const sourceId = Number.parseInt(params.id, 10);
  return Number.isInteger(sourceId) ? sourceId : null;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sourceId = await readSourceId(ctx);
  if (sourceId === null) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }
  let body: { configJson?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }
  if (!body.configJson) {
    return Response.json({ error: 'Missing configJson' }, { status: 400 });
  }
  try {
    const updated = await updateSourceConfig({ orgId, sourceId, configJson: body.configJson });
    return Response.json({ source: updated });
  } catch (err) {
    // A config the connector's schema rejects is the caller's mistake, and its
    // message names the field — worth passing back rather than a bare 500.
    if (err instanceof ZodError) {
      return Response.json({ error: err.issues.map(issue => issue.message).join('; ') }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error('source update failed', { sourceId, orgId, error: message });
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sourceId = await readSourceId(ctx);
  if (sourceId === null) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }
  try {
    const { documentsDeleted } = await deleteSource(orgId, sourceId);
    return Response.json({ documentsDeleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('source delete failed', { sourceId, orgId, error: message });
    return Response.json({ error: message }, { status: 400 });
  }
}
