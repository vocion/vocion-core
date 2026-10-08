/**
 * FRESHDESK — a help-desk provider (`../provider.ts`), on the client and
 * credential the `freshdesk` source syncs with (`libs/sources/freshdesk.ts`).
 *
 * Search passes the query through as a Freshdesk filter query
 * (`priority:4 AND status:2`, the `/search/tickets` language), with the
 * status named in words folded in; empty, it lists the most recently updated.
 * A draft reply is a private note (`POST /tickets/{id}/notes`,
 * `private: true`), which the customer never sees.
 */

import type { SupportProvider, SupportTicketRow } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { FreshdeskTicket } from '@/libs/sources/freshdesk';
import { orThrow, textToHtml } from '@/libs/connectors/vendorRequest';
import { FRESHDESK_STATUS, freshdeskApi, freshdeskConversations, freshdeskCredentialsFrom, freshdeskPriority, freshdeskSource, freshdeskStatus, freshdeskTicketUrl } from '@/libs/sources/freshdesk';

/**
 * The status code a status named in words stands for.
 * @param status - The status, in words.
 */
function statusCode(status: string): number | null {
  const wanted = status.trim().toLowerCase();
  const hit = Object.entries(FRESHDESK_STATUS).find(([, name]) => name === wanted);
  return hit ? Number(hit[0]) : null;
}

/**
 * The provider for one Freshdesk source.
 * @param source - The `freshdesk` source row.
 * @param credentials - Its decrypted credential.
 */
export function freshdeskSupportProvider(source: FamilySource, credentials: Record<string, unknown> | undefined): SupportProvider {
  const parsed = freshdeskCredentialsFrom(credentials);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const c = parsed.credentials;
  const row = (t: FreshdeskTicket): SupportTicketRow => ({
    id: String(t.id),
    url: freshdeskTicketUrl(c, t.id),
    subject: t.subject ?? '',
    status: freshdeskStatus(t.status),
    requester: t.requester?.name ?? t.requester?.email ?? null,
    updated: t.updated_at ?? null,
  });

  return {
    kind: 'freshdesk',
    label: 'Freshdesk',
    sourceSlug: source.slug,
    ticketUrl: id => freshdeskTicketUrl(c, id),

    async searchTickets(query, opts) {
      const code = opts.status ? statusCode(opts.status) : null;
      if (opts.status && code === null) {
        throw new Error(`Freshdesk has no status "${opts.status}". It has: ${Object.values(FRESHDESK_STATUS).join(', ')}.`);
      }
      const clauses = [query.trim() ? `(${query.trim()})` : '', code ? `status:${code}` : ''].filter(Boolean);
      if (clauses.length === 0) {
        const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
        const tickets = orThrow(await freshdeskApi<FreshdeskTicket[]>(c, `/tickets?updated_since=${encodeURIComponent(since)}&order_by=updated_at&order_type=desc&per_page=${Math.min(opts.limit, 100)}&include=requester`)) ?? [];
        return tickets.slice(0, opts.limit).map(row);
      }
      const page = orThrow(await freshdeskApi<{ results?: FreshdeskTicket[] }>(c, `/search/tickets?query=${encodeURIComponent(`"${clauses.join(' AND ').replace(/"/g, '\'')}"`)}`));
      return (page.results ?? []).slice(0, opts.limit).map(row);
    },

    async readTicket(id) {
      const clean = id.trim().replace(/^#/, '');
      const [ticket, conversations] = await Promise.all([
        freshdeskApi<FreshdeskTicket>(c, `/tickets/${encodeURIComponent(clean)}?include=requester`).then(orThrow),
        freshdeskConversations(c, clean),
      ]);
      const requester = ticket.requester?.name ?? ticket.requester?.email ?? null;
      return {
        id: String(ticket.id),
        url: freshdeskTicketUrl(c, ticket.id),
        subject: ticket.subject ?? '',
        status: freshdeskStatus(ticket.status),
        priority: freshdeskPriority(ticket.priority),
        requester,
        assignee: ticket.responder_id ? String(ticket.responder_id) : null,
        tags: ticket.tags ?? [],
        channel: freshdeskSource(ticket.source),
        created: ticket.created_at ?? null,
        updated: ticket.updated_at ?? null,
        messages: [
          ...(ticket.description_text ? [{ id: `${ticket.id}-description`, author: requester, authorRole: 'customer' as const, public: true, created: ticket.created_at ?? null, body: ticket.description_text.trim() }] : []),
          ...conversations.map(m => ({
            id: String(m.id),
            author: m.incoming ? requester : null,
            authorRole: m.incoming ? 'customer' as const : 'agent' as const,
            public: m.private !== true,
            created: m.created_at ?? null,
            body: (m.body_text ?? '').trim(),
          })),
        ],
      };
    },

    async addInternalNote(id, body) {
      const clean = id.trim().replace(/^#/, '');
      const note = orThrow(await freshdeskApi<{ id?: number }>(c, `/tickets/${encodeURIComponent(clean)}/notes`, { method: 'POST', json: { body: textToHtml(body), private: true } }));
      return { noteId: note?.id ? String(note.id) : '', url: freshdeskTicketUrl(c, clean) };
    },
  };
}
