import type { ArtifactRow } from '@/services/ArtifactService';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactSchema } from '@/models/Schema';

/**
 * WHAT THE PERSON SAW, KEPT WITH WHAT THEY ASKED FOR (Chris, 2026-09-30,
 * feature #268: "Fix header width overflow on mobile app web", filed from
 * chat with a screenshot attached, and nowhere on its page or its contract).
 *
 * The uploads a person sent in the conversation a record was filed from —
 * human `file` artifacts already claimed onto that conversation
 * (`ArtifactService.claimAttachments`) — become the record's own evidence,
 * with the role {@link REPORTED_ROLE}, when it is filed. The feature page
 * shows a reported picture as the screen before, the engineering contract
 * lists them so the engineer can open what the person saw, and Related lists
 * them. A record filed before this resolves them through the conversation it
 * came from, the same way its chat link does.
 */

/** An artifact's role on a record: what the person reported, as they sent it. */
export const REPORTED_ROLE = 'reported';

/**
 * Link the person's uploads in a conversation, sent up to the filing, to the
 * record filed from it. Only uploads that belong to no record yet are
 * linked; one already evidence of another record stays where it is.
 * @param orgId - Tenant.
 * @param objectId - The record just filed.
 * @param conversationId - The conversation it was filed from.
 * @param at - When it was filed: later uploads are not what was reported.
 * @returns The artifacts linked.
 */
export async function linkReportedAttachments(orgId: string, objectId: number, conversationId: number, at: Date = new Date()): Promise<number[]> {
  const rows = await db
    .update(artifactSchema)
    .set({ recordType: 'object', recordId: String(objectId), recordRole: REPORTED_ROLE })
    .where(and(
      eq(artifactSchema.orgId, orgId),
      eq(artifactSchema.conversationId, conversationId),
      eq(artifactSchema.kind, 'file'),
      eq(artifactSchema.lastAuthorKind, 'human'),
      isNull(artifactSchema.recordId),
      lte(artifactSchema.createdAt, at),
    ))
    .returning({ id: artifactSchema.id });
  return rows.map(r => r.id);
}

/**
 * What the person reported with a record: the uploads linked to it as
 * {@link REPORTED_ROLE}, else — a record filed before those were linked —
 * the uploads in the conversation it came from, sent before it was filed.
 * @param orgId - Tenant.
 * @param record - The record.
 * @param record.id - Its id.
 * @param record.createdAt - When it was filed.
 * @param record.conversationId - The conversation it came from (`recordOrigin`), when one is known.
 */
export async function reportedAttachments(orgId: string, record: { id: number; createdAt: Date; conversationId: number | null }): Promise<ArtifactRow[]> {
  const linked = await db
    .select()
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.recordType, 'object'), eq(artifactSchema.recordId, String(record.id)), eq(artifactSchema.recordRole, REPORTED_ROLE)))
    .orderBy(asc(artifactSchema.id));
  if (linked.length > 0 || record.conversationId === null) {
    return linked;
  }
  return db
    .select()
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, orgId),
      eq(artifactSchema.conversationId, record.conversationId),
      eq(artifactSchema.kind, 'file'),
      eq(artifactSchema.lastAuthorKind, 'human'),
      lte(artifactSchema.createdAt, record.createdAt),
    ))
    .orderBy(asc(artifactSchema.id));
}

/**
 * What the person reported with a record, as links the engineer can open:
 * each upload's page in Vocion and, when it is a picture, the picture itself.
 * The contract derived for a task lists them (`factory-dispatch.deriveContract`).
 * @param orgId - Tenant.
 * @param objectId - The record.
 */
export async function reportedLinks(orgId: string, objectId: number): Promise<Array<{ title: string; url: string; file: string | null }>> {
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata, createdAt: businessObjectSchema.createdAt, reviewActionRunId: businessObjectSchema.reviewActionRunId })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, objectId)))
    .limit(1);
  if (!row) {
    return [];
  }
  const { recordOrigin } = await import('@/services/objects/related');
  const origin = await recordOrigin(orgId, { id: row.id, meta: (row.meta ?? {}) as Record<string, unknown>, reviewActionRunId: row.reviewActionRunId }).catch(() => null);
  const sent = await reportedAttachments(orgId, { id: row.id, createdAt: row.createdAt, conversationId: origin?.conversationId ?? null });
  const { appBaseUrl } = await import('@/libs/links');
  const base = appBaseUrl();
  const absolute = (u: string | null) => (u && /^https?:\/\//.test(u) ? u : u && u.startsWith('/') && base ? `${base}${u}` : null);
  return sent.map(a => ({ title: a.title, url: `${base}/dashboard/artifacts/${a.id}`, file: absolute(a.url) }));
}
