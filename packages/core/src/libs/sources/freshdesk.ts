/**
 * Freshdesk connector — the tickets of one Freshdesk helpdesk, with their
 * conversations (replies and private notes), as retrievable documents; and
 * the client the help-desk provider (`services/support/providers/freshdesk.ts`)
 * uses.
 *
 * Auth: an agent's API key as Basic `{apiKey}:X` against
 * `https://{domain}.freshdesk.com/api/v2`.
 *
 * Sync: `GET /tickets?updated_since=…&order_by=updated_at&order_type=asc`,
 * page by page — always with `updated_since`, because without it Freshdesk
 * lists only the last 30 days' tickets. The watermark less five minutes on an
 * incremental run, `lookbackDays` back on a full one. Each ticket's thread is
 * `GET /tickets/{id}/conversations`. Freshdesk rate limits per minute by
 * plan; `vendorRequest` waits out a 429's Retry-After.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { basicAuth, orThrow, vendorRequest } from '@/libs/connectors/vendorRequest';
import { InspectInputError } from './inspect';

const freshdeskConfigSchema = z.object({
  /** A full sync indexes tickets updated within this many days. */
  lookbackDays: z.number().int().min(1).max(3650).default(90),
  /** Index each ticket's conversations, not just its subject and description. */
  includeConversations: z.boolean().default(true),
});

const WATERMARK_OVERLAP_MS = 5 * 60_000;
/** Freshdesk stops a listing at page 300; one sync walks at most this many. */
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const BODY_MAX = 4000;

export const FRESHDESK_STATUS: Record<number, string> = { 2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed', 6: 'waiting on customer', 7: 'waiting on third party' };
const PRIORITY: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' };
const SOURCE: Record<number, string> = { 1: 'email', 2: 'portal', 3: 'phone', 7: 'chat', 9: 'feedback widget', 10: 'outbound email' };

export type FreshdeskCredentials = { domain: string; apiKey: string };
export type FreshdeskTicket = {
  id: number;
  subject?: string | null;
  description_text?: string | null;
  status?: number | null;
  priority?: number | null;
  source?: number | null;
  tags?: string[] | null;
  requester_id?: number | null;
  responder_id?: number | null;
  requester?: { name?: string | null; email?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
};
export type FreshdeskConversation = { id: number; body_text?: string | null; incoming?: boolean | null; private?: boolean | null; user_id?: number | null; created_at?: string | null };

/**
 * A domain as typed — `northwind`, `northwind.freshdesk.com` or the whole
 * URL — down to `northwind`.
 * @param raw - What was pasted.
 */
export function normalizeFreshdeskDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\.freshdesk\.com$/i, '').toLowerCase();
}

/**
 * The vaulted credential, or why it cannot be used.
 * @param values - The decrypted credential bag.
 */
export function freshdeskCredentialsFrom(values?: Record<string, unknown> | null): { ok: true; credentials: FreshdeskCredentials } | { ok: false; message: string } {
  const domain = normalizeFreshdeskDomain(typeof values?.domain === 'string' ? values.domain : '');
  const apiKey = typeof values?.apiKey === 'string' ? values.apiKey.trim() : '';
  if (!domain || !/^[a-z0-9][\w-]*$/.test(domain)) {
    return { ok: false, message: 'No Freshdesk domain is stored. Connect Freshdesk on the Connectors page with the helpdesk domain (northwind in northwind.freshdesk.com) and an agent\'s API key.' };
  }
  if (!apiKey) {
    return { ok: false, message: 'No Freshdesk API key is stored. Connect Freshdesk again on the Connectors page.' };
  }
  return { ok: true, credentials: { domain, apiKey } };
}

/**
 * Where a person opens a ticket.
 * @param c - The credential, for the domain.
 * @param id - The ticket.
 */
export function freshdeskTicketUrl(c: Pick<FreshdeskCredentials, 'domain'>, id: string | number): string {
  return `https://${c.domain}.freshdesk.com/a/tickets/${id}`;
}

/**
 * One call to the helpdesk's API.
 * @param c - The credential.
 * @param path - The path, from `/api/v2`.
 * @param init - Method and JSON body.
 * @param init.method - The HTTP method.
 * @param init.json - The body.
 */
export function freshdeskApi<T>(c: FreshdeskCredentials, path: string, init: { method?: string; json?: unknown } = {}): Promise<VendorResult<T>> {
  return vendorRequest<T>({
    vendor: 'Freshdesk',
    url: `https://${c.domain}.freshdesk.com/api/v2${path}`,
    method: init.method,
    json: init.json,
    headers: { authorization: basicAuth(c.apiKey, 'X') },
    authHint: 'Check the API key (Profile settings → View API key) and the helpdesk domain.',
  });
}

export function freshdeskStatus(code: number | null | undefined): string {
  return code ? FRESHDESK_STATUS[code] ?? `status ${code}` : 'unknown';
}

export function freshdeskPriority(code: number | null | undefined): string | null {
  return code ? PRIORITY[code] ?? null : null;
}

export function freshdeskSource(code: number | null | undefined): string | null {
  return code ? SOURCE[code] ?? null : null;
}

/**
 * A ticket's conversations, oldest first.
 * @param c - The credential.
 * @param id - The ticket.
 */
export async function freshdeskConversations(c: FreshdeskCredentials, id: string | number): Promise<FreshdeskConversation[]> {
  return orThrow(await freshdeskApi<FreshdeskConversation[]>(c, `/tickets/${encodeURIComponent(String(id))}/conversations?per_page=${PAGE_SIZE}`)) ?? [];
}

/**
 * The searchable document for one ticket and its thread.
 * @param c - The credential, for the link.
 * @param ticket - The ticket.
 * @param conversations - Its conversations, when they were read.
 */
export function freshdeskTicketDoc(c: FreshdeskCredentials, ticket: FreshdeskTicket, conversations: FreshdeskConversation[] | null): IngestDoc {
  const requester = ticket.requester?.name ?? ticket.requester?.email ?? null;
  const status = freshdeskStatus(ticket.status);
  const priority = freshdeskPriority(ticket.priority);
  const head = [
    `#${ticket.id} ${ticket.subject ?? ''}`.trim(),
    [`Status: ${status}`, priority ? `Priority: ${priority}` : null, requester ? `Requester: ${requester}` : null].filter(Boolean).join(' · '),
    ticket.tags?.length ? `Tags: ${ticket.tags.join(', ')}` : null,
  ].filter(Boolean).join('\n');
  const cap = (s: string) => (s.length > BODY_MAX ? `${s.slice(0, BODY_MAX)} […]` : s);
  const thread = [
    ticket.description_text ? `[${ticket.created_at ?? ''}] ${requester ?? 'Requester'} (customer): ${cap(ticket.description_text.trim())}` : null,
    ...(conversations ?? []).map(m => `[${m.created_at ?? ''}] ${m.incoming ? (requester ?? 'Customer') : 'Agent'} (${m.private ? 'private note' : (m.incoming ? 'customer' : 'agent')}): ${cap((m.body_text ?? '').trim())}`),
  ].filter(Boolean).join('\n\n');
  return {
    externalId: `freshdesk:${ticket.id}`,
    title: `#${ticket.id} ${ticket.subject ?? ''}`.trim(),
    content: [head, thread].filter(Boolean).join('\n\n'),
    uri: freshdeskTicketUrl(c, ticket.id),
    lastModifiedAt: ticket.updated_at ? new Date(ticket.updated_at) : null,
    metadata: { type: 'ticket', ticketId: String(ticket.id), status, priority, tags: ticket.tags ?? [], channel: freshdeskSource(ticket.source), requester },
  };
}

/**
 * Test connection: whose key it is, and that it reads tickets. Read-only.
 * @param values - The credential values.
 */
export async function inspectFreshdesk(values: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = freshdeskCredentialsFrom(values);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const c = parsed.credentials;
  const checks: ConnectorCheck[] = [];
  const me = await freshdeskApi<{ contact?: { name?: string; email?: string } }>(c, '/agents/me');
  if (!me.ok) {
    checks.push({ key: 'account', label: `Signs in to ${c.domain}.freshdesk.com`, ok: false, detail: me.message });
    return { reachable: me.kind !== 'unreachable', authorized: false, checks, note: null, error: me.message };
  }
  checks.push({ key: 'account', label: `Signs in to ${c.domain}.freshdesk.com`, ok: true, detail: me.data.contact?.name ?? me.data.contact?.email ?? 'agent' });
  const list = await freshdeskApi<FreshdeskTicket[]>(c, '/tickets?per_page=1');
  checks.push({ key: 'tickets', label: 'Reads tickets', ok: list.ok, detail: list.ok ? 'Tickets are readable.' : list.message });
  return { reachable: true, authorized: true, checks, note: null, error: list.ok ? null : list.message };
}

export const freshdeskConnector: SourceConnector<typeof freshdeskConfigSchema> = {
  slug: 'freshdesk',
  brand: 'freshdesk',
  name: 'Freshdesk',
  description: 'Support tickets from Freshdesk, with their replies and private notes. Synced incrementally by updated time; agents can read a ticket live and draft a reply as a private note.',
  icon: 'MessageSquare',
  authKind: 'apikey',
  configSchema: freshdeskConfigSchema,
  defaultReconcileCron: '30 4 * * *',
  inspectNote: 'Reads whose key it is and one ticket. Read-only. Nothing is saved.',

  async inspect({ credentials }) {
    return inspectFreshdesk(credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = freshdeskConfigSchema.parse(ctx.config);
    const parsed = freshdeskCredentialsFrom(ctx.credentials);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const c = parsed.credentials;
    const since = ctx.since ? new Date(ctx.since.getTime() - WATERMARK_OVERLAP_MS) : new Date(Date.now() - cfg.lookbackDays * 86_400_000);
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const tickets = orThrow(await freshdeskApi<FreshdeskTicket[]>(c, `/tickets?updated_since=${encodeURIComponent(since.toISOString())}&order_by=updated_at&order_type=asc&per_page=${PAGE_SIZE}&page=${page}&include=requester,description`)) ?? [];
      for (const ticket of tickets) {
        let conversations: FreshdeskConversation[] | null = null;
        if (cfg.includeConversations) {
          try {
            conversations = await freshdeskConversations(c, ticket.id);
          } catch (err) {
            ctx.onProgress?.({ kind: 'error', uri: String(ticket.id), message: `conversations of #${ticket.id}: ${(err as Error).message}` });
          }
        }
        ctx.onProgress?.({ kind: 'fetched', uri: String(ticket.id) });
        yield freshdeskTicketDoc(c, ticket, conversations);
      }
      if (tickets.length < PAGE_SIZE) {
        return;
      }
    }
    ctx.onProgress?.({ kind: 'error', message: `Freshdesk sync stopped at the ${MAX_PAGES}-page cap; the rest lands on the next run.` });
  },
};
