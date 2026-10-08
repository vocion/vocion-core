/**
 * Outlook mail connector — ingest mail as retrievable documents, the
 * Microsoft 365 twin of the Gmail connector.
 *
 * Auth: the workspace's Microsoft login (`Mail.Read`, delegated: the mailbox
 * of whoever logged in). Like Gmail it syncs subject, sender and preview, not
 * whole bodies; `get_outlook_thread` reads a conversation's full text on demand.
 * Incremental: when `ctx.since` is set, only messages received at or after it
 * (`receivedDateTime ge`). Lists one mail folder (the inbox by default),
 * paginating `@odata.nextLink`. A daily full sync is the reconcile pass that
 * lets a deleted message leave the index.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { GRAPH_BASE, graphJson, graphPages, htmlToText, persistTo, resolveGraphToken } from '@/libs/microsoft/graph';
import { inspectMicrosoft } from '@/libs/microsoft/inspect';

export const OUTLOOK_MAIL_SLUG = 'outlook-mail';

const outlookMailConfigSchema = z.object({
  /** A well-known folder name (`inbox`, `sentitems`, `archive`) or a folder id. */
  folder: z.string().min(1).default('inbox'),
  /** Full-sync window: how far back to index mail. */
  pastDays: z.number().int().positive().default(90),
  baseUrl: z.string().url().default(GRAPH_BASE),
});

export type OutlookRecipient = { emailAddress?: { name?: string; address?: string } };

export type OutlookMessage = {
  id: string;
  conversationId?: string;
  subject?: string | null;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: OutlookRecipient;
  toRecipients?: OutlookRecipient[];
  ccRecipients?: OutlookRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  lastModifiedDateTime?: string;
  webLink?: string;
  isDraft?: boolean;
};

const LIST_FIELDS = 'id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime,lastModifiedDateTime,webLink,isDraft';

/**
 * A recipient as a person reads it: `Ann Lee <ann@contoso.example>`.
 * @param r - The Graph recipient.
 */
export function recipientText(r: OutlookRecipient | undefined): string {
  const name = r?.emailAddress?.name?.trim();
  const address = r?.emailAddress?.address?.trim();
  if (name && address && name !== address) {
    return `${name} <${address}>`;
  }
  return address ?? name ?? '';
}

/**
 * A message's text body: the plain body when Graph sent one, else the HTML
 * body with its tags dropped, else the preview.
 * @param msg - The message.
 */
export function messageText(msg: OutlookMessage): string {
  const content = msg.body?.content ?? '';
  if (content) {
    return msg.body?.contentType?.toLowerCase() === 'html' ? htmlToText(content) : content.trim();
  }
  return msg.bodyPreview ?? '';
}

/**
 * Fetch a whole Outlook conversation, oldest message first, flattened into
 * one document for `get_outlook_thread`. Keyed `outlook-thread:<id>`, a
 * namespace the sync never yields, so a full sync tombstones it (cache
 * eviction) and the tool fetches it again on the next ask.
 * @param token - A Graph access token with `Mail.Read`.
 * @param conversationId - The conversation.
 * @param baseUrl - The Graph base, for tests.
 */
export async function fetchOutlookThreadDoc(token: string, conversationId: string, baseUrl: string = GRAPH_BASE): Promise<IngestDoc | null> {
  const params = new URLSearchParams({
    $filter: `conversationId eq '${conversationId.replace(/'/g, '\'\'')}'`,
    $select: 'id,conversationId,subject,body,from,toRecipients,ccRecipients,receivedDateTime,webLink',
    $top: '50',
  });
  const body = await graphJson<{ value?: OutlookMessage[] }>(token, {
    path: `/me/messages?${params.toString()}`,
    what: 'an Outlook conversation',
    baseUrl,
    // Graph returns the body as text rather than HTML when asked.
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
  const messages = [...(body.value ?? [])].sort((a, b) => Date.parse(a.receivedDateTime ?? '') - Date.parse(b.receivedDateTime ?? ''));
  if (messages.length === 0) {
    return null;
  }
  const sections = messages.map(msg => [
    `From: ${recipientText(msg.from)}`,
    `To: ${(msg.toRecipients ?? []).map(recipientText).join(', ')}`,
    msg.ccRecipients?.length ? `Cc: ${msg.ccRecipients.map(recipientText).join(', ')}` : '',
    `Date: ${msg.receivedDateTime ?? ''}`,
    `Subject: ${msg.subject ?? ''}`,
    '',
    messageText(msg),
  ].filter(line => line !== '').join('\n'));
  const first = messages[0]!;
  const last = messages[messages.length - 1]!;
  const subject = first.subject || '(no subject)';
  return {
    externalId: `outlook-thread:${conversationId}`,
    title: `${subject} (${messages.length} message${messages.length === 1 ? '' : 's'})`,
    content: sections.join('\n\n---\n\n'),
    lastModifiedAt: last.receivedDateTime ? new Date(last.receivedDateTime) : null,
    metadata: {
      kind: 'outlook-thread',
      conversationId,
      messageCount: messages.length,
      latestMessageId: last.id,
      webLink: last.webLink ?? null,
      from: recipientText(first.from),
      fetchedAt: new Date().toISOString(),
    },
  };
}

export const outlookMailConnector: SourceConnector<typeof outlookMailConfigSchema> = {
  slug: OUTLOOK_MAIL_SLUG,
  name: 'Outlook mail',
  description: 'Email from Outlook (Microsoft 365). Subject, sender and preview, synced incrementally by received date.',
  icon: 'Mail',
  authKind: 'oauth',
  brand: 'microsoftoutlook',
  configSchema: outlookMailConfigSchema,
  defaultReconcileCron: '15 4 * * *',
  requiredScopes: ['Mail.Read'],
  inspectNote: 'Reads who the Microsoft login is and counts the messages in the folder this source syncs. Nothing is saved, except an expired login it renews for a connected source.',
  inspect: input => inspectMicrosoft(OUTLOOK_MAIL_SLUG, {
    label: 'Read the mail folder',
    run: async (token, config, baseUrl) => {
      const folder = typeof config.folder === 'string' && config.folder ? config.folder : 'inbox';
      const found = await graphJson<{ displayName?: string; totalItemCount?: number }>(token, { path: `/me/mailFolders/${encodeURIComponent(folder)}?$select=displayName,totalItemCount`, what: 'the mail folder', baseUrl });
      return `${found.displayName ?? folder}: ${found.totalItemCount ?? 0} messages`;
    },
  }, input),
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = outlookMailConfigSchema.parse(ctx.config);
    const token = await resolveGraphToken(ctx.credentials, persistTo(ctx.orgId, ctx.sourceId, message => ctx.onProgress?.({ kind: 'error', message })), OUTLOOK_MAIL_SLUG);
    const from = ctx.since ?? new Date(Date.now() - cfg.pastDays * 86_400_000);
    const params = new URLSearchParams({
      $select: LIST_FIELDS,
      $filter: `receivedDateTime ge ${from.toISOString()}`,
      $orderby: 'receivedDateTime desc',
      $top: '100',
    });
    const path = `/me/mailFolders/${encodeURIComponent(cfg.folder)}/messages?${params.toString()}`;
    for await (const msg of graphPages<OutlookMessage>(token, { path, what: 'Outlook messages', baseUrl: cfg.baseUrl })) {
      if (msg.isDraft) {
        ctx.onProgress?.({ kind: 'skipped', uri: msg.id });
        continue;
      }
      const subject = msg.subject ?? '';
      const sender = recipientText(msg.from);
      ctx.onProgress?.({ kind: 'fetched', uri: msg.id });
      yield {
        externalId: `outlook:${msg.id}`,
        title: subject || `(no subject) — ${sender}`,
        content: `From: ${sender}\nSubject: ${subject}\n\n${msg.bodyPreview ?? ''}`,
        lastModifiedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
        metadata: {
          kind: 'outlook-message',
          from: sender,
          to: (msg.toRecipients ?? []).map(r => r.emailAddress?.address).filter(Boolean),
          conversationId: msg.conversationId ?? null,
          webLink: msg.webLink ?? null,
        },
      };
    }
  },
};
