import type { TurnRecord } from '@/libs/factory/liveStatus';
import type { WrittenVersion } from '@/libs/versions/versionRef';
import type { RecordRef } from '@/services/chat/pageContext';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { historyRefId } from '@/libs/versions/versionRef';
import { hasReportPage, recordHrefFrom } from '@/libs/workspace/recordHref';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';
import { recordLinksForOrg } from '@/services/objects/recordHref';

/**
 * THE RECORDS A TURN FILED OR CHANGED, as the chat's microcards read them.
 *
 * Built from the turn's typed events — `record_created` for what it filed,
 * `version_written` for what it changed, with the fields and the version the
 * write made — never from the reply's words. Each carries its page, and
 * whether its type has a report page (so a live status to poll).
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
  const ids = [...new Set([...filed, ...latest.keys()])];
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, type: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .leftJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, ids)));
  const links = await recordLinksForOrg(orgId);
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) {
      return [];
    }
    const version = latest.get(id);
    const made = filed.has(id);
    return [{
      id,
      title: row.title,
      href: recordHrefFrom(links, { objectType: row.type, id }),
      filed: made,
      change: !made && version ? { fields: turn.fields.get(`object:${id}`) ?? [], version, historyRef: historyRefId(id, version) } : null,
      hasStatus: hasReportPage(links, row.type),
    }];
  });
}
