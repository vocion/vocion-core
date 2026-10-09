/**
 * Gmail connector — ingest mail as retrievable documents (RevOps front-door).
 *
 * Auth: OAuth access token in `ctx.credentials.token`. Incremental: when
 * `ctx.since` is set, the Gmail query gains `after:<unix-seconds>`. Lists
 * message ids (paginating `nextPageToken`), then fetches metadata per id.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { z } from 'zod';
import { resolveGoogleAccessToken } from './googleAuth';
import { threadFacts, threadStateDoc } from './mailThreadState';

const gmailConfigSchema = z.object({
  /** Gmail search query (e.g. `in:inbox`, `from:client.com`). */
  query: z.string().default('in:inbox'),
  baseUrl: z.string().url().default('https://gmail.googleapis.com/gmail/v1'),
});

type GmailList = { messages?: Array<{ id: string }>; nextPageToken?: string };
type GmailPayload = {
  headers?: Array<{ name: string; value: string }>;
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
};
type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
};
type GmailThread = { id: string; historyId?: string; messages?: GmailMessage[] };

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function decodeBody(data: string | undefined): string {
  if (!data) {
    return '';
  }
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Best-effort plain text for one message: walk parts for text/plain, fall
 * back to tag-stripped text/html, fall back to the snippet.
 * @param msg
 */
function messageBody(msg: GmailMessage): string {
  const findPart = (p: GmailPayload | undefined, mime: string): GmailPayload | undefined => {
    if (!p) {
      return undefined;
    }
    if (p.mimeType === mime && p.body?.data) {
      return p;
    }
    for (const child of p.parts ?? []) {
      const hit = findPart(child, mime);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  };
  const plain = findPart(msg.payload, 'text/plain');
  if (plain) {
    return decodeBody(plain.body?.data);
  }
  const html = findPart(msg.payload, 'text/html');
  if (html) {
    return decodeBody(html.body?.data).replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  return msg.snippet ?? '';
}

/**
 * Fetch a full Gmail thread and flatten it into one IngestDoc (the
 * read-through miss path of `get_gmail_thread`). Keyed `gmail-thread:<id>` —
 * a namespace the sync connector never yields, so incremental crons never
 * touch these docs; a full sync tombstones them, which is just cache
 * eviction (the read-through refills on the next ask).
 *
 * Requires the gmail.readonly (or broader) scope on the stored credentials —
 * the metadata-only sync may have been consented with less.
 * @param opts
 * @param opts.orgId - The workspace the credential belongs to, to refresh a login on its own app.
 * @param opts.credentials
 * @param opts.threadId
 * @param opts.baseUrl
 */
export async function fetchGmailThreadDoc(opts: {
  orgId: string;
  credentials: Record<string, unknown> | undefined;
  threadId: string;
  baseUrl?: string;
}): Promise<IngestDoc | null> {
  const base = opts.baseUrl ?? 'https://gmail.googleapis.com/gmail/v1';
  const token = await resolveGoogleAccessToken(opts.credentials, opts.orgId);
  const res = await fetch(
    `${base}/users/me/threads/${encodeURIComponent(opts.threadId)}?format=full`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Gmail thread fetch failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const thread = (await res.json()) as GmailThread;
  const messages = thread.messages ?? [];
  if (messages.length === 0) {
    return null;
  }

  const sections = messages.map((msg) => {
    const lines = [
      `From: ${header(msg, 'From')}`,
      `To: ${header(msg, 'To')}`,
      header(msg, 'Cc') ? `Cc: ${header(msg, 'Cc')}` : '',
      `Date: ${header(msg, 'Date')}`,
      `Subject: ${header(msg, 'Subject')}`,
      '',
      messageBody(msg),
    ].filter(l => l !== '');
    return lines.join('\n');
  });

  const first = messages[0]!;
  const last = messages[messages.length - 1]!;
  const subject = header(first, 'Subject') || '(no subject)';
  const latestMs = messages.reduce(
    (max, m) => Math.max(max, m.internalDate ? Number(m.internalDate) : 0),
    0,
  );

  return {
    externalId: `gmail-thread:${thread.id}`,
    title: `${subject} (${messages.length} message${messages.length === 1 ? '' : 's'})`,
    content: sections.join('\n\n---\n\n'),
    lastModifiedAt: latestMs > 0 ? new Date(latestMs) : null,
    metadata: {
      kind: 'gmail-thread',
      threadId: thread.id,
      messageCount: messages.length,
      latestMessageId: last.id,
      historyId: thread.historyId ?? null,
      // Freshness watermark for the read-through cache (TTL compare).
      fetchedAt: new Date().toISOString(),
      from: header(first, 'From'),
    },
  };
}

/**
 * Resolve the thread a message belongs to (for `get_gmail_thread` called
 * with only a message id). `null` when Gmail doesn't know the message.
 * @param opts
 * @param opts.orgId - The workspace the credential belongs to, to refresh a login on its own app.
 * @param opts.credentials
 * @param opts.messageId
 * @param opts.baseUrl
 */
export async function resolveThreadIdForMessage(opts: {
  orgId: string;
  credentials: Record<string, unknown> | undefined;
  messageId: string;
  baseUrl?: string;
}): Promise<string | null> {
  const base = opts.baseUrl ?? 'https://gmail.googleapis.com/gmail/v1';
  const token = await resolveGoogleAccessToken(opts.credentials, opts.orgId);
  const res = await fetch(
    `${base}/users/me/messages/${encodeURIComponent(opts.messageId)}?format=minimal`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Gmail message lookup failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const msg = (await res.json()) as GmailMessage;
  return msg.threadId ?? null;
}

/** How far back a thread's last message may be for its state to be worked out, unless the environment says otherwise. */
export const DEFAULT_STATE_WINDOW_DAYS = 30;
/** Thread reads one sync may make for state. A first sync of a busy mailbox is bounded; the rest land on later syncs. */
const MAX_STATE_THREADS_PER_SYNC = 1_000;
const THREAD_READ_CONCURRENCY = 6;
const STATE_HEADERS = ['From', 'To', 'Cc', 'Date', 'Subject', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted'];

function stateWindowDays(): number {
  const raw = Number.parseInt(process.env.VOCION_MAIL_STATE_WINDOW_DAYS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STATE_WINDOW_DAYS;
}

/**
 * Whether a message says it is bulk or automated, from its headers alone.
 * @param msg - A message read with metadata headers.
 */
function isBulk(msg: GmailMessage): boolean {
  const precedence = header(msg, 'Precedence').toLowerCase();
  const auto = header(msg, 'Auto-Submitted').toLowerCase();
  return header(msg, 'List-Unsubscribe') !== '' || precedence === 'bulk' || precedence === 'list' || precedence === 'junk' || (auto !== '' && auto !== 'no');
}

/**
 * The ids of every message matching a query, across pages.
 * @param baseUrl - The API root.
 * @param headers - Auth headers.
 * @param q - The Gmail search.
 * @param limit - Stop after this many.
 */
async function listMessageRefs(baseUrl: string, headers: Record<string, string>, q: string, limit: number): Promise<Array<{ id: string; threadId?: string }>> {
  const out: Array<{ id: string; threadId?: string }> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: '500' });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const res = await fetch(`${baseUrl}/users/me/messages?${params.toString()}`, { headers });
    if (!res.ok) {
      throw new Error(`Gmail list failed: ${res.status}`);
    }
    const page = (await res.json()) as { messages?: Array<{ id: string; threadId?: string }>; nextPageToken?: string };
    out.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < limit);
  return out.slice(0, limit);
}

/**
 * The mailbox owner's address, or null when Gmail will not say.
 * @param baseUrl - The API root.
 * @param headers - Auth headers.
 */
async function mailboxAddress(baseUrl: string, headers: Record<string, string>): Promise<string | null> {
  const res = await fetch(`${baseUrl}/users/me/profile`, { headers });
  if (!res.ok) {
    return null;
  }
  return ((await res.json()) as { emailAddress?: string }).emailAddress || null;
}

type Facts = NonNullable<ReturnType<typeof threadFacts>>;

/**
 * Read threads' headers and snippets and work out their facts, a few at a time.
 * @param baseUrl - The API root.
 * @param headers - Auth headers.
 * @param ids - Thread ids.
 * @param mailbox - The owner's address.
 * @param onFailure - Told about a thread that could not be read.
 */
async function readThreadFacts(baseUrl: string, headers: Record<string, string>, ids: string[], mailbox: string, onFailure?: (id: string, status: number) => void): Promise<Facts[]> {
  const facts: Facts[] = [];
  const queue = [...ids];
  const read = async (): Promise<void> => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const params = new URLSearchParams({ format: 'metadata' });
      STATE_HEADERS.forEach(h => params.append('metadataHeaders', h));
      const res = await fetch(`${baseUrl}/users/me/threads/${encodeURIComponent(id)}?${params.toString()}`, { headers });
      if (!res.ok) {
        onFailure?.(id, res.status);
        continue;
      }
      const thread = (await res.json()) as GmailThread;
      const f = threadFacts(id, (thread.messages ?? []).map(m => ({
        id: m.id,
        from: header(m, 'From'),
        to: header(m, 'To'),
        cc: header(m, 'Cc'),
        date: new Date(m.internalDate ? Number(m.internalDate) : Date.parse(header(m, 'Date')) || 0),
        subject: header(m, 'Subject'),
        snippet: m.snippet ?? '',
        bulk: isBulk(m),
      })), mailbox);
      if (f) {
        facts.push(f);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(THREAD_READ_CONCURRENCY, ids.length) }, read));
  return facts;
}

/**
 * A link that opens a thread in the owner's Gmail.
 * @param mailbox
 * @param threadId
 */
export function gmailThreadUrl(mailbox: string, threadId: string): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#all/${threadId}`;
}

/**
 * The facts of threads with mail NEWER than the last sync, read live — the
 * gap between the index's watermark and now, for a question that needs "right
 * now". Headers only, no model: the caller labels them by the facts.
 * @param opts - Whose mailbox, and from when.
 * @param opts.orgId - The workspace the credential belongs to.
 * @param opts.credentials - The stored Gmail credential.
 * @param opts.after - Only mail after this instant (the sync watermark).
 * @param opts.limit - At most this many threads.
 * @param opts.baseUrl - The API root.
 */
export async function liveThreadFactsSince(opts: {
  orgId: string;
  credentials: Record<string, unknown> | undefined;
  after: Date;
  limit?: number;
  baseUrl?: string;
}): Promise<{ mailbox: string; facts: Facts[] } | null> {
  const baseUrl = opts.baseUrl ?? 'https://gmail.googleapis.com/gmail/v1';
  const token = await resolveGoogleAccessToken(opts.credentials, opts.orgId);
  const headers = { authorization: `Bearer ${token}` };
  const mailbox = await mailboxAddress(baseUrl, headers);
  if (!mailbox) {
    return null;
  }
  const refs = await listMessageRefs(baseUrl, headers, `after:${Math.floor(opts.after.getTime() / 1000)} -in:chats`, 200);
  const ids = [...new Set(refs.map(r => r.threadId).filter((t): t is string => !!t))].slice(0, opts.limit ?? 25);
  return { mailbox, facts: await readThreadFacts(baseUrl, headers, ids, mailbox) };
}

/**
 * The state documents for the threads a sync touched: each thread read once
 * (headers and snippets), its facts worked out, a label reused or bought, and
 * one document yielded per thread (`mailThreadState.ts`). Problems are reported
 * as skips, never errors: thread state must not hold back the sync's
 * watermark or its tombstoning.
 * @param ctx - The sync.
 * @param cfg - The connector config.
 * @param cfg.baseUrl - The API root.
 * @param headers - Auth headers.
 * @param threadIds - The threads touched, newest first.
 */
async function* threadStates(ctx: SourceContext, cfg: { baseUrl: string }, headers: Record<string, string>, threadIds: string[]): AsyncIterable<IngestDoc> {
  const mailbox = await mailboxAddress(cfg.baseUrl, headers);
  if (!mailbox) {
    ctx.onProgress?.({ kind: 'skipped', message: 'thread state skipped: could not read the mailbox address' });
    return;
  }
  const facts = await readThreadFacts(cfg.baseUrl, headers, threadIds.slice(0, MAX_STATE_THREADS_PER_SYNC), mailbox, (id, status) => {
    ctx.onProgress?.({ kind: 'skipped', uri: `gmail-thread:${id}`, message: `thread state skipped: thread read failed (${status})` });
  });
  if (facts.length === 0) {
    return;
  }
  // Imported here: the labeller reaches the database and a model, which a
  // connector's import graph (the applier validates configs with it) must not.
  const { labelThreads, priorLabels } = await import('@/services/mail/threadLabeller');
  const prior = await priorLabels(ctx.orgId, ctx.sourceId, 'gmail', facts.map(f => f.threadId));
  const { labels, counts } = await labelThreads({ orgId: ctx.orgId, sourceSlug: 'gmail', threads: facts, prior });
  ctx.onProgress?.({ kind: 'skipped', message: `thread state: ${counts.threads} threads (${counts.byRule} by headers, ${counts.reused} unchanged, ${counts.labelled} labelled, ${counts.fallback} left for the next sync)` });
  for (const f of facts) {
    const label = labels.get(f.threadId);
    if (label) {
      yield threadStateDoc(f, label, { connector: 'gmail', uri: gmailThreadUrl(mailbox, f.threadId) });
    }
  }
}

export const gmailConnector: SourceConnector<typeof gmailConfigSchema> = {
  slug: 'gmail',
  name: 'Gmail',
  description: 'Email from Gmail. Subject, sender and snippet, synced incrementally by received date.',
  icon: 'Mail',
  category: 'mail-calendar',
  brand: 'gmail',
  authKind: 'oauth',
  configSchema: gmailConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = gmailConfigSchema.parse(ctx.config);
    // Durable path: refresh-token exchange (see googleAuth); legacy fallback
    // accepts a raw short-lived credentials.token.
    const token = await resolveGoogleAccessToken(ctx.credentials, ctx.orgId);
    const headers = { authorization: `Bearer ${token}` };
    const q = ctx.since
      ? `${cfg.query} after:${Math.floor(ctx.since.getTime() / 1000)}`
      : cfg.query;

    // Threads this run touched, with their newest message, for thread state.
    const touched = new Map<string, number>();
    const windowStart = Date.now() - stateWindowDays() * 86_400_000;
    const touch = (threadId: string | undefined, at: number): void => {
      if (threadId && at >= windowStart) {
        touched.set(threadId, Math.max(touched.get(threadId) ?? 0, at));
      }
    };

    let pageToken = ctx.cursor ?? undefined;
    do {
      const params = new URLSearchParams({ q, maxResults: '100' });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      const listRes = await fetch(`${cfg.baseUrl}/users/me/messages?${params.toString()}`, { headers });
      if (!listRes.ok) {
        throw new Error(`Gmail list failed: ${listRes.status} ${await listRes.text().catch(() => '')}`);
      }
      const list = (await listRes.json()) as GmailList;
      for (const { id } of list.messages ?? []) {
        const mp = new URLSearchParams({ format: 'metadata' });
        ['Subject', 'From', 'Date'].forEach(h => mp.append('metadataHeaders', h));
        const msgRes = await fetch(`${cfg.baseUrl}/users/me/messages/${id}?${mp.toString()}`, { headers });
        if (!msgRes.ok) {
          ctx.onProgress?.({ kind: 'error', uri: id, message: `get ${id}: ${msgRes.status}` });
          continue;
        }
        const msg = (await msgRes.json()) as GmailMessage;
        touch(msg.threadId, msg.internalDate ? Number(msg.internalDate) : Date.now());
        const subject = header(msg, 'Subject');
        const from = header(msg, 'From');
        ctx.onProgress?.({ kind: 'fetched', uri: id });
        yield {
          externalId: `gmail:${id}`,
          title: subject || `(no subject) — ${from}`,
          content: `From: ${from}\nSubject: ${subject}\n\n${msg.snippet ?? ''}`,
          lastModifiedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : null,
          // threadId lets the thread cache resolve message → thread without
          // a live API call. Metadata-only enrichment: unchanged content
          // still refreshes metadata on ingest.
          metadata: { kind: 'gmail-message', from, threadId: msg.threadId ?? null },
        };
      }
      pageToken = list.nextPageToken;
    } while (pageToken);

    if (process.env.VOCION_MAIL_STATE === '0') {
      return;
    }
    // The owner's own replies are not in the inbox listing, and a reply is
    // exactly what moves a thread from owed to waiting. So the sent folder is
    // listed too (ids only), over the same window.
    try {
      const after = Math.floor(Math.max(windowStart, ctx.since?.getTime() ?? 0) / 1000);
      for (const ref of await listMessageRefs(cfg.baseUrl, headers, `in:sent after:${after}`, MAX_STATE_THREADS_PER_SYNC)) {
        touch(ref.threadId, Date.now());
      }
    } catch (error) {
      ctx.onProgress?.({ kind: 'skipped', message: `thread state: the sent folder could not be listed (${error instanceof Error ? error.message : String(error)})` });
    }
    const threadIds = [...touched.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    try {
      yield* threadStates(ctx, cfg, headers, threadIds);
    } catch (error) {
      ctx.onProgress?.({ kind: 'skipped', message: `thread state skipped this sync: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
};
