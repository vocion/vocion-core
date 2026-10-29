/**
 * THE THREAD A DRAFT ANSWERS — read from the thread-state documents Gmail
 * sync already files (`libs/sources/mailThreadState.ts`), never from Gmail at
 * render time.
 *
 * Two readers:
 *
 * - The reply-draft card shows what it is replying to (the last messages,
 *   sender, date, opening words) and threads the draft under it on approval.
 *   A draft that named its thread is matched by id; one that did not is
 *   matched by recipient and subject, so a reply proposed before drafts
 *   carried a thread id still lands in the right conversation.
 * - The sequence gate asks whether a contact is already in a live thread,
 *   because a person in conversation is answered, not enrolled
 *   (`personalization.enroll`'s precheck).
 *
 * Both read one table with the same filter. A missing source, a thread never
 * synced, or no match all answer null: the card then shows no thread rather
 * than a wrong one.
 */

import type { RecentMessage } from '@/libs/sources/mailThreadState';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { canonicalGmailUrl } from '@/libs/mail/gmailUrl';
import { MAIL_THREAD_STATE_KIND } from '@/libs/retrieval/facets';
import { addressOf, recentMessagesOf } from '@/libs/sources/mailThreadState';
import { knowledgeChunkSchema, knowledgeDocumentSchema } from '@/models/Schema';

export type ReplyThread = {
  threadId: string;
  subject: string;
  /** The thread in Gmail, when sync recorded it. */
  href: string | null;
  /** The other side, as the header gave it: `Dana Reyes <dana@kestrel.example>`. */
  counterpart: string;
  /** The mailbox the thread was read from — who the reply goes out as. */
  mailbox: string | null;
  /** The source (mailbox connection) whose sync filed it: its credentials read the thread. */
  sourceId?: number;
  lastMessageAt: string | null;
  /** The thread's last message id, as sync last saw it: a full copy ending there is current. */
  lastMessageId?: string | null;
  /** The last few messages, oldest first. */
  messages: RecentMessage[];
  /** How the thread was found: by the id the draft named, or by who and what it is about. */
  matchedBy: 'id' | 'subject';
};

/** How recent a thread must be to count as a conversation someone is in. */
export const ACTIVE_THREAD_DAYS = 30;

/**
 * A subject with its reply and forward prefixes taken off, lowercased.
 * @param subject - The subject line.
 */
export function bareSubject(subject: string): string {
  let s = subject.trim();
  for (let prefix = /^(?:re|fw|fwd|aw|sv) ?:/i.exec(s); prefix; prefix = /^(?:re|fw|fwd|aw|sv) ?:/i.exec(s)) {
    s = s.slice(prefix[0].length).trim();
  }
  return s.replace(/\s+/g, ' ').toLowerCase();
}

type Row = { id: number; sourceId: number; uri: string | null; metadata: Record<string, unknown>; lastModifiedAt: Date | null };

/**
 * Which mailboxes a read may look in: the sources a viewer may read, by id.
 * Absent, every source (a server path with no viewer: an action's own
 * execution). An empty list reads nothing — no access is no evidence.
 */
export type SourceScope = { sourceIds?: readonly number[] };

const meta = (key: string) => sql<string>`${knowledgeDocumentSchema.metadata}->>${key}`;
const facet = (key: string) => sql<string>`${knowledgeDocumentSchema.metadata}->'facets'->>${key}`;

/**
 * The thread-state documents that match, newest first.
 * @param orgId - The workspace.
 * @param where - The extra filter.
 * @param limit - How many.
 * @param scope - The mailboxes the reader may read.
 */
async function threadDocs(orgId: string, where: ReturnType<typeof sql> | ReturnType<typeof and>, limit: number, scope: SourceScope = {}): Promise<Row[]> {
  if (scope.sourceIds && scope.sourceIds.length === 0) {
    return [];
  }
  return db
    .select({
      id: knowledgeDocumentSchema.id,
      sourceId: knowledgeDocumentSchema.sourceId,
      uri: knowledgeDocumentSchema.uri,
      metadata: knowledgeDocumentSchema.metadata,
      lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt,
    })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      sql`${meta('kind')} = ${MAIL_THREAD_STATE_KIND}`,
      scope.sourceIds ? inArray(knowledgeDocumentSchema.sourceId, [...scope.sourceIds]) : undefined,
      where,
    ))
    .orderBy(desc(knowledgeDocumentSchema.lastModifiedAt))
    .limit(limit);
}

/**
 * A document's text, for a thread filed before its metadata carried the
 * messages: they are read back off the lines the text was written with.
 * @param orgId - The workspace.
 * @param documentId - The document.
 */
async function documentText(orgId: string, documentId: number): Promise<string> {
  const chunks = await db
    .select({ content: knowledgeChunkSchema.content })
    .from(knowledgeChunkSchema)
    .where(and(eq(knowledgeChunkSchema.orgId, orgId), eq(knowledgeChunkSchema.documentId, documentId)))
    .orderBy(knowledgeChunkSchema.chunkIdx);
  return chunks.map(c => c.content).join('\n');
}

/**
 * One row as the card reads it.
 * @param orgId - The workspace.
 * @param row - The document.
 * @param matchedBy - How it was found.
 */
async function toThread(orgId: string, row: Row, matchedBy: ReplyThread['matchedBy']): Promise<ReplyThread> {
  const m = row.metadata ?? {};
  const content = Array.isArray(m.recent) ? null : await documentText(orgId, row.id).catch(() => null);
  const facets = (m.facets ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    threadId: str(m.threadId),
    subject: str(m.subject),
    href: canonicalGmailUrl(row.uri),
    counterpart: str(facets.counterpart) || str(m.from),
    mailbox: str(facets.mailbox) || null,
    sourceId: row.sourceId,
    lastMessageAt: row.lastModifiedAt?.toISOString() ?? null,
    lastMessageId: str(facets.last_message_id) || null,
    messages: recentMessagesOf(m, content).slice(-3),
    matchedBy,
  };
}

/**
 * The thread a reply draft answers, or null when none can be named.
 * @param orgId - The workspace.
 * @param draft - What the draft says about itself.
 * @param draft.threadId - The thread it named, when it named one.
 * @param draft.to - Its recipient (an address, or `Name <address>`).
 * @param draft.subject - Its subject; only a reply's subject (`Re: …`) is matched without an id.
 * @param scope - The mailboxes the reader may read (`SourceScope`).
 */
export async function findReplyThread(orgId: string, draft: { threadId?: string; to?: string; subject?: string }, scope: SourceScope = {}): Promise<ReplyThread | null> {
  if (draft.threadId) {
    const [row] = await threadDocs(orgId, sql`${meta('threadId')} = ${draft.threadId}`, 1, scope);
    return row ? toThread(orgId, row, 'id') : null;
  }
  const address = draft.to ? addressOf(draft.to.split(',')[0] ?? '') : '';
  const subject = draft.subject ?? '';
  if (!address || !/^\s*re\s*:/i.test(subject)) {
    return null;
  }
  const rows = await threadDocs(orgId, sql`lower(${facet('counterpart')}) like ${`%${address}%`}`, 10, scope);
  const want = bareSubject(subject);
  const row = rows.find(r => bareSubject(String(r.metadata?.subject ?? '')) === want);
  return row ? toThread(orgId, row, 'subject') : null;
}

/**
 * The newest thread with this person in the last `days`, or null when they
 * are not in one.
 * @param orgId - The workspace.
 * @param email - Their address.
 * @param days - How far back counts as active.
 * @param scope - The mailboxes the reader may read (`SourceScope`).
 */
export async function activeThreadWith(orgId: string, email: string, days = ACTIVE_THREAD_DAYS, scope: SourceScope = {}): Promise<ReplyThread | null> {
  const address = addressOf(email);
  if (!address.includes('@')) {
    return null;
  }
  const since = new Date(Date.now() - days * 86_400_000);
  const [row] = await threadDocs(orgId, and(sql`lower(${facet('counterpart')}) like ${`%${address}%`}`, gte(knowledgeDocumentSchema.lastModifiedAt, since)), 1, scope);
  return row ? toThread(orgId, row, 'subject') : null;
}
