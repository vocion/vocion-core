/**
 * DELETE /rpc/sources/[id] — remove a source and everything ingested from it.
 *
 * `knowledge_document` and `source_sync_checkpoint` both cascade off
 * `knowledge_source.id`, so this is a single irreversible delete — there's
 * no undo, no soft-delete flag. Admin-only, same bar as setting credentials
 * (`[id]/credentials/route.ts`), since removing a source is at least as
 * consequential as connecting one.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { deleteSource } from '@/services/SourceSyncService';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can delete sources' }, { status: 403 });
  }
  const params = await ctx.params;
  const sourceId = Number.parseInt(params.id, 10);
  if (!Number.isInteger(sourceId)) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }
  const deleted = await deleteSource(orgId, sourceId);
  if (!deleted) {
    return Response.json({ error: 'Source not found' }, { status: 404 });
  }
  return Response.json({ ok: true });
}
