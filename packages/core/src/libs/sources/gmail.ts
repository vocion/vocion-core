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
import { z } from 'zod';
import { resolveGoogleAccessToken } from './googleAuth';

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
 * @param opts.credentials
 * @param opts.threadId
 * @param opts.baseUrl
 */
export async function fetchGmailThreadDoc(opts: {
  credentials: Record<string, unknown> | undefined;
  threadId: string;
  baseUrl?: string;
}): Promise<IngestDoc | null> {
  const base = opts.baseUrl ?? 'https://gmail.googleapis.com/gmail/v1';
  const token = await resolveGoogleAccessToken(opts.credentials);
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
 * @param opts.credentials
 * @param opts.messageId
 * @param opts.baseUrl
 */
export async function resolveThreadIdForMessage(opts: {
  credentials: Record<string, unknown> | undefined;
  messageId: string;
  baseUrl?: string;
}): Promise<string | null> {
  const base = opts.baseUrl ?? 'https://gmail.googleapis.com/gmail/v1';
  const token = await resolveGoogleAccessToken(opts.credentials);
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

export const gmailConnector: SourceConnector<typeof gmailConfigSchema> = {
  slug: 'gmail',
  name: 'Gmail',
  description: 'Ingest Gmail messages (subject, sender, snippet) — incremental by received date.',
  icon: 'Mail',
  authKind: 'oauth',
  configSchema: gmailConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = gmailConfigSchema.parse(ctx.config);
    // Durable path: refresh-token exchange (see googleAuth); legacy fallback
    // accepts a raw short-lived credentials.token.
    const token = await resolveGoogleAccessToken(ctx.credentials);
    const headers = { authorization: `Bearer ${token}` };
    const q = ctx.since
      ? `${cfg.query} after:${Math.floor(ctx.since.getTime() / 1000)}`
      : cfg.query;

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
  },
};
