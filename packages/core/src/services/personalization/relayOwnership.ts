/**
 * Hand back what HubSpot gave the wrong person when an enrollment ran as
 * another user.
 *
 * An inbox connected under someone else's HubSpot user can only enroll as
 * that user (`senderInboxes.ts`), and HubSpot then makes them the owner of
 * every task the sequence creates and of the contact when it had no owner.
 * The tasks arrive over days (a LinkedIn step on day 2, an InMail on day 5),
 * so this cannot be done once at Enroll: it runs after every contacts sync
 * (every 15 minutes) and moves:
 *
 *   - each open task owned by the relay user, on a contact the platform
 *     enrolled through them, created after that enrollment, to the sender;
 *   - the contact itself back to its owner before the enrollment, or to the
 *     sender when it had none, while the relay user still owns it.
 *
 * Nothing else the relay user owns is touched: their own tasks on other
 * contacts, and tasks on these contacts from before the enrollment, stay.
 */

import type { HubspotClient } from '@/libs/hubspot/client';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';

/** How far back an enrollment's relay is honoured: the longest rung runs about three weeks. */
const WINDOW_DAYS = 45;

type Relay = { senderOwnerId: string; relayOwnerId: string; ownerBefore: string | null };

export type RelayedEnrollment = Relay & { contactId: string; enrolledAt: Date };

/**
 * Enrollments in the window that ran as another user, newest per contact.
 * @param orgId
 * @param now
 */
export async function relayedEnrollments(orgId: string, now: Date = new Date()): Promise<RelayedEnrollment[]> {
  const rows = await db
    .select({ input: actionRunSchema.input, result: actionRunSchema.result, executedAt: actionRunSchema.executedAt })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'personalization.enroll'),
      eq(actionRunSchema.status, 'done'),
      gte(actionRunSchema.executedAt, new Date(now.getTime() - WINDOW_DAYS * 86_400_000)),
      sql`${actionRunSchema.result}->'relay' IS NOT NULL AND jsonb_typeof(${actionRunSchema.result}->'relay') = 'object'`,
    ));
  const byContact = new Map<string, RelayedEnrollment>();
  for (const row of rows) {
    const relay = (row.result as { relay?: Relay } | null)?.relay;
    const contactId = String((row.input as { contactRef?: string }).contactRef ?? '').split(':')[1];
    if (!relay?.relayOwnerId || !relay.senderOwnerId || !contactId || !row.executedAt) {
      continue;
    }
    const seen = byContact.get(contactId);
    if (!seen || seen.enrolledAt < row.executedAt) {
      byContact.set(contactId, { ...relay, contactId, enrolledAt: row.executedAt });
    }
  }
  return [...byContact.values()];
}

type TaskRow = { id: string; properties: { hubspot_owner_id?: string | null; hs_task_status?: string | null; hs_createdate?: string | null } };

/**
 * The moves to make, from what HubSpot holds now. Pure.
 * @param enrollments
 * @param contactOwners - Current owner per contact id.
 * @param tasksByContact - Open tasks per contact id.
 */
export function planHandBack(
  enrollments: RelayedEnrollment[],
  contactOwners: Record<string, string | null>,
  tasksByContact: Record<string, TaskRow[]>,
): { contacts: Array<{ id: string; ownerId: string }>; tasks: Array<{ id: string; ownerId: string }> } {
  const contacts: Array<{ id: string; ownerId: string }> = [];
  const tasks: Array<{ id: string; ownerId: string }> = [];
  for (const e of enrollments) {
    const owner = contactOwners[e.contactId];
    if (owner === e.relayOwnerId && e.ownerBefore !== e.relayOwnerId) {
      contacts.push({ id: e.contactId, ownerId: e.ownerBefore ?? e.senderOwnerId });
    }
    for (const t of tasksByContact[e.contactId] ?? []) {
      const created = t.properties.hs_createdate ? Date.parse(t.properties.hs_createdate) : Number.NaN;
      if (t.properties.hubspot_owner_id === e.relayOwnerId && t.properties.hs_task_status !== 'COMPLETED' && created >= e.enrolledAt.getTime() - 60_000) {
        tasks.push({ id: t.id, ownerId: e.senderOwnerId });
      }
    }
  }
  return { contacts, tasks };
}

/**
 * Read HubSpot, move what needs moving. Returns what moved.
 * @param orgId
 * @param client - Injected in tests; resolved from the org otherwise.
 */
export async function handBackRelayedOwnership(orgId: string, client?: HubspotClient): Promise<{ contacts: number; tasks: number } | null> {
  const enrollments = await relayedEnrollments(orgId);
  if (enrollments.length === 0) {
    return null;
  }
  let hs = client;
  if (!hs) {
    const { hubspotClientForOrg } = await import('@/services/agents/tools/hubspotDirect');
    const resolved = await hubspotClientForOrg(orgId);
    if (!resolved.ok) {
      return null;
    }
    hs = resolved.client;
  }

  const contactOwners: Record<string, string | null> = {};
  const tasksByContact: Record<string, TaskRow[]> = {};
  for (let i = 0; i < enrollments.length; i += 100) {
    const batch = enrollments.slice(i, i + 100);
    const read = await hs.post<{ results?: Array<{ id: string; properties?: { hubspot_owner_id?: string | null } }> }>(
      '/crm/v3/objects/contacts/batch/read',
      { properties: ['hubspot_owner_id'], inputs: batch.map(e => ({ id: e.contactId })) },
    );
    for (const c of read.ok ? read.data.results ?? [] : []) {
      contactOwners[c.id] = c.properties?.hubspot_owner_id || null;
    }
    const assoc = await hs.post<{ results?: Array<{ from?: { id?: string }; to?: Array<{ toObjectId?: string | number }> }> }>(
      '/crm/v4/associations/contacts/tasks/batch/read',
      { inputs: batch.map(e => ({ id: e.contactId })) },
    );
    const taskToContact = new Map<string, string>();
    for (const r of assoc.ok ? assoc.data.results ?? [] : []) {
      for (const t of r.to ?? []) {
        if (r.from?.id && t.toObjectId !== undefined) {
          taskToContact.set(String(t.toObjectId), r.from.id);
        }
      }
    }
    const taskIds = [...taskToContact.keys()];
    for (let j = 0; j < taskIds.length; j += 100) {
      const tasks = await hs.post<{ results?: TaskRow[] }>(
        '/crm/v3/objects/tasks/batch/read',
        { properties: ['hubspot_owner_id', 'hs_task_status', 'hs_createdate'], inputs: taskIds.slice(j, j + 100).map(id => ({ id })) },
      );
      for (const t of tasks.ok ? tasks.data.results ?? [] : []) {
        const contactId = taskToContact.get(t.id);
        if (contactId) {
          (tasksByContact[contactId] ??= []).push(t);
        }
      }
    }
  }

  const plan = planHandBack(enrollments, contactOwners, tasksByContact);
  for (let i = 0; i < plan.tasks.length; i += 100) {
    await hs.post('/crm/v3/objects/tasks/batch/update', {
      inputs: plan.tasks.slice(i, i + 100).map(t => ({ id: t.id, properties: { hubspot_owner_id: t.ownerId } })),
    });
  }
  for (let i = 0; i < plan.contacts.length; i += 100) {
    await hs.post('/crm/v3/objects/contacts/batch/update', {
      inputs: plan.contacts.slice(i, i + 100).map(c => ({ id: c.id, properties: { hubspot_owner_id: c.ownerId } })),
    });
  }
  return { contacts: plan.contacts.length, tasks: plan.tasks.length };
}
