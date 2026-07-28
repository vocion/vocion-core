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

import { clerkAuth as auth } from '@/libs/Auth';
import { logger } from '@/libs/Logger';
import { runSync, SyncAlreadyRunningError } from '@/services/SourceSyncService';

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
    // Someone already has this source syncing — a second browser tab, or a
    // scheduled run that started first. Not an error on the caller's part, so
    // say so plainly rather than reporting a server failure.
    if (err instanceof SyncAlreadyRunningError) {
      return Response.json(
        { error: 'This source is already syncing. Wait for it to finish, then try again.' },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error('source sync request failed', {
      sourceId,
      orgId,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
