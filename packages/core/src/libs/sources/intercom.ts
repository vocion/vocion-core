/**
 * Intercom connector — the conversations of one Intercom workspace, with
 * their replies and internal notes, as retrievable documents; and the client
 * the help-desk provider (`services/support/providers/intercom.ts`) uses.
 *
 * Auth: an access token from the Developer Hub, as a Bearer token, pinned to
 * API version 2.11. The workspace's data region decides the host
 * (`api.intercom.io`, `api.eu.intercom.io`, `api.au.intercom.io`): a token
 * only works against its own region, so the source names it.
 *
 * Sync: `POST /conversations/search` on `updated_at`, past the watermark less
 * five minutes on an incremental run or `lookbackDays` back on a full one,
 * paginated by `starting_after`; then each conversation whole
 * (`GET /conversations/{id}?display_as=plaintext`, up to 500 parts). A
 * conversation Intercom no longer returns drops at the next full reconcile.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { htmlToText, orThrow, vendorRequest } from '@/libs/connectors/vendorRequest';
import { InspectInputError } from './inspect';

export const INTERCOM_REGIONS = { us: 'https://api.intercom.io', eu: 'https://api.eu.intercom.io', au: 'https://api.au.intercom.io' } as const;
const APP_HOSTS = { us: 'https://app.intercom.com', eu: 'https://app.eu.intercom.com', au: 'https://app.au.intercom.com' } as const;

const intercomConfigSchema = z.object({
  /** Where the workspace's data is hosted; a token only works against its own region. */
  region: z.enum(['us', 'eu', 'au']).default('us'),
  /** A full sync indexes conversations updated within this many days. */
  lookbackDays: z.number().int().min(1).max(3650).default(90),
});

export type IntercomRegion = keyof typeof INTERCOM_REGIONS;

const WATERMARK_OVERLAP_SECONDS = 300;
const MAX_SEARCH_PAGES = 100;
const PAGE_SIZE = 150;
const BODY_MAX = 4000;

type Author = { type?: string | null; id?: string | null; name?: string | null; email?: string | null };
export type IntercomPart = { id: string; part_type?: string | null; body?: string | null; author?: Author | null; created_at?: number | null };
export type IntercomConversation = {
  id: string;
  title?: string | null;
  state?: string | null;
  priority?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  admin_assignee_id?: number | string | null;
  source?: { subject?: string | null; body?: string | null; author?: Author | null; delivered_as?: string | null; type?: string | null } | null;
  tags?: { tags?: Array<{ name?: string | null }> } | null;
  conversation_parts?: { conversation_parts?: IntercomPart[] } | null;
};
export type IntercomMe = { id?: string; name?: string; email?: string; app?: { id_code?: string; name?: string } };

/** A token, and the region it was issued in. */
export type IntercomAccess = { token: string; region: IntercomRegion };

/**
 * The vaulted token, or why there is none.
 * @param values - The decrypted credential bag.
 * @param region - The region the source names.
 */
export function intercomAccessFrom(values: Record<string, unknown> | null | undefined, region: unknown): { ok: true; access: IntercomAccess } | { ok: false; message: string } {
  const token = typeof values?.token === 'string' ? values.token.trim() : (typeof values?.accessToken === 'string' ? values.accessToken.trim() : '');
  if (!token) {
    return { ok: false, message: 'No Intercom access token is stored. Connect Intercom on the Connectors page with an access token from the Developer Hub.' };
  }
  const r = typeof region === 'string' && region in INTERCOM_REGIONS ? region as IntercomRegion : 'us';
  return { ok: true, access: { token, region: r } };
}

/**
 * One call to the Intercom API.
 * @param a - The token and region.
 * @param path - The path, from the host.
 * @param init - Method and JSON body.
 * @param init.method - The HTTP method.
 * @param init.json - The body.
 */
export function intercomApi<T>(a: IntercomAccess, path: string, init: { method?: string; json?: unknown } = {}): Promise<VendorResult<T>> {
  return vendorRequest<T>({
    vendor: 'Intercom',
    url: `${INTERCOM_REGIONS[a.region]}${path}`,
    method: init.method,
    json: init.json,
    headers: { 'authorization': `Bearer ${a.token}`, 'intercom-version': '2.11' },
    authHint: 'Check the access token, and that the source names the region your Intercom workspace is hosted in.',
  });
}

/**
 * Where a person opens a conversation in the Intercom inbox.
 * @param a - The region.
 * @param appId - The workspace's app id (`/me` → `app.id_code`).
 * @param id - The conversation.
 */
export function intercomConversationUrl(a: Pick<IntercomAccess, 'region'>, appId: string | null, id: string): string {
  return appId ? `${APP_HOSTS[a.region]}/a/inbox/${appId}/inbox/conversation/${id}` : `${APP_HOSTS[a.region]}/a/inbox/conversation/${id}`;
}

/**
 * Who an author is to the support team.
 * @param author - The author.
 */
export function intercomRole(author: Author | null | undefined): 'customer' | 'agent' | 'system' | null {
  switch (author?.type) {
    case 'user':
    case 'lead':
    case 'contact':
      return 'customer';
    case 'admin':
    case 'team':
      return 'agent';
    case 'bot':
      return 'system';
    default:
      return null;
  }
}

/**
 * The parts worth reading: replies and notes with something in them.
 * @param conversation - The conversation, read whole.
 */
export function intercomMessages(conversation: IntercomConversation): Array<{ id: string; author: string | null; authorRole: ReturnType<typeof intercomRole>; public: boolean; created: string | null; body: string }> {
  const at = (s: number | null | undefined) => (typeof s === 'number' ? new Date(s * 1000).toISOString() : null);
  const first = conversation.source?.body
    ? [{ id: `${conversation.id}-source`, author: conversation.source.author?.name ?? conversation.source.author?.email ?? null, authorRole: intercomRole(conversation.source.author), public: true, created: at(conversation.created_at), body: htmlToText(conversation.source.body) }]
    : [];
  const parts = (conversation.conversation_parts?.conversation_parts ?? [])
    .filter(p => p.body && ['comment', 'note', 'assign_and_reopen', 'open', 'close', 'assignment'].includes(p.part_type ?? 'comment'))
    .map(p => ({ id: p.id, author: p.author?.name ?? p.author?.email ?? null, authorRole: intercomRole(p.author), public: p.part_type !== 'note', created: at(p.created_at), body: htmlToText(p.body) }));
  return [...first, ...parts].filter(m => m.body);
}

/**
 * The subject a person would give a conversation.
 * @param conversation - The conversation.
 */
export function intercomSubject(conversation: IntercomConversation): string {
  const candidates = [conversation.title, conversation.source?.subject, htmlToText(conversation.source?.body ?? '').split('\n')[0]];
  const subject = candidates.map(c => htmlToText(c ?? '').trim()).find(Boolean) ?? '';
  return subject.slice(0, 200) || `Conversation ${conversation.id}`;
}

/**
 * The searchable document for one conversation.
 * @param a - The region, for the link.
 * @param appId - The app id, for the link.
 * @param conversation - The conversation, read whole.
 */
export function intercomConversationDoc(a: IntercomAccess, appId: string | null, conversation: IntercomConversation): IngestDoc {
  const subject = intercomSubject(conversation);
  const contact = conversation.source?.author?.name ?? conversation.source?.author?.email ?? null;
  const messages = intercomMessages(conversation);
  const tags = (conversation.tags?.tags ?? []).map(t => t.name ?? '').filter(Boolean);
  const head = [
    subject,
    [`State: ${conversation.state ?? 'unknown'}`, conversation.priority === 'priority' ? 'Priority' : null, contact ? `Contact: ${contact}` : null].filter(Boolean).join(' · '),
    tags.length ? `Tags: ${tags.join(', ')}` : null,
  ].filter(Boolean).join('\n');
  const body = messages.map(m => `[${m.created ?? ''}] ${m.author ?? 'Someone'} (${m.public ? (m.authorRole ?? 'reply') : 'internal note'}): ${m.body.length > BODY_MAX ? `${m.body.slice(0, BODY_MAX)} […]` : m.body}`).join('\n\n');
  return {
    externalId: `intercom:${conversation.id}`,
    title: subject,
    content: [head, body].filter(Boolean).join('\n\n'),
    uri: intercomConversationUrl(a, appId, conversation.id),
    lastModifiedAt: typeof conversation.updated_at === 'number' ? new Date(conversation.updated_at * 1000) : null,
    metadata: { type: 'conversation', conversationId: conversation.id, state: conversation.state ?? null, priority: conversation.priority ?? null, tags, contact },
  };
}

/**
 * Test connection: whose token it is, which workspace, and that it reads
 * conversations. Read-only.
 * @param config - The source config (`region`).
 * @param values - The credential values.
 */
export async function inspectIntercom(config: Record<string, unknown>, values: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = intercomAccessFrom(values, config.region);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const a = parsed.access;
  const checks: ConnectorCheck[] = [];
  const me = await intercomApi<IntercomMe>(a, '/me');
  if (!me.ok) {
    checks.push({ key: 'account', label: `Signs in to Intercom (${a.region.toUpperCase()})`, ok: false, detail: me.message });
    return { reachable: me.kind !== 'unreachable', authorized: false, checks, note: null, error: me.message };
  }
  checks.push({ key: 'account', label: `Signs in to Intercom (${a.region.toUpperCase()})`, ok: true, detail: `${me.data.name ?? me.data.email ?? 'admin'} in ${me.data.app?.name ?? 'the workspace'}` });
  const list = await intercomApi<{ total_count?: number }>(a, '/conversations?per_page=1');
  checks.push({ key: 'conversations', label: 'Reads conversations', ok: list.ok, detail: list.ok ? 'Conversations are readable.' : list.message });
  return { reachable: true, authorized: true, checks, note: null, error: list.ok ? null : list.message };
}

type SearchPage = { conversations?: IntercomConversation[]; pages?: { next?: { starting_after?: string | null } | null } | null };

export const intercomConnector: SourceConnector<typeof intercomConfigSchema> = {
  slug: 'intercom',
  brand: 'intercom',
  name: 'Intercom',
  description: 'Customer conversations from Intercom, with replies and internal notes. Synced incrementally by updated time; agents can read a conversation live and draft a reply as an internal note.',
  icon: 'MessageSquare',
  authKind: 'apikey',
  configSchema: intercomConfigSchema,
  defaultReconcileCron: '15 4 * * *',
  inspectNote: 'Reads whose token it is and one conversation. Read-only. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectIntercom(config, credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = intercomConfigSchema.parse(ctx.config);
    const parsed = intercomAccessFrom(ctx.credentials, cfg.region);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const a = parsed.access;
    const me = await intercomApi<IntercomMe>(a, '/me');
    const appId = me.ok ? me.data.app?.id_code ?? null : null;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const from = ctx.since ? Math.floor(ctx.since.getTime() / 1000) - WATERMARK_OVERLAP_SECONDS : nowSeconds - cfg.lookbackDays * 86_400;
    let startingAfter: string | null = null;
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const body: SearchPage = orThrow(await intercomApi<SearchPage>(a, '/conversations/search', {
        method: 'POST',
        json: {
          query: { field: 'updated_at', operator: '>', value: from },
          sort: { field: 'updated_at', order: 'ascending' },
          pagination: { per_page: PAGE_SIZE, ...(startingAfter ? { starting_after: startingAfter } : {}) },
        },
      }));
      for (const summary of body.conversations ?? []) {
        const whole = await intercomApi<IntercomConversation>(a, `/conversations/${encodeURIComponent(summary.id)}?display_as=plaintext`);
        if (!whole.ok) {
          ctx.onProgress?.({ kind: 'error', uri: summary.id, message: `conversation ${summary.id}: ${whole.message}` });
          continue;
        }
        ctx.onProgress?.({ kind: 'fetched', uri: summary.id });
        yield intercomConversationDoc(a, appId, whole.data);
      }
      startingAfter = body.pages?.next?.starting_after ?? null;
      if (!startingAfter) {
        return;
      }
    }
    ctx.onProgress?.({ kind: 'error', message: `Intercom sync stopped at the ${MAX_SEARCH_PAGES}-page cap; the rest lands on the next run.` });
  },
};
