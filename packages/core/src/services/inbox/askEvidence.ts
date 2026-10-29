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
 *   - **The message**: the latest message from the other side, in full, from
 *     the read-through copy `get_gmail_thread` keeps (`services/mail/
 *     threadRead.ts`), its quoted history and signature cut the way inbound
 *     mail is cut (`stripQuotedHistory`).
 *   - **The history**: every other message, who and when and its first line,
 *     and the thread in Gmail.
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
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { addressOf } from '@/libs/sources/mailThreadState';
import { stripQuotedHistory } from '@/libs/surfaces/email';
import { actionRunSchema, knowledgeChunkSchema, knowledgeDocumentSchema } from '@/models/Schema';
import { inboxHref } from '@/services/inbox/inboxRef';
import { activeThreadWith, findReplyThread } from '@/services/mail/replyThread';
import { readGmailThread } from '@/services/mail/threadRead';

/** The longest message body a page carries; Gmail has the rest. */
const BODY_MAX = 12_000;
/** A history line: the opening words, not the message. */
const LINE_MAX = 160;
/** How long the page waits on Gmail for a thread that has grown before showing what it has. */
const LIVE_READ_MS = 5_000;

/** A message on the thread, as the history lists it. */
export type ThreadLine = { from: string; at: string | null; line: string };

/** The thread an ask is about, as the page shows it. */
export type AskThread = {
  threadId: string;
  subject: string;
  /** The thread in Gmail. */
  href: string;
  /** The other side's latest message, whole; null when no full copy could be read. */
  latest: { from: string; at: string | null; body: string } | null;
  /** Every other message, oldest first: the full thread's, else the synced snippets. */
  history: ThreadLine[];
  /** A pending reply draft for this thread or this person. */
  draft: { href: string; to: string; subject: string; body: string; mode: 'draft' | 'send' } | null;
  /** Who a reply goes to, for "Draft a reply". */
  counterpart: string;
};

/** A CRM record the ask names, as the preview opens it. */
export type AskRecord = { type: 'deal' | 'object'; id: string; label: string; noun: string };

export type AskEvidence = { thread: AskThread | null; records: AskRecord[] };

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
 * A document's text from its chunks, without the overlap the chunker repeats
 * at each boundary (64 tokens, decoded verbatim). Pure.
 * @param chunks - The chunks, in order.
 */
export function rejoinChunks(chunks: readonly string[]): string {
  let out = chunks[0] ?? '';
  for (const next of chunks.slice(1)) {
    let k = Math.min(out.length, next.length);
    while (k > 0 && !out.endsWith(next.slice(0, k))) {
      k--;
    }
    out += next.slice(k);
  }
  return out;
}

/** One message of a full thread copy. */
export type ThreadMessageText = { from: string; to: string; date: string; subject: string; body: string };

const HEADERS = ['From', 'To', 'Cc', 'Date', 'Subject'] as const;

/**
 * A full thread copy (`fetchGmailThreadDoc`'s text: each message its From,
 * To, Cc, Date and Subject lines, then its body, messages split by a `---`
 * line) back into messages. Pure.
 * @param content - The copy's text.
 */
export function parseThreadText(content: string): ThreadMessageText[] {
  return content
    .split(/\n\n---\n\n(?=From: )/)
    .map((section) => {
      const lines = section.split('\n');
      const head: Record<string, string> = {};
      let i = 0;
      for (const name of HEADERS) {
        const line = lines[i] ?? '';
        if (line.startsWith(`${name}: `) || line === `${name}:`) {
          head[name] = line.slice(name.length + 1).trim();
          i++;
        }
      }
      return { from: head.From ?? '', to: head.To ?? '', date: head.Date ?? '', subject: head.Subject ?? '', body: lines.slice(i).join('\n').trim() };
    })
    .filter(m => m.from !== '');
}

function isoOf(date: string): string | null {
  const t = Date.parse(date);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function firstLine(text: string): string {
  const line = text.split('\n').map(l => l.trim()).find(Boolean) ?? '';
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)}…` : line;
}

/**
 * The message to show and the rest as history, from a full copy. The shown
 * message is the latest one the mailbox did not write. Pure.
 * @param messages - The thread's messages, oldest first.
 * @param mailbox - The owner's address, when known.
 */
export function splitThread(messages: readonly ThreadMessageText[], mailbox: string | null): Pick<AskThread, 'latest' | 'history'> {
  const owner = mailbox?.toLowerCase() ?? null;
  let at = messages.length - 1;
  if (owner) {
    while (at >= 0 && addressOf(messages[at]!.from) === owner) {
      at--;
    }
  }
  if (at < 0) {
    at = messages.length - 1;
  }
  const shown = messages[at];
  if (!shown) {
    return { latest: null, history: [] };
  }
  const body = stripQuotedHistory(shown.body);
  return {
    latest: { from: shown.from, at: isoOf(shown.date), body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)}…` : body },
    history: messages.filter((_, i) => i !== at).map(m => ({ from: m.from, at: isoOf(m.date), line: firstLine(stripQuotedHistory(m.body)) })),
  };
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
 * The thread in Gmail, for a thread whose state carried no link.
 * @param threadId - The thread.
 * @param mailbox - The mailbox, when known.
 */
function gmailHref(threadId: string, mailbox: string | null): string {
  return `https://mail.google.com/mail/${mailbox ? `u/${encodeURIComponent(mailbox)}/` : ''}#all/${encodeURIComponent(threadId)}`;
}

/**
 * Wait for a promise, but no longer than `ms`; null past it.
 * @param p - The work.
 * @param ms - The wait.
 */
async function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, ms, null);
  });
  try {
    return await Promise.race([p.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The evidence for one ask, for a viewer.
 * @param orgId - The workspace.
 * @param ask - The ask.
 * @param opts - Who is looking.
 * @param opts.userId - The viewer, for the source gate.
 */
export async function loadAskEvidence(orgId: string, ask: Pick<Ask, 'objectRefs' | 'contextUrl'>, opts: { userId: string | null }): Promise<AskEvidence> {
  const keys = crmKeysOf(ask.objectRefs ?? []);
  const { resolveRecordLabels } = await import('@/services/records/recordLabel');
  const labels = keys.length > 0 ? await resolveRecordLabels(orgId, keys).catch(() => new Map<string, string>()) : new Map<string, string>();
  const records: AskRecord[] = keys
    .filter(k => labels.has(k))
    .map((k) => {
      const kind = k.slice(0, k.indexOf(':')) as keyof typeof NOUN;
      return { type: kind === 'deals' ? 'deal' : 'object', id: k, label: labels.get(k)!, noun: NOUN[kind] };
    });

  const sources = await readableGmailSources(orgId, opts.userId);
  if (sources.length === 0) {
    return { thread: null, records };
  }
  const sourceIds = sources.map(s => s.id);
  const pointer = threadPointerOf(ask);
  let threadId = pointer && 'threadId' in pointer ? pointer.threadId : pointer ? await threadOfMessage(orgId, sourceIds, pointer.messageId) : null;
  let state = threadId ? await findReplyThread(orgId, { threadId }) : null;
  if (!threadId) {
    const email = await contactEmail(orgId, keys);
    state = email ? await activeThreadWith(orgId, email) : null;
    threadId = state?.threadId || null;
  }
  if (!threadId) {
    return { thread: null, records };
  }

  const read = await within(readGmailThread({
    orgId,
    sources,
    threadId,
    maxAgeMinutes: 15,
    currentMessageId: state?.lastMessageId ?? null,
    read: async (org, documentId) => {
      const chunks = await db
        .select({ content: knowledgeChunkSchema.content })
        .from(knowledgeChunkSchema)
        .where(and(eq(knowledgeChunkSchema.orgId, org), eq(knowledgeChunkSchema.documentId, documentId)))
        .orderBy(knowledgeChunkSchema.chunkIdx);
      return rejoinChunks(chunks.map(c => c.content));
    },
  }), LIVE_READ_MS);
  const messages = read && read.source !== 'none' ? parseThreadText(read.content) : [];
  if (!state && messages.length === 0) {
    return { thread: null, records };
  }
  const mailbox = state?.mailbox ?? null;
  const split = messages.length > 0
    ? splitThread(messages, mailbox)
    : { latest: null, history: (state?.messages ?? []).map(m => ({ from: m.from, at: m.at, line: firstLine(m.snippet) })) };
  const counterpart = state?.counterpart || split.latest?.from || '';
  return {
    thread: {
      threadId,
      subject: state?.subject || messages[0]?.subject || '',
      href: state?.href ?? gmailHref(threadId, mailbox),
      ...split,
      draft: await pendingReply(orgId, threadId, counterpart).catch(() => null),
      counterpart,
    },
    records,
  };
}
