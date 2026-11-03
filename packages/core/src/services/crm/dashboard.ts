import type { ListActor } from '@/services/lists/service';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { CRM_KINDS, crmListId } from '@/libs/crm/model';
import { db } from '@/libs/DB';
import { workspaceListSchema as lists, projectSchema, listRecordSchema as records, crmSyncSchema as syncs } from '@/models/Schema';
import { planningListIds } from './planning';
import { requireCrmActor } from './sync';

export async function crmDashboard(actor: ListActor) {
  const who = await requireCrmActor(actor);
  const ids = [...CRM_KINDS.map(kind => crmListId(actor.orgId, kind)), ...planningListIds(actor.orgId)];
  const installed = await db.select({ id: lists.id, title: lists.title }).from(lists).where(and(eq(lists.projectId, actor.orgId), eq(lists.scope, 'workspace'), eq(lists.archived, false), inArray(lists.id, ids)));
  const [sync] = await db.select({ status: syncs.status, counts: sql<Record<string, number>>`${syncs.state} -> 'counts'`, updatedAt: syncs.updatedAt, lastCompletedAt: syncs.lastCompletedAt, error: syncs.error }).from(syncs).where(eq(syncs.projectId, actor.orgId));
  const [project] = await db.select({ dryRun: projectSchema.outboundDryRun }).from(projectSchema).where(eq(projectSchema.id, actor.orgId));
  const active = sql`coalesce(${records.values} ->> 'archived', 'false') != 'true'`;
  const liveList = (kind: typeof CRM_KINDS[number]) => installed.some(l => l.id === crmListId(actor.orgId, kind));
  const leads = liveList('contacts') ? await db.select({ stage: sql<string>`coalesce(nullif(${records.values} ->> 'lifecycle', ''), 'Unclassified')`, count: sql<number>`count(*)::int` }).from(records).where(and(eq(records.listId, crmListId(actor.orgId, 'contacts')), active)).groupBy(sql`1`) : [];
  const deals = liveList('deals') ? await db.select({ pipelineId: sql<string>`coalesce(${records.values} ->> 'pipeline_id', '')`, stageId: sql<string>`coalesce(${records.values} ->> 'stage_id', '')`, pipeline: sql<string>`coalesce(nullif(${records.values} ->> 'pipeline', ''), 'Unassigned')`, stage: sql<string>`coalesce(nullif(${records.values} ->> 'stage', ''), 'Unclassified')`, currency: sql<string>`coalesce(nullif(${records.values} ->> 'currency', ''), 'Unknown currency')`, count: sql<number>`count(*)::int`, amount: sql<string | null>`sum((${records.values} ->> 'amount')::numeric)` }).from(records).where(and(eq(records.listId, crmListId(actor.orgId, 'deals')), active)).groupBy(sql`1, 2, 3, 4, 5`) : [];
  return { dryRun: project?.dryRun ?? true, canSync: who.role === 'admin', sync: sync ?? null, lists: installed, leads, deals };
}
