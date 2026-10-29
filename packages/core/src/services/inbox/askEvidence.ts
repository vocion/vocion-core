/**
 * THE EVIDENCE BEHIND AN ASK ABOUT AN EMAIL — read once for the ask's page on
 * the server, so a person deciding "reply to them, and decide where the deal
 * stands" has the reply in front of them, not the agent's summary of it.
 *
 * A Review input that said a prospect's message was "unreadable" (2026-10-29)
 * carried two sentences and three options. The thread was thirteen readable
 * messages; the agent had only ever seen a sync snippet, and the person had
 * no way to check it from the item. Now the ask names its thread and its
 * records in `object_refs`, and the page reads:
 *
 *   - **The message and its thread**: the other side's latest message whole,
 *     every other message as a line, and the thread in Gmail — the same
 *     evidence the reply draft's card shows (`services/mail/threadEvidence`).
 *   - **The draft**: a pending `gmail.send` for the same thread (or the same
 *     person), so the reply is one move away.
 *   - **The records**: the CRM deal, contact or company it names, by name.
 *
 * Which thread: a `gmail_thread` ref (or any `*thread` spelling), a Gmail
 * message ref resolved through the synced mirror, a Gmail link in the ask's
 * context URL, else the newest live thread with a contact the ask names (the
 * same rule the sequence gate uses, `activeThreadWith`). Nothing found, or a
 * source the viewer may not read, answers no thread — the page then shows
 * none rather than a wrong one.
 */

import type { Ask } from '@/services/AskService';
import type { RelatedItem } from '@/services/inbox/relatedItems';
import type { ThreadEvidence } from '@/services/mail/threadEvidence';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, knowledgeDocumentSchema } from '@/models/Schema';
import { askSubjectKeys, crmKeysOf, threadPointerOf } from '@/services/inbox/askRefs';
import { inboxHref } from '@/services/inbox/inboxRef';
import { relatedOpenItems } from '@/services/inbox/relatedItems';
import { activeThreadWith, findReplyThread } from '@/services/mail/replyThread';
import { readableGmailSources, readThreadEvidence } from '@/services/mail/threadEvidence';

/** The thread an ask is about, as the page shows it: the evidence, and the reply waiting on it. */
export type AskThread = ThreadEvidence & {
  /** A pending reply draft for this thread or this person. */
  draft: { href: string; to: string; subject: string; body: string; mode: 'draft' | 'send' } | null;
};

export { crmKeysOf, threadPointerOf } from '@/services/inbox/askRefs';

/** A CRM record the ask names, as the preview opens it. */
export type AskRecord = { type: 'deal' | 'object'; id: string; label: string; noun: string };

export type AskEvidence = { thread: AskThread | null; records: AskRecord[]; related: RelatedItem[] };

const NOUN = { deals: 'Deal', contacts: 'Contact', companies: 'Company' } as const;

/**
 * The thread a message belongs to, from the synced mirror.
 * @param orgId - The workspace.
 * @param sourceIds - The readable gmail sources.
 * @param messageId - The Gmail message id.
 */
async function threadOfMessage(orgId: string, sourceIds: number[], messageId: string): Promise<string | null> {
  const [doc] = await db
    .select({ metadata: knowledgeDocumentSchema.metadata })
    .from(knowledgeDocumentSchema)
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.sourceId, sourceIds), eq(knowledgeDocumentSchema.externalId, `gmail:${messageId}`)))
    .limit(1);
  const id = doc?.metadata?.threadId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * The primary email of the first contact the ask names, from the CRM mirror.
 * @param orgId - The workspace.
 * @param keys - The ask's CRM keys.
 */
async function contactEmail(orgId: string, keys: string[]): Promise<string | null> {
  const contacts = keys.filter(k => k.startsWith('contacts:'));
  if (contacts.length === 0) {
    return null;
  }
  const rows = await db
    .select({ externalId: knowledgeDocumentSchema.externalId, metadata: knowledgeDocumentSchema.metadata })
    .from(knowledgeDocumentSchema)
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.externalId, contacts)));
  for (const key of contacts) {
    const email = rows.find(r => r.externalId === key)?.metadata?.primaryEmail;
    if (typeof email === 'string' && email.includes('@')) {
      return email;
    }
  }
  return null;
}

/**
 * The pending reply IN this thread, or null. Only a draft that names the
 * thread is its reply: one to the same person on another subject is another
 * conversation, and showing it here offered the wrong email for approval.
 * @param orgId - The workspace.
 * @param threadId - The thread, which the viewer may read.
 */
async function pendingReply(orgId: string, threadId: string): Promise<AskThread['draft']> {
  const [run] = await db
    .select({ id: actionRunSchema.id, input: actionRunSchema.input })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'gmail.send'),
      eq(actionRunSchema.status, 'pending'),
      sql`${actionRunSchema.input}->>'threadId' = ${threadId}`,
    ))
    .orderBy(desc(actionRunSchema.id))
    .limit(1);
  if (!run) {
    return null;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return { href: inboxHref('proposal', run.id), to: str(run.input.to), subject: str(run.input.subject), body: str(run.input.body), mode: run.input.draft === false ? 'send' : 'draft' };
}

/**
 * The thread an ask is about, for a viewer, with the reply waiting on it.
 * @param orgId - The workspace.
 * @param ask - The ask.
 * @param keys - Its CRM keys.
 * @param userId - The viewer, for the source gate.
 */
async function askThread(orgId: string, ask: Pick<Ask, 'objectRefs' | 'contextUrl'>, keys: string[], userId: string | null): Promise<AskThread | null> {
  // Every read below — the thread's state, its copy, the draft in it — goes
  // through the mailboxes this viewer may read. No access is no evidence.
  const sources = await readableGmailSources(orgId, userId);
  if (sources.length === 0) {
    return null;
  }
  const scope = { sourceIds: sources.map(s => s.id) };
  const pointer = threadPointerOf(ask);
  let threadId = pointer && 'threadId' in pointer ? pointer.threadId : pointer ? await threadOfMessage(orgId, scope.sourceIds, pointer.messageId) : null;
  let state = threadId ? await findReplyThread(orgId, { threadId }, scope) : null;
  if (!threadId) {
    const email = await contactEmail(orgId, keys);
    state = email ? await activeThreadWith(orgId, email, undefined, scope) : null;
    threadId = state?.threadId || null;
  }
  const evidence = threadId ? await readThreadEvidence(orgId, { threadId, state, sources }) : null;
  return evidence ? { ...evidence, draft: await pendingReply(orgId, evidence.threadId).catch(() => null) } : null;
}

/**
 * The evidence for one ask, for a viewer.
 * @param orgId - The workspace.
 * @param ask - The ask.
 * @param opts - Who is looking.
 * @param opts.userId - The viewer, for the source gate.
 */
export async function loadAskEvidence(orgId: string, ask: Pick<Ask, 'id' | 'objectRefs' | 'contextUrl'>, opts: { userId: string | null }): Promise<AskEvidence> {
  const keys = crmKeysOf(ask.objectRefs ?? []);
  const { resolveRecordLabels } = await import('@/services/records/recordLabel');
  const [labels, thread] = await Promise.all([
    keys.length > 0 ? resolveRecordLabels(orgId, keys).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
    askThread(orgId, ask, keys, opts.userId),
  ]);
  const records: AskRecord[] = keys
    .filter(k => labels.has(k))
    .map((k) => {
      const kind = k.slice(0, k.indexOf(':')) as keyof typeof NOUN;
      return { type: kind === 'deals' ? 'deal' : 'object', id: k, label: labels.get(k)!, noun: NOUN[kind] };
    });
  // Its subject, plus the thread found for it, as the record keys actions declare.
  const subject = [...new Set([...askSubjectKeys(ask), ...(thread ? [`gmail-thread:${thread.threadId}`] : [])])];
  const related = await relatedOpenItems(orgId, subject, { kind: 'ask', id: ask.id }).catch(() => []);
  return { thread, records, related };
}
