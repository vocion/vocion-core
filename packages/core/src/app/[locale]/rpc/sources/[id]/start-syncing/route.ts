/**
 * POST /rpc/sources/[id]/start-syncing — give a source its schedules and
 * start its first sync (#1080).
 *
 * For the add form that stores a credential after the source exists (Strapi):
 * it creates the source with `startSyncing: false`, stores the credential,
 * then calls this, so the first sync reads with the credential instead of
 * starting without one and being skipped. Admins only, like adding a source.
 *
 * Returns `{ firstSync }`: `started`, `not_a_syncing_connector` or `failed`.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { startSourceSyncing } from '@/services/connect/newSourceSync';
import { getSourceById } from '@/services/SourceSyncService';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can start a source syncing' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const sourceId = Number.parseInt(id, 10);
  if (!Number.isInteger(sourceId)) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }
  const source = await getSourceById(orgId, sourceId);
  if (!source) {
    return Response.json({ error: 'Source not found' }, { status: 404 });
  }
  const connectorSlug = (source.config?._connector as string | undefined) ?? source.slug;
  const firstSync = await startSourceSyncing({ orgId, sourceId, sourceSlug: source.slug, connectorSlug });
  return Response.json({ firstSync });
}
