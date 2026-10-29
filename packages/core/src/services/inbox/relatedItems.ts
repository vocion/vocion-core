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
 * Matched on the SUBJECT only, by exact record key (`gmail-thread:<id>`,
 * `deals:<id>`): a proposal's subject is what its action declares
 * (`Action.subjectRefs`), an ask's is what its `object_refs` name
 * (`askSubjectKeys`). Never a key-suffix scrape of the input (a shared
 * `sequenceId` related every enrollment in it) and never a substring of the
 * input's text (deal 640012 inside 16400123).
 */

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { getAction } from '@/libs/actions/registry';
import { db } from '@/libs/DB';
import { actionRunSchema, askSchema } from '@/models/Schema';
import { askSubjectKeys } from './askRefs';
import { describeActionRun } from './describeActionRun';
import { inboxHref } from './inboxRef';

/** The most named; the queue has the rest. */
const MAX_RELATED = 5;
/** How many open items one read looks across, newest first. */
const SCAN = 500;

export type RelatedItem = { href: string; title: string; kind: 'ask' | 'proposal' };

/**
 * The records a proposal is about, as its action declares them; none when the
 * action declares nothing or its input does not read. Pure.
 * @param run - The proposal.
 * @param run.actionId - Its action.
 * @param run.input - Its input.
 */
export function proposalSubjectKeys(run: { actionId: string; input: Record<string, unknown> | null }): string[] {
  const subjectRefs = getAction(run.actionId)?.subjectRefs;
  if (!subjectRefs) {
    return [];
  }
  try {
    return subjectRefs((run.input ?? {}) as never).filter(k => typeof k === 'string' && k.includes(':'));
  } catch {
    return [];
  }
}

/**
 * The open decisions about the same threads or records, this one aside.
 * @param orgId - The workspace.
 * @param keys - The record keys this decision is about (`proposalSubjectKeys`, `askSubjectKeys`).
 * @param self - This decision, left out.
 * @param self.kind - Ask or proposal.
 * @param self.id - Its id.
 */
export async function relatedOpenItems(orgId: string, keys: readonly string[], self: { kind: 'ask' | 'proposal'; id: number }): Promise<RelatedItem[]> {
  const wanted = new Set(keys);
  if (wanted.size === 0) {
    return [];
  }
  const touches = (subject: readonly string[]) => subject.some(k => wanted.has(k));
  const [runs, asks] = await Promise.all([
    db
      .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input, proposal: actionRunSchema.proposal, invokedBy: actionRunSchema.invokedBy })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending'), self.kind === 'proposal' ? ne(actionRunSchema.id, self.id) : undefined))
      .orderBy(desc(actionRunSchema.id))
      .limit(SCAN),
    db
      .select({ id: askSchema.id, title: askSchema.title, objectRefs: askSchema.objectRefs, contextUrl: askSchema.contextUrl })
      .from(askSchema)
      .where(and(
        eq(askSchema.orgId, orgId),
        eq(askSchema.status, 'open'),
        sql`(jsonb_array_length(${askSchema.objectRefs}) > 0 or ${askSchema.contextUrl} is not null)`,
        self.kind === 'ask' ? ne(askSchema.id, self.id) : undefined,
      ))
      .orderBy(desc(askSchema.id))
      .limit(SCAN),
  ]);
  return [
    ...asks.filter(a => touches(askSubjectKeys(a))).map(a => ({ href: inboxHref('ask', a.id), title: a.title, kind: 'ask' as const })),
    ...runs.filter(r => touches(proposalSubjectKeys(r))).map(r => ({ href: inboxHref('proposal', r.id), title: describeActionRun({ ...r, proposal: r.proposal as Record<string, unknown> | null }).title, kind: 'proposal' as const })),
  ].slice(0, MAX_RELATED);
}
