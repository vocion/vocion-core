/**
 * FILING STARTS THE WORK (backlog 038). A record that exists says so.
 *
 * Every create path for a business object — the dashboard, an agent's
 * approved proposal, a worker writing over the API, a service — calls this
 * once the row is in, so an automation can act on the record the moment it
 * exists. Before this nothing did: a P1 filed in chat sat in Proposed until a
 * person noticed it, because the only intake listened for an outside
 * `request.created` nobody posts from inside Vocion.
 *
 * Never fails the write that raised it: the row is already committed, and an
 * event that cannot be recorded is a warning, not a lost record.
 */

import type { ObjectCreatedPayload } from '@/services/EventService';

/** Where a record came from, as the create path knows it. */
export type ObjectOrigin = {
  source: 'app' | 'proposal' | 'api' | 'service';
  conversationId?: number | null;
  /** A user id, `agent:<slug>`, `token:<id>` or `system`. */
  actor?: string | null;
  /** True when a person asked for it. Defaults from the actor: anything but an agent, a token or the system. */
  byPerson?: boolean;
};

/**
 * Whether an actor id names a person rather than a machine.
 * @param actor - A user id, `agent:<slug>`, `token:<id>`, `system`, …
 */
export function actorIsPerson(actor: string | null | undefined): boolean {
  const a = String(actor ?? '').trim();
  return a !== '' && a !== 'system' && a !== 'unknown' && !/^(?:agent|token|automation|mission|worker_run|workflow|event|webhook|trust-ladder)\b/.test(a);
}

/**
 * The payload an `object.created` event carries. Pure, so the shape is tested
 * without a bus.
 * @param orgId - Tenant.
 * @param object - The row as written.
 * @param object.id - Its id.
 * @param object.title - Its title.
 * @param objectType - Its type's slug.
 * @param origin - Where it came from.
 */
export function objectCreatedPayload(orgId: string, object: { id: number; title: string }, objectType: string, origin: ObjectOrigin): ObjectCreatedPayload {
  const actor = origin.actor?.trim() || 'system';
  return {
    orgId,
    objectId: object.id,
    objectType,
    title: object.title.slice(0, 200),
    source: origin.source,
    conversationId: typeof origin.conversationId === 'number' && origin.conversationId > 0 ? origin.conversationId : null,
    actor,
    byPerson: origin.byPerson ?? actorIsPerson(actor),
  };
}

/**
 * Raise `object.created` for a row that was just written.
 * @param orgId - Tenant.
 * @param object - The row.
 * @param object.id - Its id.
 * @param object.title - Its title.
 * @param objectType - Its type's slug.
 * @param origin - Where it came from.
 */
export async function announceObjectCreated(orgId: string, object: { id: number; title: string }, objectType: string, origin: ObjectOrigin): Promise<void> {
  try {
    // Dynamic, like every other emitter: the bus imports the automation
    // service, which reaches the create paths that call this.
    const { emitEvent, OBJECT_CREATED } = await import('@/services/EventService');
    await emitEvent({
      orgId,
      type: OBJECT_CREATED,
      payload: objectCreatedPayload(orgId, object, objectType, origin),
      dedupeKey: `${OBJECT_CREATED}:${object.id}`,
      invokedBy: origin.actor?.trim() || 'system',
      dispatchMode: 'auto',
    });
  } catch (error) {
    console.warn(`[objects] could not raise object.created for #${object.id}`, error);
  }
}
