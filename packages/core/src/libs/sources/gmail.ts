/**
 * Gmail connector — ingest mail as retrievable documents (RevOps front-door).
 *
 * Auth: OAuth access token in `ctx.credentials.token`. Incremental: when
 * `ctx.since` is set, the Gmail query gains `after:<unix-seconds>`. Lists
 * message ids (paginating `nextPageToken`), then fetches metadata per id.
 *
 * With `attachments: true`, each message is fetched in full instead, and every
 * PDF and Word (.docx) attachment becomes its own document
 * (`gmail-attachment:<messageId>:<partId>`), read by `libs/extract` — so an
 * invoice or a contract that arrived by mail is found by what it says. A scan,
 * a file over the size limit or a damaged one lands as its name and the
 * reason. Full messages need `gmail.readonly`; a credential that holds only
 * metadata access is told so once, and the run carries on without attachments.
 */

import type { SourceConnector, SourceContext } from './types';
import type { DocumentKind, ExtractionResult } from '@/libs/extract/documentText';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { bytesFromBase64, contentFor, documentKindOf, extractDocumentText, extractionMetadata, tooLargeToRead } from '@/libs/extract/documentText';
import { resolveGoogleAccessToken } from './googleAuth';

const gmailConfigSchema = z.object({
  /** Gmail search query (e.g. `in:inbox`, `from:client.com`). */
  query: z.string().default('in:inbox'),
  /** Read PDF and Word attachments into their own documents. Needs `gmail.readonly`. */
  attachments: z.boolean().default(false),
  baseUrl: z.string().url().default('https://gmail.googleapis.com/gmail/v1'),
});

type GmailList = { messages?: Array<{ id: string }>; nextPageToken?: string };
type GmailPayload = {
  partId?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
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

/** One attachment this connector can read, as the message's parts describe it. */
type ReadableAttachment = {
  partId: string;
  filename: string;
  mimeType: string;
  kind: DocumentKind;
  size: number | undefined;
  attachmentId: string | undefined;
  /** Small attachments can arrive inline, already in the part. */
  inlineData: string | undefined;
};

/**
 * Every PDF and Word attachment in a message, in part order.
 * @param payload - The message's top part, from a `format=full` fetch.
 */
export function readableAttachments(payload: GmailPayload | undefined): ReadableAttachment[] {
  const found: ReadableAttachment[] = [];
  const walk = (part: GmailPayload | undefined) => {
    if (!part) {
      return;
    }
    const filename = part.filename?.trim();
    const kind = filename ? documentKindOf(part.mimeType, filename) : null;
    if (filename && kind && part.partId !== undefined) {
      found.push({
        partId: part.partId,
        filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        kind,
        size: typeof part.body?.size === 'number' ? part.body.size : undefined,
        attachmentId: part.body?.attachmentId,
        inlineData: part.body?.data,
      });
    }
    for (const child of part.parts ?? []) {
      walk(child);
    }
  };
  walk(payload);
  return found;
}

/**
 * Download one attachment and read it. The HTTP status when the download
 * failed; a file that downloads but cannot be read is a result with its reason.
 * @param input - Where the attachment is and how to fetch it.
 * @param input.baseUrl - The Gmail API base.
 * @param input.headers - The bearer header.
 * @param input.messageId - The message it is attached to.
 * @param input.attachment - The attachment.
 */
async function readAttachment(input: { baseUrl: string; headers: Record<string, string>; messageId: string; attachment: ReadableAttachment }): Promise<ExtractionResult | number> {
  const { attachment } = input;
  const big = tooLargeToRead(attachment.kind, attachment.size);
  if (big) {
    return big;
  }
  let data = attachment.inlineData;
  if (!data && attachment.attachmentId) {
    const res = await fetch(`${input.baseUrl}/users/me/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(attachment.attachmentId)}`, { headers: input.headers });
    if (!res.ok) {
      return res.status;
    }
    data = ((await res.json()) as { data?: string }).data;
  }
  return extractDocumentText(attachment.kind, bytesFromBase64(data ?? ''));
}

export const gmailConnector: SourceConnector<typeof gmailConfigSchema> = {
  slug: 'gmail',
  name: 'Gmail',
  description: 'Ingest Gmail messages (subject, sender, snippet), and optionally their PDF and Word attachments — incremental by received date.',
  icon: 'Mail',
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

    // Turned off for the rest of the run when Gmail refuses full messages.
    let readAttachments = cfg.attachments;
    const fetchMetadata = (id: string) => {
      const mp = new URLSearchParams({ format: 'metadata' });
      ['Subject', 'From', 'Date'].forEach(h => mp.append('metadataHeaders', h));
      return fetch(`${cfg.baseUrl}/users/me/messages/${id}?${mp.toString()}`, { headers });
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
        let msgRes = readAttachments
          ? await fetch(`${cfg.baseUrl}/users/me/messages/${id}?format=full`, { headers })
          : await fetchMetadata(id);
        if (readAttachments && msgRes.status === 403) {
          // Metadata access only: say so once, and read the rest of the run without attachments.
          readAttachments = false;
          ctx.onProgress?.({ kind: 'error', uri: id, message: 'Gmail would not return full messages (403), so attachments were not read: the Google login may hold metadata access only. Log in with Google again for gmail.readonly, or turn attachments off for this source.' });
          msgRes = await fetchMetadata(id);
        }
        if (!msgRes.ok) {
          ctx.onProgress?.({ kind: 'error', uri: id, message: `get ${id}: ${msgRes.status}` });
          continue;
        }
        const msg = (await msgRes.json()) as GmailMessage;
        const subject = header(msg, 'Subject');
        const from = header(msg, 'From');
        const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
        ctx.onProgress?.({ kind: 'fetched', uri: id });
        yield {
          externalId: `gmail:${id}`,
          title: subject || `(no subject) — ${from}`,
          content: `From: ${from}\nSubject: ${subject}\n\n${msg.snippet ?? ''}`,
          lastModifiedAt: receivedAt,
          // threadId lets the thread cache resolve message → thread without
          // a live API call. Metadata-only enrichment: unchanged content
          // still refreshes metadata on ingest.
          metadata: { kind: 'gmail-message', from, threadId: msg.threadId ?? null },
        };
        if (!readAttachments) {
          continue;
        }
        for (const attachment of readableAttachments(msg.payload)) {
          const result = await readAttachment({ baseUrl: cfg.baseUrl, headers, messageId: id, attachment });
          if (typeof result === 'number') {
            ctx.onProgress?.({ kind: 'error', uri: id, message: `attachment ${attachment.filename} on ${id}: ${result}` });
            continue;
          }
          yield {
            externalId: `gmail-attachment:${id}:${attachment.partId}`,
            title: `${attachment.filename} — ${subject || '(no subject)'}`,
            content: `Attachment: ${attachment.filename}\nFrom: ${from}\nSubject: ${subject}\n\n${contentFor(attachment.filename, result)}`,
            lastModifiedAt: receivedAt,
            metadata: {
              kind: 'gmail-attachment',
              messageId: id,
              threadId: msg.threadId ?? null,
              from,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              ...(attachment.size !== undefined ? { bytes: attachment.size } : {}),
              textExtraction: extractionMetadata(result),
            },
          };
        }
      }
      pageToken = list.nextPageToken;
    } while (pageToken);
  },
};
