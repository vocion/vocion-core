/**
 * THE OTHER DECISIONS ABOUT THE SAME THING — so one visit settles them all.
 *
 * A prospect's reply raised three items in Review on 2026-10-29: an ask ("reply,
 * and decide where the deal stands"), the reply draft, and a stage change on
 * the deal. Each page showed only itself, so the person decided one, went back
 * to the queue, found the next, and lost their place. Each decision about an
 * email thread or a CRM record now names the other open ones about the same
 * thread or record, with one link to each.
 *
 * Matched by id only, never by words: an open ask whose `object_refs` names
 * one of the ids, or a pending proposal whose input or evidence carries one.
 * Ids are Gmail thread ids and CRM record ids, long enough that a match is
 * the same thing; a short id is not matched at all.
 */

import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, askSchema } from '@/models/Schema';
import { describeActionRun } from './describeActionRun';
import { inboxHref } from './inboxRef';

/** An id shorter than this could be anything: no match is attempted. */
const MIN_ID = 6;
/** The most named; the queue has the rest. */
const MAX_RELATED = 5;

export type RelatedItem = { href: string; title: string; kind: 'ask' | 'proposal' };

/**
 * The bare ids worth matching, from thread ids and record keys (`deals:123`,
 * `hubspot:deals:123`, `gmail-thread:abc`). Pure.
 * @param keys - Thread ids and record keys.
 */
export function matchableIds(keys: readonly string[]): string[] {
  const ids = keys.map(k => k.slice(k.lastIndexOf(':') + 1).trim()).filter(id => id.length >= MIN_ID && /^[\w-]+$/.test(id));
  return [...new Set(ids)];
}

/**
 * The open decisions about the same threads or records, this one aside.
 * @param orgId - The workspace.
 * @param keys - The thread ids and record keys this decision is about.
 * @param self - This decision, left out.
 * @param self.kind - Ask or proposal.
 * @param self.id - Its id.
 */
export async function relatedOpenItems(orgId: string, keys: readonly string[], self: { kind: 'ask' | 'proposal'; id: number }): Promise<RelatedItem[]> {
  const ids = matchableIds(keys);
  if (ids.length === 0) {
    return [];
  }
  const inRun = or(...ids.map(id => sql`(${actionRunSchema.input}::text like ${`%${id}%`} or coalesce(${actionRunSchema.proposal}->'evidence', '[]'::jsonb)::text like ${`%${id}%`})`));
  const inAsk = sql`exists (select 1 from jsonb_array_elements(${askSchema.objectRefs}) r where ${or(...ids.map(id => sql`r->>'id' = ${id} or r->>'id' like ${`%:${id}`}`))})`;
  const [runs, asks] = await Promise.all([
    db
      .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input, proposal: actionRunSchema.proposal, invokedBy: actionRunSchema.invokedBy })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending'), inRun, self.kind === 'proposal' ? ne(actionRunSchema.id, self.id) : undefined))
      .orderBy(desc(actionRunSchema.id))
      .limit(MAX_RELATED),
    db
      .select({ id: askSchema.id, title: askSchema.title })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), inAsk, self.kind === 'ask' ? ne(askSchema.id, self.id) : undefined))
      .orderBy(desc(askSchema.id))
      .limit(MAX_RELATED),
  ]);
  return [
    ...asks.map(a => ({ href: inboxHref('ask', a.id), title: a.title, kind: 'ask' as const })),
    ...runs.map(r => ({ href: inboxHref('proposal', r.id), title: describeActionRun({ ...r, proposal: r.proposal as Record<string, unknown> | null }).title, kind: 'proposal' as const })),
  ].slice(0, MAX_RELATED);
}
