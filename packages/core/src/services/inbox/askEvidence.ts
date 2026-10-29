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
import { addressOf } from '@/libs/sources/mailThreadState';
import { actionRunSchema, knowledgeDocumentSchema } from '@/models/Schema';
import { inboxHref } from '@/services/inbox/inboxRef';
import { relatedOpenItems } from '@/services/inbox/relatedItems';
import { activeThreadWith, findReplyThread } from '@/services/mail/replyThread';
import { readThreadEvidence } from '@/services/mail/threadEvidence';

/** The thread an ask is about, as the page shows it: the evidence, and the reply waiting on it. */
export type AskThread = ThreadEvidence & {
  /** A pending reply draft for this thread or this person. */
  draft: { href: string; to: string; subject: string; body: string; mode: 'draft' | 'send' } | null;
};

/** A CRM record the ask names, as the preview opens it. */
export type AskRecord = { type: 'deal' | 'object'; id: string; label: string; noun: string };

export type AskEvidence = { thread: AskThread | null; records: AskRecord[]; related: RelatedItem[] };

type Ref = { type: string; id: string };

const norm = (type: string) => type.trim().toLowerCase().replace(/-/g, '_');
const THREAD_TYPES = new Set(['gmail_thread', 'email_thread', 'mail_thread', 'thread']);
const MESSAGE_TYPES = new Set(['gmail_message', 'gmail', 'email_message', 'email']);
const CRM_KINDS: Record<string, 'deals' | 'contacts' | 'companies'> = {
  deal: 'deals',
  deals: 'deals',
  hubspot_deal: 'deals',
  contact: 'contacts',
  contacts: 'contacts',
  hubspot_contact: 'contacts',
  company: 'companies',
  companies: 'companies',
  hubspot_company: 'companies',
};
const NOUN = { deals: 'Deal', contacts: 'Contact', companies: 'Company' } as const;

/**
 * What the ask says about its thread: a thread id, a message id, or neither. Pure.
 * @param ask - The ask.
 * @param ask.objectRefs - What it is about.
 * @param ask.contextUrl - Its long form; a Gmail link names the thread.
 */
export function threadPointerOf(ask: Pick<Ask, 'objectRefs' | 'contextUrl'>): { threadId: string } | { messageId: string } | null {
  for (const r of ask.objectRefs ?? []) {
    if (THREAD_TYPES.has(norm(r.type))) {
      return { threadId: r.id.replace(/^gmail(?:-thread)?:/, '') };
    }
  }
  for (const r of ask.objectRefs ?? []) {
    if (MESSAGE_TYPES.has(norm(r.type))) {
      return { messageId: r.id.replace(/^gmail:/, '') };
    }
  }
  const m = /^https:\/\/mail\.google\.com\/mail\/[^#]*#[^/]+\/([0-9a-f]{12,})$/i.exec(ask.contextUrl ?? '');
  return m ? { threadId: m[1]! } : null;
}

/**
 * The CRM records an ask names, as mirror keys (`deals:123`). Pure.
 * @param refs - The ask's object refs.
 */
export function crmKeysOf(refs: readonly Ref[]): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const prefixed = /^(?:hubspot:)?(deals|contacts|companies):(.+)$/.exec(r.id);
    const kind = prefixed?.[1] ?? CRM_KINDS[norm(r.type)];
    const id = prefixed?.[2] ?? r.id;
    if (kind && id && !out.includes(`${kind}:${id}`)) {
      out.push(`${kind}:${id}`);
    }
  }
  return out;
}

/**
 * The gmail sources the viewer may read.
 * @param orgId - The workspace.
 * @param userId - The viewer; null reads every source (a server caller).
 */
async function readableGmailSources(orgId: string, userId: string | null) {
  const { sourcesForConnector } = await import('@/services/agents/tools/zoomTranscript');
  const sources = await sourcesForConnector(orgId, 'gmail');
  if (!userId || sources.length === 0) {
    return sources;
  }
  const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');
  const allowed = new Set(await allowedSourceSlugsForUser(orgId, userId));
  return sources.filter(s => allowed.has(s.slug));
}

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
 * The pending reply for this thread, else for this person.
 * @param orgId - The workspace.
 * @param threadId - The thread.
 * @param counterpart - The other side.
 */
async function pendingReply(orgId: string, threadId: string, counterpart: string): Promise<AskThread['draft']> {
  const address = addressOf(counterpart);
  const rows = await db
    .select({ id: actionRunSchema.id, input: actionRunSchema.input })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'gmail.send'),
      eq(actionRunSchema.status, 'pending'),
      address.includes('@')
        ? sql`(${actionRunSchema.input}->>'threadId' = ${threadId} OR lower(${actionRunSchema.input}->>'to') like ${`%${address}%`})`
        : sql`${actionRunSchema.input}->>'threadId' = ${threadId}`,
    ))
    .orderBy(desc(actionRunSchema.id))
    .limit(5);
  const run = rows.find(r => r.input.threadId === threadId) ?? rows[0];
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
  const sources = await readableGmailSources(orgId, userId);
  if (sources.length === 0) {
    return null;
  }
  const pointer = threadPointerOf(ask);
  let threadId = pointer && 'threadId' in pointer ? pointer.threadId : pointer ? await threadOfMessage(orgId, sources.map(s => s.id), pointer.messageId) : null;
  let state = threadId ? await findReplyThread(orgId, { threadId }) : null;
  if (!threadId) {
    const email = await contactEmail(orgId, keys);
    state = email ? await activeThreadWith(orgId, email) : null;
    threadId = state?.threadId || null;
  }
  const evidence = threadId ? await readThreadEvidence(orgId, { threadId, state, sources }) : null;
  return evidence ? { ...evidence, draft: await pendingReply(orgId, evidence.threadId, evidence.counterpart).catch(() => null) } : null;
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
  const related = await relatedOpenItems(orgId, [...(thread ? [thread.threadId] : []), ...keys], { kind: 'ask', id: ask.id }).catch(() => []);
  return { thread, records, related };
}
