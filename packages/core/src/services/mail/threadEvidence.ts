/**
 * THE THREAD AS EVIDENCE — what a decision about an email shows of the
 * conversation it is about, read the same way wherever that decision sits: an
 * ask that says a reply is owed (`services/inbox/askEvidence.ts`) and the
 * reply draft itself (`gmail.send`'s card on its decision screen).
 *
 * The other side's latest message is shown whole, from the read-through copy
 * `get_gmail_thread` keeps (`threadRead.ts`), with its quoted history and
 * signature cut the way inbound mail is cut (`stripQuotedHistory`) and its
 * entities decoded. Every other message is one line: who, when, the opening
 * words. Without a full copy the synced snippets stand in as lines and no
 * message is shown as whole, because a snippet is not the message (a reply
 * read as "unreadable" from its snippet, 2026-10-29).
 *
 * The read waits on Gmail for a few seconds at most; past that the page shows
 * what the index has.
 */

import type { ReplyThread } from './replyThread';
import type { SourceRow } from '@/services/agents/tools/zoomTranscript';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { gmailThreadUrl } from '@/libs/mail/gmailUrl';
import { addressOf } from '@/libs/sources/mailThreadState';
import { decodeEntities, stripQuotedHistory } from '@/libs/surfaces/email';
import { knowledgeChunkSchema } from '@/models/Schema';
import { sourcesForConnector } from '@/services/agents/tools/zoomTranscript';
import { findReplyThread } from './replyThread';
import { readGmailThread } from './threadRead';

/** The longest message body a page carries; Gmail has the rest. */
const BODY_MAX = 12_000;
/** A history line: the opening words, not the message. */
const LINE_MAX = 160;
/** How long a page waits on Gmail for a thread that has grown before showing what it has. */
const LIVE_READ_MS = 5_000;

/** A message on the thread, as the history lists it. */
export type ThreadLine = { from: string; at: string | null; line: string };

/** The other side's latest message, whole. */
export type ThreadMessage = { from: string; at: string | null; body: string };

/** A thread as a decision about it shows it. */
export type ThreadEvidence = {
  threadId: string;
  subject: string;
  /** The thread in Gmail. */
  href: string;
  /** The other side, as the header gave it. */
  counterpart: string;
  /** Null when no full copy could be read. */
  latest: ThreadMessage | null;
  /** Every other message, oldest first: the full thread's, else the synced snippets. */
  history: ThreadLine[];
};

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
 * line) back into messages, entities decoded. Pure.
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
      return { from: head.From ?? '', to: head.To ?? '', date: head.Date ?? '', subject: head.Subject ?? '', body: decodeEntities(lines.slice(i).join('\n').trim()) };
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
export function splitThread(messages: readonly ThreadMessageText[], mailbox: string | null): Pick<ThreadEvidence, 'latest' | 'history'> {
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
 * Wait for a promise, but no longer than `ms`; null past it or on failure.
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
 * A cached copy's text, read back from its chunks without their overlap.
 * @param orgId - The workspace.
 * @param documentId - The copy.
 */
async function copyText(orgId: string, documentId: number): Promise<string> {
  const chunks = await db
    .select({ content: knowledgeChunkSchema.content })
    .from(knowledgeChunkSchema)
    .where(and(eq(knowledgeChunkSchema.orgId, orgId), eq(knowledgeChunkSchema.documentId, documentId)))
    .orderBy(knowledgeChunkSchema.chunkIdx);
  return rejoinChunks(chunks.map(c => c.content));
}

/**
 * One thread as evidence, or null when neither its state nor a copy of it is
 * in the index.
 * @param orgId - The workspace.
 * @param opts - Which thread.
 * @param opts.threadId - The Gmail thread.
 * @param opts.state - Its synced state, when the caller already read it.
 * @param opts.sources - The gmail sources the reader may read (default: every one).
 */
export async function readThreadEvidence(orgId: string, opts: { threadId: string; state?: ReplyThread | null; sources?: SourceRow[] }): Promise<ThreadEvidence | null> {
  const sources = opts.sources ?? await sourcesForConnector(orgId, 'gmail');
  if (sources.length === 0) {
    return null;
  }
  const state = opts.state === undefined ? await findReplyThread(orgId, { threadId: opts.threadId }).catch(() => null) : opts.state;
  const read = await within(readGmailThread({
    orgId,
    sources,
    threadId: opts.threadId,
    maxAgeMinutes: 15,
    currentMessageId: state?.lastMessageId ?? null,
    read: copyText,
  }), LIVE_READ_MS);
  const messages = read && read.source !== 'none' ? parseThreadText(read.content) : [];
  if (!state && messages.length === 0) {
    return null;
  }
  const mailbox = state?.mailbox ?? null;
  const split = messages.length > 0
    ? splitThread(messages, mailbox)
    : { latest: null, history: (state?.messages ?? []).map(m => ({ from: m.from, at: m.at, line: firstLine(m.snippet) })) };
  return {
    threadId: opts.threadId,
    subject: state?.subject || messages[0]?.subject || '',
    href: state?.href ?? gmailThreadUrl(mailbox, opts.threadId),
    counterpart: state?.counterpart || split.latest?.from || '',
    ...split,
  };
}
