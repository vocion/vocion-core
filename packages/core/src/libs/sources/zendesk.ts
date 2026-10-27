/**
 * Zendesk connector — the tickets of one Zendesk Support account, with their
 * comment threads, as retrievable documents; and the client the help-desk
 * provider (`services/support/providers/zendesk.ts`) reads and writes with.
 *
 * Auth: an API token paired with the email of the agent it acts as, sent as
 * Basic `{email}/token:{apiToken}` against `https://{subdomain}.zendesk.com`.
 * Token access must be on in Admin Center → Apps and integrations → Zendesk API.
 *
 * Sync rides the cursor-based incremental ticket export
 * (`/api/v2/incremental/tickets/cursor.json`): `start_time` is the watermark
 * less five minutes on an incremental run (the export is second-granular and
 * the overlap is absorbed by content-hash dedup), or `lookbackDays` back on a
 * full run — so a ticket nobody touched for longer ages out of the index at
 * the next full reconcile, the way Jira's done window does. The export
 * reports deleted tickets with status `deleted`; they are skipped, and the
 * full run's tombstone pass drops them. Each ticket's comments come from
 * `/tickets/{id}/comments.json?include=users`, which also names the authors.
 *
 * Zendesk rate limits per account per minute (the export endpoint at 10 a
 * minute); every call goes through `vendorRequest`, which waits out a 429's
 * Retry-After instead of retrying early.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { basicAuth, orThrow, vendorRequest } from '@/libs/connectors/vendorRequest';
import { InspectInputError } from './inspect';

const zendeskConfigSchema = z.object({
  /** A full sync indexes tickets updated within this many days. */
  lookbackDays: z.number().int().min(1).max(3650).default(90),
  /** Index each ticket's comment thread, not just its subject and description. */
  includeComments: z.boolean().default(true),
});

/** Overlap on the watermark: the export is second-granular, a re-yield is free. */
const WATERMARK_OVERLAP_SECONDS = 300;
/** Export pages one sync may walk (up to 1000 tickets each). */
const MAX_EXPORT_PAGES = 50;
/** Comments read per ticket, newest pages dropped first. */
const MAX_COMMENTS = 100;
const BODY_MAX = 4000;

export type ZendeskCredentials = { subdomain: string; email: string; apiToken: string };

export type ZendeskTicket = {
  id: number;
  subject?: string | null;
  description?: string | null;
  status: string;
  priority?: string | null;
  requester_id?: number | null;
  assignee_id?: number | null;
  tags?: string[];
  via?: { channel?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
};
export type ZendeskUser = { id: number | null; name?: string | null; email?: string | null; role?: string | null };
export type ZendeskComment = { id: number; author_id: number; public: boolean; plain_body?: string | null; body?: string | null; created_at?: string | null };

/**
 * A subdomain as typed — `northwind`, `northwind.zendesk.com` or the whole
 * URL — down to `northwind`.
 * @param raw - What was pasted.
 */
export function normalizeZendeskSubdomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\.zendesk\.com$/i, '').toLowerCase();
}

/**
 * The vaulted credential, or the reason it cannot be used. The field names
 * are the storage contract with the `zendesk` platform descriptor.
 * @param values - The decrypted credential bag.
 */
export function zendeskCredentialsFrom(values?: Record<string, unknown> | null): { ok: true; credentials: ZendeskCredentials } | { ok: false; message: string } {
  const subdomain = normalizeZendeskSubdomain(typeof values?.subdomain === 'string' ? values.subdomain : '');
  const email = typeof values?.email === 'string' ? values.email.trim() : '';
  const apiToken = typeof values?.apiToken === 'string' ? values.apiToken.trim() : '';
  if (!subdomain || !/^[a-z0-9][\w-]*$/.test(subdomain)) {
    return { ok: false, message: 'No Zendesk subdomain is stored. Connect Zendesk on the Connectors page with the subdomain (northwind in northwind.zendesk.com), an agent\'s email and an API token.' };
  }
  if (!email || !apiToken) {
    return { ok: false, message: 'The Zendesk credential needs both an agent\'s email and an API token. Connect Zendesk again on the Connectors page.' };
  }
  return { ok: true, credentials: { subdomain, email, apiToken } };
}

/**
 * Where a person opens a ticket.
 * @param c - The credential, for the subdomain.
 * @param id - The ticket.
 */
export function zendeskTicketUrl(c: Pick<ZendeskCredentials, 'subdomain'>, id: string | number): string {
  return `https://${c.subdomain}.zendesk.com/agent/tickets/${id}`;
}

/**
 * One call to the account's API.
 * @param c - The credential.
 * @param path - The path, from `/api/v2`.
 * @param init - Method and JSON body, for a write.
 * @param init.method - The HTTP method.
 * @param init.json - The body.
 */
export function zendeskApi<T>(c: ZendeskCredentials, path: string, init: { method?: string; json?: unknown } = {}): Promise<VendorResult<T>> {
  return vendorRequest<T>({
    vendor: 'Zendesk',
    url: `https://${c.subdomain}.zendesk.com${path}`,
    method: init.method,
    json: init.json,
    headers: { authorization: basicAuth(`${c.email}/token`, c.apiToken) },
    authHint: 'Check the agent email and API token, and that token access is on in Admin Center → Apps and integrations → Zendesk API.',
  });
}

/**
 * A ticket's comments, oldest first, with the people who wrote them.
 * @param c - The credential.
 * @param id - The ticket.
 */
export async function zendeskComments(c: ZendeskCredentials, id: string | number): Promise<{ comments: ZendeskComment[]; users: Map<number, ZendeskUser> }> {
  const page = orThrow(await zendeskApi<{ comments?: ZendeskComment[]; users?: ZendeskUser[] }>(c, `/api/v2/tickets/${encodeURIComponent(String(id))}/comments.json?include=users&sort_order=asc&per_page=${MAX_COMMENTS}`));
  const users = new Map<number, ZendeskUser>();
  for (const u of page.users ?? []) {
    if (u.id !== null) {
      users.set(u.id, u);
    }
  }
  return { comments: page.comments ?? [], users };
}

/**
 * Who a user is to a person reading the thread.
 * @param user - The user, if known.
 */
export function zendeskUserName(user: ZendeskUser | undefined): string | null {
  return user?.name ?? user?.email ?? null;
}

/**
 * Whether a user is the customer or someone on the team.
 * @param user - The user, if known.
 */
export function zendeskRole(user: ZendeskUser | undefined): 'customer' | 'agent' | null {
  if (!user?.role) {
    return null;
  }
  return user.role === 'end-user' ? 'customer' : 'agent';
}

function cap(text: string): string {
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)} […]` : text;
}

/**
 * The searchable document for one ticket and its thread.
 * @param c - The credential, for the link.
 * @param ticket - The ticket.
 * @param thread - Its comments and their authors, when they were read.
 * @param thread.comments - The comments, oldest first.
 * @param thread.users - Their authors by id.
 */
export function zendeskTicketDoc(c: ZendeskCredentials, ticket: ZendeskTicket, thread: { comments: ZendeskComment[]; users: Map<number, ZendeskUser> } | null): IngestDoc {
  const requester = ticket.requester_id ? zendeskUserName(thread?.users.get(ticket.requester_id)) : null;
  const head = [
    `#${ticket.id} ${ticket.subject ?? ''}`.trim(),
    [`Status: ${ticket.status}`, ticket.priority ? `Priority: ${ticket.priority}` : null, requester ? `Requester: ${requester}` : null].filter(Boolean).join(' · '),
    ticket.tags?.length ? `Tags: ${ticket.tags.join(', ')}` : null,
  ].filter(Boolean).join('\n');
  const body = thread
    ? thread.comments.map((m) => {
        const author = zendeskUserName(thread.users.get(m.author_id)) ?? 'Someone';
        const role = m.public ? (zendeskRole(thread.users.get(m.author_id)) ?? 'reply') : 'internal note';
        return `[${m.created_at ?? ''}] ${author} (${role}): ${cap((m.plain_body ?? m.body ?? '').trim())}`;
      }).join('\n\n')
    : cap(ticket.description ?? '');
  return {
    externalId: `zendesk:${ticket.id}`,
    title: `#${ticket.id} ${ticket.subject ?? ''}`.trim(),
    content: [head, body].filter(Boolean).join('\n\n'),
    uri: zendeskTicketUrl(c, ticket.id),
    lastModifiedAt: ticket.updated_at ? new Date(ticket.updated_at) : null,
    metadata: {
      type: 'ticket',
      ticketId: String(ticket.id),
      status: ticket.status,
      priority: ticket.priority ?? null,
      tags: ticket.tags ?? [],
      channel: ticket.via?.channel ?? null,
      requester,
      created: ticket.created_at ?? null,
      updated: ticket.updated_at ?? null,
    },
  };
}

/**
 * Test connection: whose token it is, and that it reads tickets. Read-only.
 * @param values - The credential values, as typed or as vaulted.
 */
export async function inspectZendesk(values: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = zendeskCredentialsFrom(values);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const c = parsed.credentials;
  const checks: ConnectorCheck[] = [];
  const me = await zendeskApi<{ user?: ZendeskUser }>(c, '/api/v2/users/me.json');
  // A token that does not authenticate is answered as the anonymous user,
  // with a 200: an id of null is the tell.
  if (!me.ok || me.data.user?.id == null) {
    const message = me.ok ? `Zendesk did not accept the email and API token for ${c.subdomain}.zendesk.com: it answered as an anonymous visitor. Check both, and that token access is on.` : me.message;
    checks.push({ key: 'account', label: `Signs in to ${c.subdomain}.zendesk.com`, ok: false, detail: message });
    return { reachable: me.ok || me.kind !== 'unreachable', authorized: false, checks, note: null, error: message };
  }
  const user = me.data.user;
  const isAgent = user.role !== 'end-user';
  checks.push({ key: 'account', label: `Signs in to ${c.subdomain}.zendesk.com`, ok: isAgent, detail: isAgent ? `${user.name ?? user.email} (${user.role})` : `${user.email} is an end user, not an agent; the token must be paired with an agent's or admin's email.` });
  const count = await zendeskApi<{ count?: { value?: number } }>(c, '/api/v2/tickets/count.json');
  checks.push({ key: 'tickets', label: 'Reads tickets', ok: count.ok, detail: count.ok ? `${count.data.count?.value ?? 0} tickets in the account.` : count.message });
  const failed = checks.filter(x => !x.ok);
  return { reachable: true, authorized: isAgent, checks, note: null, error: failed.length > 0 ? failed.map(x => x.detail).join(' ') : null };
}

type ExportPage = { tickets?: ZendeskTicket[]; after_cursor?: string | null; end_of_stream?: boolean };

export const zendeskConnector: SourceConnector<typeof zendeskConfigSchema> = {
  slug: 'zendesk',
  brand: 'zendesk',
  name: 'Zendesk',
  description: 'Support tickets from Zendesk, with their comment threads. Synced incrementally by updated time; agents can read a ticket live and draft a reply as an internal note.',
  icon: 'MessageSquare',
  authKind: 'apikey',
  configSchema: zendeskConfigSchema,
  defaultReconcileCron: '0 4 * * *',
  inspectNote: 'Reads whose token it is and counts the account\'s tickets. Read-only. Nothing is saved.',

  async inspect({ credentials }) {
    return inspectZendesk(credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = zendeskConfigSchema.parse(ctx.config);
    const parsed = zendeskCredentialsFrom(ctx.credentials);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const c = parsed.credentials;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const from = ctx.since
      ? Math.floor(ctx.since.getTime() / 1000) - WATERMARK_OVERLAP_SECONDS
      : nowSeconds - cfg.lookbackDays * 86_400;
    // The export refuses a start time less than a minute ago.
    let path = `/api/v2/incremental/tickets/cursor.json?start_time=${Math.min(from, nowSeconds - 120)}`;
    for (let page = 0; page < MAX_EXPORT_PAGES; page += 1) {
      const body = orThrow(await zendeskApi<ExportPage>(c, path));
      for (const ticket of body.tickets ?? []) {
        if (ticket.status === 'deleted') {
          continue;
        }
        let thread: Awaited<ReturnType<typeof zendeskComments>> | null = null;
        if (cfg.includeComments) {
          try {
            thread = await zendeskComments(c, ticket.id);
          } catch (err) {
            // One unreadable thread costs that ticket its comments, not the run.
            ctx.onProgress?.({ kind: 'error', uri: String(ticket.id), message: `comments of #${ticket.id}: ${(err as Error).message}` });
          }
        }
        ctx.onProgress?.({ kind: 'fetched', uri: String(ticket.id) });
        yield zendeskTicketDoc(c, ticket, thread);
      }
      if (body.end_of_stream !== false || !body.after_cursor) {
        return;
      }
      path = `/api/v2/incremental/tickets/cursor.json?cursor=${encodeURIComponent(body.after_cursor)}`;
    }
    ctx.onProgress?.({ kind: 'error', message: `Zendesk sync stopped at the ${MAX_EXPORT_PAGES}-page cap; the rest lands on the next run.` });
  },
};
