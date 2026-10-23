import type { RecordActions } from '@/libs/preview/types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { CANDIDATE, offersOwedVerbs } from '@/libs/objects/rowLifecycle';
import { actionRunSchema } from '@/models/Schema';

/**
 * WHAT A RECORD OFFERS A PERSON, wherever it is read — its page and its
 * preview draw the same bar from this (`RecordLifecycle`).
 *
 * A thing owed (`x-owed: true` on its type) carries its lifecycle verbs. A
 * candidate of that type, a proposal still waiting for a person, carries the
 * one decision that is pending on it — the Review item that proposed it
 * (`business_object.review_action_run_id`) — so Approve and Dismiss are made
 * where the record is read instead of somewhere in a queue of fifty
 * (Chris, 2026-10-23, on FU-503's page: "how do I act from this?").
 * @param orgId - Tenant.
 * @param obj - The record, with its type.
 * @param obj.status - Its row status.
 * @param obj.reviewActionRunId - The Review item that proposed it, if it was proposed.
 * @param obj.type - Its type's slug and schema.
 */
export async function recordActionsOf(orgId: string, obj: { status: string | null; reviewActionRunId?: number | null; type?: { slug: string; schema: unknown } | null }): Promise<RecordActions | null> {
  if (!obj.type || !offersOwedVerbs(obj.type.schema)) {
    return null;
  }
  const status = obj.status ?? 'open';
  if (status !== CANDIDATE || !obj.reviewActionRunId) {
    return { objectType: obj.type.slug, status };
  }
  const [run] = await db
    .select({ status: actionRunSchema.status })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, obj.reviewActionRunId)))
    .limit(1);
  return { objectType: obj.type.slug, status, ...(run?.status === 'pending' ? { decideRunId: obj.reviewActionRunId } : {}) };
}
