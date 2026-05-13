/**
 * POST /rpc/sources/[id]/sync — trigger a sync for a configured source.
 *
 * Synchronous: the request hangs for the duration of the crawl. Fine
 * for the web connector with its bounded page count; not fine for
 * Drive/GitHub. The Temporal-backed async variant is queued for the
 * G.2 follow-up.
 *
 * Returns `{ result: { created, updated, unchanged, tombstoned, errors } }`.
 */

import { auth } from '@clerk/nextjs/server';
import { runSync } from '@/services/SourceSyncService';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = await ctx.params;
  const sourceId = Number.parseInt(params.id, 10);
  if (!Number.isInteger(sourceId)) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }
  try {
    const result = await runSync({ orgId, sourceId });
    return Response.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
