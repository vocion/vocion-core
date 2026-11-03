import type { CrmKind, CrmState, Pipeline } from '@/libs/crm/model';
import type { HubspotRecord, HubspotResult } from '@/libs/hubspot/client';
import type { ListField } from '@/libs/lists/spec';
import type { ListActor } from '@/services/lists/service';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { CRM_KINDS, crmListId, crmRecordId, HUBSPOT_OBJECT, mapHubspotRecord, PROPERTIES } from '@/libs/crm/model';
import { db } from '@/libs/DB';
import { listFieldsSchema, validateListValues } from '@/libs/lists/spec';
import { workspaceListSchema as lists, listRecordSchema as records, listRevisionSchema as revisions, crmSyncSchema as syncs } from '@/models/Schema';
import { hubspotClientForOrg } from '@/services/agents/tools/hubspotDirect';
import { installCrm } from '@/services/lists/crm';
import { ListError } from '@/services/lists/service';
import { actAs } from '@/services/workspace/actAs';
import { installOutreachPlanning } from './planning';

function unwrap<T>(result: HubspotResult<T>): T {
  if (!result.ok) {
    throw new ListError(result.error === 'missing_scope' ? `HubSpot permission required: ${result.scope}` : 'HubSpot could not be read. Check its connection and retry.', 502);
  }
  return result.data;
}

export async function requireCrmActor(actor: ListActor, admin = false) {
  const who = await actAs(actor.userId, actor.orgId);
  if (!who || (admin && who.role !== 'admin')) {
    throw new ListError('CRM access is not available', who ? 403 : 404);
  }
  return who;
}

/**
 * A bounded page per request; cursor, records and audit commit atomically.
 * @param actor
 */
export async function syncCrmPage(actor: ListActor) {
  await requireCrmActor(actor, true);
  await installCrm(actor);
  await installOutreachPlanning(actor);
  await db.insert(syncs).values({ projectId: actor.orgId, actorId: actor.userId }).onConflictDoNothing();
  const lease = randomUUID();
  const [claimed] = await db.update(syncs).set({ lease, leaseUntil: new Date(Date.now() + 120000), actorId: actor.userId, status: 'syncing', error: null }).where(and(eq(syncs.projectId, actor.orgId), sql`(${syncs.leaseUntil} is null or ${syncs.leaseUntil} < now())`)).returning();
  if (!claimed) {
    throw new ListError('A CRM sync is already running. Retry shortly.', 409);
  }
  try {
    const connection = await hubspotClientForOrg(actor.orgId);
    if (!connection.ok) {
      throw new ListError('Connect HubSpot in this workspace before syncing.', 409);
    }
    const { client } = connection;
    const configuredPortal = String(connection.sources.find(s => s.configJson?.portalId)?.configJson?.portalId ?? '');
    if (claimed.state && claimed.state.portalId !== configuredPortal) {
      throw new ListError('HubSpot portal changed. Reconcile existing imported records before switching portals.', 409);
    }
    let state = claimed.state;
    if (!state || state.phase >= CRM_KINDS.length) {
      const portalId = String(connection.sources.find(s => s.configJson?.portalId)?.configJson?.portalId ?? '');
      if (!/^\d+$/.test(portalId)) {
        throw new ListError('The HubSpot connection needs a portal ID.', 409);
      }
      if (claimed.state && claimed.state.portalId !== portalId) {
        throw new ListError('HubSpot portal changed. Reconcile the existing imported records before switching portals.', 409);
      }
      const pipelines = unwrap(await client.get<{ results: Pipeline[] }>('/crm/v3/pipelines/deals')).results;
      state = { phase: 0, seen: [], pipelines, owners: {}, currency: null, portalId, cycle: new Date().toISOString(), counts: {} };
    }
    const kind = CRM_KINDS[state.phase]!;
    const page = unwrap(await client.get<{ results: HubspotRecord[]; paging?: { next?: { after: string } } }>(`/crm/v3/objects/${HUBSPOT_OBJECT[kind]}`, {
      limit: '100',
      properties: PROPERTIES[kind].join(','),
      archived: 'false',
      ...(kind !== 'companies' ? { associations: 'companies,contacts,deals' } : {}),
      ...(state.after ? { after: state.after } : {}),
    }));
    if (!Array.isArray(page.results) || (page.paging?.next && !page.paging.next.after)) {
      throw new ListError('HubSpot returned an incomplete page. Retry sync.', 502);
    }
    const next = page.paging?.next?.after;
    if (next && String(next) === state.after) {
      throw new ListError('HubSpot returned the same cursor. Sync stopped safely.', 502);
    }
    const working = state;
    return await db.transaction(async (tx) => {
      const [owned] = await tx.select().from(syncs).where(and(eq(syncs.projectId, actor.orgId), eq(syncs.lease, lease))).for('update');
      if (!owned) {
        throw new ListError('Sync lease expired; retry.', 409);
      }
      const id = crmListId(actor.orgId, kind);
      const [list] = await tx.select().from(lists).where(and(eq(lists.id, id), eq(lists.projectId, actor.orgId), eq(lists.scope, 'workspace'))).for('update');
      if (!list || list.archived) {
        throw new ListError('Restore the CRM List before syncing.', 409);
      }
      const fields = syncFields(list.fields, kind, working);
      const changes = [];
      for (const source of page.results) {
        const recordId = crmRecordId(actor.orgId, working.portalId, kind, source.id);
        const [before] = await tx.select().from(records).where(and(eq(records.id, recordId), eq(records.listId, id)));
        const values = { ...before?.values, ...mapHubspotRecord(kind, source, working) };
        for (const [field, target] of [['company', 'companies'], ['contact', 'contacts'], ['deal', 'deals']] as const) {
          if (!fields.some(f => f.key === field)) {
            continue;
          }
          const external = values[`${field}_hubspot_id`];
          const targetId = external ? crmRecordId(actor.orgId, working.portalId, target, String(external)) : null;
          const [linked] = targetId ? await tx.select({ id: records.id }).from(records).where(and(eq(records.id, targetId), eq(records.listId, crmListId(actor.orgId, target)))) : [];
          values[field] = linked?.id ?? null;
        }
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === 'string' && value.length > 10000) {
            values[key] = `${value.slice(0, 9900)}… [Truncated; full text in HubSpot]`;
          }
        }
        validateListValues(fields, values);
        if (!before) {
          await tx.insert(records).values({ id: recordId, listId: id, values });
        } else if (!isDeepStrictEqual(before.values, values)) {
          await tx.update(records).set({ values, version: before.version + 1, updatedAt: new Date() }).where(and(eq(records.id, recordId), eq(records.listId, id)));
        } else {
          continue;
        }
        changes.push({ id: recordId, before: before?.values ?? null, after: values });
      }
      const seen = [...working.seen, ...page.results.map(r => r.id)];
      // Reconcile only after the full object scan; a failed/interrupted page
      // can never archive unseen records from a later page.
      if (!next) {
        const imported = await tx.select().from(records).where(and(eq(records.listId, id), sql`${records.values} ->> 'hubspot_id' is not null`));
        const present = new Set(seen);
        for (const row of imported) {
          if (!present.has(String(row.values.hubspot_id)) && row.values.archived !== true) {
            const values = { ...row.values, archived: true };
            await tx.update(records).set({ values, version: row.version + 1, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.listId, id)));
            changes.push({ id: row.id, before: row.values, after: values });
          }
        }
      }
      if (changes.length || !isDeepStrictEqual(fields, list.fields)) {
        await tx.update(lists).set({ fields, version: list.version + 1, updatedAt: new Date() }).where(eq(lists.id, id));
        await tx.insert(revisions).values({ listId: id, version: list.version + 1, actorId: actor.userId, change: { source: 'hubspot', cycle: working.cycle, records: changes, fields } });
      }
      const updated: CrmState = { ...working, phase: next ? working.phase : working.phase + 1, after: next ? String(next) : undefined, seen: next ? seen : [], counts: { ...working.counts, [kind]: seen.length } };
      const done = updated.phase >= CRM_KINDS.length;
      await tx.update(syncs).set({ state: updated, status: done ? 'complete' : 'syncing', lease: null, leaseUntil: null, updatedAt: new Date(), ...(done ? { lastCompletedAt: new Date() } : {}) }).where(and(eq(syncs.projectId, actor.orgId), eq(syncs.lease, lease)));
      return { done, counts: updated.counts, phase: CRM_KINDS[updated.phase] ?? 'complete' };
    });
  } catch (error) {
    await db.update(syncs).set({ status: 'failed', error: error instanceof ListError ? error.message : 'Sync failed; the last saved cursor can be resumed.', lease: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(syncs.projectId, actor.orgId), eq(syncs.lease, lease)));
    throw error;
  }
}

function syncFields(existing: ListField[], kind: CrmKind, state: CrmState): ListField[] {
  const sample = mapHubspotRecord(kind, { id: 'schema', properties: {} }, state);
  const fields = existing.map((field) => {
    if (kind === 'deals' && field.key === 'stage' && field.type === 'select') {
      return { ...field, options: [...new Set([...(field.options ?? []), ...state.pipelines.flatMap(p => p.stages.map(s => s.label))])] };
    }
    return field;
  });
  for (const [key, value] of Object.entries(sample)) {
    if (!fields.some(f => f.key === key)) {
      fields.push({ key, label: key.replaceAll('_', ' '), type: key === 'archived' ? 'boolean' : key === 'amount' ? 'number' : key === 'close_date' || key === 'due' ? 'date' : typeof value === 'number' ? 'number' : 'text' });
    }
  }
  return listFieldsSchema.parse(fields);
}
