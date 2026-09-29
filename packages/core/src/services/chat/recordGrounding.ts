/**
 * THE RECORD ON THE PAGE TRAVELS WITH THE TURN.
 *
 * Conversation 378 (2026-09-29), request #201's feature page. The page showed
 * the request, an APPROVED plan (#215) and a Stopped ask; the turn was handed
 * "This page is about the object #201" and nothing else. One turn read the
 * engineering task, took its stale "plan is required" summary for the state
 * of things and said it would write the plan; the next said "I don't have
 * enough context… I can't see the request's details, accepted plan, or any
 * prior triage". Both were one read away from the truth, and neither was
 * handed it.
 *
 * The page's artifacts already travel as canonical (`grounding.ts`); this
 * does the same for the page's RECORD: its fields as they stand, the records
 * filed beneath it (a plan, a task — what the page's sections show), and
 * what is waiting on a person about it (open asks, pending proposals), each
 * with the call that decides it. Read server-side under the caller's org
 * (a client can point at a record, never describe it), when the turn starts.
 */

import type { PageContext } from './pageContext';
import type { OpenDecision } from '@/services/agents/owedDecision';
import { describeOpenDecisions } from '@/services/agents/owedDecision';

/** How much of the record's own fields travel. */
const MAX_FIELDS_CHARS = 5_000;
/** At most this many records beneath it. */
const MAX_CHILDREN = 12;

export type GroundedRecord = { id: number; typeSlug: string; title: string; status: string | null; fields: Record<string, unknown> };
export type GroundedChild = { id: number; typeSlug: string; title: string; status: string | null; state?: string };

/**
 * The block, as the model reads it.
 * @param record - The page's record.
 * @param children - Records filed beneath it.
 * @param decisions - What is waiting on a person about it.
 */
export function describeRecordGrounding(record: GroundedRecord, children: readonly GroundedChild[], decisions: readonly OpenDecision[]): string {
  const kind = record.typeSlug.replace(/[_-]+/g, ' ');
  const fields = JSON.stringify(record.fields);
  const parts = [
    `--- the ${kind} on this page (read now, canonical) ---`,
    `${kind} #${record.id} "${record.title}"${record.status ? ` — status ${record.status}` : ''}. This is the record as it stands; it is what the page shows. Answer from it and never say you cannot see it.`,
    fields.length > MAX_FIELDS_CHARS ? `${fields.slice(0, MAX_FIELDS_CHARS)}… [the rest: read_object ${record.typeSlug} ${record.id}]` : fields,
  ];
  if (children.length > 0) {
    parts.push('', `Filed under it (newest first) — read one by id for its whole record:`, ...children.map(c => `- ${c.typeSlug.replace(/[_-]+/g, ' ')} #${c.id} "${c.title}"${c.status ? ` — ${c.status}` : ''}${c.state ? ` (${c.state})` : ''}`));
  }
  if (decisions.length > 0) {
    parts.push('', 'Waiting on the person about it — when they tell you what to do with one, do it with the call named:', describeOpenDecisions(decisions));
  }
  return parts.join('\n');
}

/**
 * The one line of state a child's fields carry, when they carry one.
 * @param meta
 */
function stateOf(meta: Record<string, unknown>): string | undefined {
  const bits: string[] = [];
  for (const key of ['state', 'runStatus', 'approvedBy', 'approvedAt']) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) {
      bits.push(`${key} ${v.slice(0, 60)}`);
    }
  }
  return bits.length > 0 ? bits.join(', ') : undefined;
}

/**
 * Read and describe the page's record, or null when the page shows none.
 * Never throws: a turn without it is the turn as before.
 * @param orgId - The workspace.
 * @param ctx - The page the turn carried.
 */
export async function buildRecordGrounding(orgId: string, ctx: PageContext | null | undefined): Promise<string | null> {
  const ref = ctx?.record;
  if (ref?.type !== 'object' || !/^\d+$/.test(ref.id)) {
    return null;
  }
  try {
    const id = Number(ref.id);
    const { and, desc, eq, or, sql } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    const { getBusinessObject } = await import('@/services/BusinessObjectService');
    const { openDecisionsOn } = await import('@/services/agents/owedDecision');
    const row = await getBusinessObject(id, orgId);
    if (!row) {
      return null;
    }
    const [children, decisions] = await Promise.all([
      db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, metadata: businessObjectSchema.metadata, typeSlug: businessObjectTypeSchema.slug })
        .from(businessObjectSchema)
        .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
        .where(and(eq(businessObjectSchema.orgId, orgId), or(sql`${businessObjectSchema.metadata}->>'requestId' = ${ref.id}`, sql`${businessObjectSchema.metadata}->>'parentId' = ${ref.id}`)))
        .orderBy(desc(businessObjectSchema.id))
        .limit(MAX_CHILDREN),
      openDecisionsOn(orgId, id),
    ]);
    const typeSlug = (row as { type?: { slug?: string } }).type?.slug ?? ref.objectType ?? 'record';
    return describeRecordGrounding(
      { id: row.id, typeSlug, title: row.title, status: row.status ?? null, fields: (row.metadata ?? {}) as Record<string, unknown> },
      children.map(c => ({ id: c.id, typeSlug: c.typeSlug, title: c.title, status: c.status ?? null, state: stateOf((c.metadata ?? {}) as Record<string, unknown>) })),
      decisions,
    );
  } catch (err) {
    console.warn('record grounding failed', { orgId, record: ref.id, message: (err as Error).message });
    return null;
  }
}
