/**
 * Gmail connector — ingest mail as retrievable documents (RevOps front-door).
 *
 * Auth: OAuth access token in `ctx.credentials.token`. Incremental: when
 * `ctx.since` is set, the Gmail query gains `after:<unix-seconds>`. Lists
 * message ids (paginating `nextPageToken`), then fetches metadata per id.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';

const gmailConfigSchema = z.object({
  /** Gmail search query (e.g. `in:inbox`, `from:client.com`). */
  query: z.string().default('in:inbox'),
  baseUrl: z.string().url().default('https://gmail.googleapis.com/gmail/v1'),
});

type GmailList = { messages?: Array<{ id: string }>; nextPageToken?: string };
type GmailMessage = {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
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
    const token = ctx.credentials?.token as string | undefined;
    if (!token) {
      throw new Error('Gmail connector requires credentials.token');
    }
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
          metadata: { kind: 'gmail-message', from },
        };
      }
      pageToken = list.nextPageToken;
    } while (pageToken);
  },
};
