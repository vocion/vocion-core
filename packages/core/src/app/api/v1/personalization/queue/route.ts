import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { Env } from '@/libs/Env';
import { resetQueue } from '@/services/PersonalizationQueueService';
import { ORG_ROLE } from '@/types/Auth';
import { jsonError } from '../../_shared';

/**
 * TEMPORARY — phase 2 deletes this file.
 *
 * DELETE /api/v1/personalization/queue — clear the personalization queue for
 * the caller's org. It exists only because `lead_brief_org_contact_idx` makes
 * a re-fire a no-op, so the flow cannot be tested twice without a way to
 * empty the queue.
 *
 * Three gates, all of them structural: the route is absent unless
 * `VOCION_ALLOW_QUEUE_RESET` is set, the caller must be an org admin, and the
 * delete is scoped to the session's org. It touches `lead_brief` only, so the
 * HubSpot mirror survives and a re-test needs no re-sync.
 */
export async function DELETE() {
  // Unset means the route does not exist, not that it refused.
  if (!Env.VOCION_ALLOW_QUEUE_RESET) {
    return jsonError('NOT_FOUND', 'Not found', 404);
  }

  const { userId, orgId, has } = await clerkAuth();
  if (!userId || !orgId) {
    return jsonError('UNAUTHORIZED', 'Missing or invalid credentials', 401);
  }
  if (!has({ role: ORG_ROLE.ADMIN })) {
    return jsonError('FORBIDDEN', 'Clearing the personalization queue is admin-only', 403);
  }

  const { deleted } = await resetQueue(orgId);

  // A reset is never invisible: it lands on the activity feed like any other
  // event, with who did it and how many rows went.
  const { emitEvent } = await import('@/services/EventService');
  await emitEvent({
    orgId,
    type: 'personalization.queue_reset',
    payload: { deleted },
    invokedBy: userId,
  });

  return NextResponse.json({ deleted });
}
