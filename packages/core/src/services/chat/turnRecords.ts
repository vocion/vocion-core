import type { TurnRecord } from '@/libs/factory/liveStatus';
import type { WrittenVersion } from '@/libs/versions/versionRef';
import type { RecordRef } from '@/services/chat/pageContext';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { historyRefId } from '@/libs/versions/versionRef';
import { hasReportPage, recordHrefFrom } from '@/libs/workspace/recordHref';
import { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, conversationMessageSchema, conversationSchema, toolCallSchema } from '@/models/Schema';
import { recordLinksForOrg } from '@/services/objects/recordHref';

/**
 * THE RECORDS A THREAD IS ABOUT, as the chat's microcards read them.
 *
 * Two reads, both typed, neither from the reply's words:
 *   - {@link turnRecordsOf}: what ONE turn filed or changed, from its own
 *     `record_created` and `version_written` events (the live `turn_records`
 *     event, with what each change wrote);
 *   - {@link conversationRecords}: what the THREAD is about, from the
 *     records: every record the conversation's own actions filed
 *     (`action_run.proposal.origin.conversationId` → `result.objectId`), and
 *     the records its latest turn read or wrote by id. It survives a reload
 *     because it is read from rows, not from events that vanish (Chris,
 *     2026-09-30, #269: "Stuck?" in the thread that filed it, and no line
 *     saying where it was).
 */

/**
 * The RECORD a tool call named, when its input says it is one: an `id` beside
 * an object type, an `object_id`, or an action's `objectId`. An `id` with no
 * type beside it may be an ask or a run, and is not read as a record.
 */
const namedRecordId = sql<string | null>`coalesce(
  case when ${toolCallSchema.input} ? 'object_type' or ${toolCallSchema.input} ? 'objectType' then ${toolCallSchema.input}->>'id' end,
  ${toolCallSchema.input}->>'object_id',
  ${toolCallSchema.input}#>>'{action_input,objectId}'
)`;

/** How many microcards a turn carries at most. */
export const THREAD_RECORDS_SHOWN = 3;

/**
 * The records this conversation's own actions filed, newest first — the one
 * definition, read by the card pass (a build card that names no request is for
 * the one the thread filed, `cardBackstop.buildOrFiling`) and by the chat.
 * @param orgId - Tenant.
 * @param conversationId - The thread.
 * @param limit - At most this many.
 */
export async function threadRecordIds(orgId: string, conversationId: number, limit = 10): Promise<number[]> {
  return (await threadFilings(orgId, conversationId, limit)).map(f => f.id);
}

async function threadFilings(orgId: string, conversationId: number, limit: number): Promise<Array<{ id: number; at: Date }>> {
  const rows = await db
    .select({ id: sql<string>`${actionRunSchema.result} ->> 'objectId'`, at: actionRunSchema.createdAt })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.status, 'done'),
      sql`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId' = ${String(conversationId)}`,
      sql`${actionRunSchema.result} ->> 'objectId' is not null`,
    ))
    .orderBy(desc(actionRunSchema.id))
    .limit(limit);
  const seen = new Set<number>();
  return rows.flatMap((r) => {
    const id = Number(r.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [{ id, at: r.at }];
  });
}

/**
 * Records in this org, as microcards: title, page, and whether the type has a
 * report page (so a live status to poll). Order kept; missing ids dropped.
 * @param orgId - Tenant.
 * @param ids - The records, in order.
 * @param opts - What the caller knows about each.
 * @param opts.filed - Those the thread or turn made.
 * @param opts.changes - What a turn's write changed, by record.
 */
async function describeRecords(orgId: string, ids: readonly number[], opts: { filed: ReadonlySet<number>; changes?: ReadonlyMap<number, TurnRecord['change']> }): Promise<TurnRecord[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, type: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .leftJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, [...ids])));
  const links = await recordLinksForOrg(orgId);
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) {
      return [];
    }
    const made = opts.filed.has(id);
    return [{
      id,
      title: row.title,
      href: recordHrefFrom(links, { objectType: row.type, id }),
      filed: made,
      change: made ? null : opts.changes?.get(id) ?? null,
      hasStatus: hasReportPage(links, row.type),
    }];
  });
}

/**
 * What one turn filed and changed, from its typed events.
 * @param orgId - Tenant.
 * @param turn - What the turn's events said.
 * @param turn.created - Records it created.
 * @param turn.written - Versions it wrote.
 * @param turn.fields - The fields each write changed, by `<type>:<id>`.
 */
export async function turnRecordsOf(orgId: string, turn: { created: readonly RecordRef[]; written: readonly WrittenVersion[]; fields: ReadonlyMap<string, string[]> }): Promise<TurnRecord[]> {
  const filed = new Set(turn.created.filter(r => r.type === 'object' && /^\d+$/.test(r.id)).map(r => Number(r.id)));
  const latest = new Map<number, number>();
  for (const v of turn.written) {
    if (v.ref.type === 'object' && /^\d+$/.test(v.ref.id)) {
      latest.set(Number(v.ref.id), Math.max(latest.get(Number(v.ref.id)) ?? 0, v.to));
    }
  }
  const changes = new Map([...latest].map(([id, version]) => [id, { fields: turn.fields.get(`object:${id}`) ?? [], version, historyRef: historyRefId(id, version) }]));
  return describeRecords(orgId, [...new Set([...filed, ...latest.keys()])], { filed, changes });
}

/**
 * WHAT THIS THREAD IS ABOUT: the records its own actions filed, newest
 * first, then the records its latest turn read or wrote by id, newest first
 * — one each, at most {@link THREAD_RECORDS_SHOWN}. Null when the thread is
 * not in this org.
 * @param orgId - Tenant.
 * @param conversationId - The thread.
 */
export async function conversationRecords(orgId: string, conversationId: number): Promise<TurnRecord[] | null> {
  const [conv] = await db.select({ id: conversationSchema.id }).from(conversationSchema).where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId))).limit(1);
  if (!conv) {
    return null;
  }
  // The latest turn starts at the person's last message.
  const [lastAsk] = await db
    .select({ at: conversationMessageSchema.createdAt })
    .from(conversationMessageSchema)
    .where(and(eq(conversationMessageSchema.conversationId, conversationId), eq(conversationMessageSchema.role, 'user')))
    .orderBy(desc(conversationMessageSchema.createdAt))
    .limit(1);
  const [filings, touched] = await Promise.all([
    threadFilings(orgId, conversationId, 10),
    lastAsk
      ? db
          .select({ named: namedRecordId, at: toolCallSchema.createdAt })
          .from(toolCallSchema)
          .where(and(eq(toolCallSchema.orgId, orgId), eq(toolCallSchema.conversationId, conversationId), gt(toolCallSchema.createdAt, lastAsk.at)))
          .orderBy(desc(toolCallSchema.createdAt))
          .limit(200)
      : Promise.resolve([]),
  ]);
  const ids: number[] = [];
  for (const id of [...filings.map(f => f.id), ...touched.map(t => Number(t.named))]) {
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) {
      ids.push(id);
    }
  }
  // Described first, capped after: an id that names no record here (an ask,
  // a run) drops out rather than taking a place.
  const described = await describeRecords(orgId, ids.slice(0, 20), { filed: new Set(filings.map(f => f.id)) });
  return described.slice(0, THREAD_RECORDS_SHOWN);
}
