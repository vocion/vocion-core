/**
 * INTERCOM — a help-desk provider (`../provider.ts`), on the client and
 * credential the `intercom` source syncs with (`libs/sources/intercom.ts`).
 *
 * A ticket here is a conversation. Search is text over the conversations'
 * messages (Intercom's search has no query language to pass through), with
 * the state as a filter. A draft reply is an admin note on the conversation
 * — Intercom's internal note, which the customer never sees — written as the
 * admin who owns the token. Intercom has no API to delete a note, so the
 * draft cannot be taken back from Vocion, and the action says so.
 */

import type { SupportProvider, SupportTicketRow } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { IntercomConversation, IntercomMe } from '@/libs/sources/intercom';
import { orThrow, textToHtml } from '@/libs/connectors/vendorRequest';
import { intercomAccessFrom, intercomApi, intercomConversationUrl, intercomMessages, intercomSubject } from '@/libs/sources/intercom';

/**
 * The provider for one Intercom source.
 * @param source - The `intercom` source row.
 * @param credentials - Its decrypted credential.
 */
export function intercomSupportProvider(source: FamilySource, credentials: Record<string, unknown> | undefined): SupportProvider {
  const parsed = intercomAccessFrom(credentials, source.config.region);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const a = parsed.access;
  let me: IntercomMe | null = null;
  const whoAmI = async (): Promise<IntercomMe> => {
    me ??= orThrow(await intercomApi<IntercomMe>(a, '/me'));
    return me;
  };
  const urlFor = async (id: string) => intercomConversationUrl(a, (await whoAmI().catch(() => null))?.app?.id_code ?? null, id);

  return {
    kind: 'intercom',
    label: 'Intercom',
    sourceSlug: source.slug,
    ticketUrl: id => intercomConversationUrl(a, me?.app?.id_code ?? null, id),

    async searchTickets(query, opts) {
      const filters: Array<Record<string, unknown>> = [];
      if (query.trim()) {
        filters.push({ field: 'source.body', operator: '~', value: query.trim() });
      }
      if (opts.status) {
        filters.push({ field: 'state', operator: '=', value: opts.status });
      }
      if (filters.length === 0) {
        filters.push({ field: 'updated_at', operator: '>', value: 0 });
      }
      const page = orThrow(await intercomApi<{ conversations?: IntercomConversation[] }>(a, '/conversations/search', {
        method: 'POST',
        json: {
          query: filters.length === 1 ? filters[0] : { operator: 'AND', value: filters },
          sort: { field: 'updated_at', order: 'descending' },
          pagination: { per_page: Math.min(opts.limit, 150) },
        },
      }));
      const appId = (await whoAmI().catch(() => null))?.app?.id_code ?? null;
      return (page.conversations ?? []).slice(0, opts.limit).map((c): SupportTicketRow => ({
        id: c.id,
        url: intercomConversationUrl(a, appId, c.id),
        subject: intercomSubject(c),
        status: c.state ?? 'unknown',
        requester: c.source?.author?.name ?? c.source?.author?.email ?? null,
        updated: typeof c.updated_at === 'number' ? new Date(c.updated_at * 1000).toISOString() : null,
      }));
    },

    async readTicket(id) {
      const conversation = orThrow(await intercomApi<IntercomConversation>(a, `/conversations/${encodeURIComponent(id.trim())}?display_as=plaintext`));
      return {
        id: conversation.id,
        url: await urlFor(conversation.id),
        subject: intercomSubject(conversation),
        status: conversation.state ?? 'unknown',
        priority: conversation.priority ?? null,
        requester: conversation.source?.author?.name ?? conversation.source?.author?.email ?? null,
        assignee: conversation.admin_assignee_id ? String(conversation.admin_assignee_id) : null,
        tags: (conversation.tags?.tags ?? []).map(t => t.name ?? '').filter(Boolean),
        channel: conversation.source?.delivered_as ?? conversation.source?.type ?? null,
        created: typeof conversation.created_at === 'number' ? new Date(conversation.created_at * 1000).toISOString() : null,
        updated: typeof conversation.updated_at === 'number' ? new Date(conversation.updated_at * 1000).toISOString() : null,
        messages: intercomMessages(conversation),
      };
    },

    async addInternalNote(id, body) {
      const admin = await whoAmI();
      if (!admin.id) {
        throw new Error('Intercom did not say which admin owns the token, so the note has no author to be written as.');
      }
      const after = orThrow(await intercomApi<IntercomConversation>(a, `/conversations/${encodeURIComponent(id.trim())}/reply`, {
        method: 'POST',
        json: { message_type: 'note', type: 'admin', admin_id: admin.id, body: textToHtml(body) },
      }));
      const parts = after?.conversation_parts?.conversation_parts ?? [];
      const note = [...parts].reverse().find(p => p.part_type === 'note');
      return { noteId: note?.id ?? '', url: await urlFor(id.trim()) };
    },
  };
}
