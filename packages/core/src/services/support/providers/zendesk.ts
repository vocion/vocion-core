/**
 * ZENDESK — a help-desk provider (`../provider.ts`), on the same client and
 * credential the `zendesk` source syncs with (`libs/sources/zendesk.ts`).
 *
 * Search is Zendesk's own syntax (`status:open priority:high`), always
 * narrowed to tickets; a draft reply is a private comment
 * (`comment.public: false`), which only agents see. Zendesk keeps every
 * comment — there is no API to delete one — so the draft cannot be taken back
 * from Vocion, and the action says so.
 */

import type { SupportProvider, SupportTicket, SupportTicketRow } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { ZendeskTicket, ZendeskUser } from '@/libs/sources/zendesk';
import { orThrow } from '@/libs/connectors/vendorRequest';
import { zendeskApi, zendeskComments, zendeskCredentialsFrom, zendeskRole, zendeskTicketUrl, zendeskUserName } from '@/libs/sources/zendesk';

/**
 * The provider for one Zendesk source.
 * @param source - The `zendesk` source row.
 * @param credentials - Its decrypted credential.
 */
export function zendeskSupportProvider(source: FamilySource, credentials: Record<string, unknown> | undefined): SupportProvider {
  const parsed = zendeskCredentialsFrom(credentials);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const c = parsed.credentials;

  const usersById = async (ids: number[]): Promise<Map<number, ZendeskUser>> => {
    const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))].slice(0, 100);
    if (unique.length === 0) {
      return new Map();
    }
    const res = await zendeskApi<{ users?: ZendeskUser[] }>(c, `/api/v2/users/show_many.json?ids=${unique.join(',')}`);
    return new Map((res.ok ? res.data.users ?? [] : []).filter(u => u.id !== null).map(u => [u.id!, u]));
  };

  return {
    kind: 'zendesk',
    label: 'Zendesk',
    sourceSlug: source.slug,
    ticketUrl: id => zendeskTicketUrl(c, id),

    async searchTickets(query, opts) {
      const q = ['type:ticket', query.trim(), opts.status ? `status:${opts.status}` : ''].filter(Boolean).join(' ');
      const page = orThrow(await zendeskApi<{ results?: ZendeskTicket[] }>(c, `/api/v2/search.json?query=${encodeURIComponent(q)}&sort_by=updated_at&sort_order=desc&per_page=${Math.min(opts.limit, 100)}`));
      const tickets = (page.results ?? []).slice(0, opts.limit);
      const users = await usersById(tickets.map(t => t.requester_id ?? 0));
      return tickets.map((t): SupportTicketRow => ({
        id: String(t.id),
        url: zendeskTicketUrl(c, t.id),
        subject: t.subject ?? '',
        status: t.status,
        requester: t.requester_id ? zendeskUserName(users.get(t.requester_id)) : null,
        updated: t.updated_at ?? null,
      }));
    },

    async readTicket(id) {
      const clean = id.trim().replace(/^#/, '');
      const [{ ticket }, thread] = await Promise.all([
        zendeskApi<{ ticket: ZendeskTicket }>(c, `/api/v2/tickets/${encodeURIComponent(clean)}.json`).then(orThrow),
        zendeskComments(c, clean),
      ]);
      const extra = await usersById([ticket.requester_id ?? 0, ticket.assignee_id ?? 0].filter(u => !thread.users.has(u)));
      const user = (uid: number | null | undefined) => (uid ? thread.users.get(uid) ?? extra.get(uid) : undefined);
      const out: SupportTicket = {
        id: String(ticket.id),
        url: zendeskTicketUrl(c, ticket.id),
        subject: ticket.subject ?? '',
        status: ticket.status,
        priority: ticket.priority ?? null,
        requester: zendeskUserName(user(ticket.requester_id)),
        assignee: zendeskUserName(user(ticket.assignee_id)),
        tags: ticket.tags ?? [],
        channel: ticket.via?.channel ?? null,
        created: ticket.created_at ?? null,
        updated: ticket.updated_at ?? null,
        messages: thread.comments.map(m => ({
          id: String(m.id),
          author: zendeskUserName(thread.users.get(m.author_id)),
          authorRole: zendeskRole(thread.users.get(m.author_id)),
          public: m.public,
          created: m.created_at ?? null,
          body: (m.plain_body ?? m.body ?? '').trim(),
        })),
      };
      return out;
    },

    async addInternalNote(id, body) {
      const clean = id.trim().replace(/^#/, '');
      const res = orThrow(await zendeskApi<{ audit?: { events?: Array<{ id: number; type: string }> } }>(c, `/api/v2/tickets/${encodeURIComponent(clean)}.json`, { method: 'PUT', json: { ticket: { comment: { body, public: false } } } }));
      const note = res?.audit?.events?.find(e => e.type === 'Comment');
      return { noteId: note ? String(note.id) : '', url: zendeskTicketUrl(c, clean) };
    },
  };
}
