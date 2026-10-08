/**
 * The support family's reads — the connected help desk, live
 * (`services/support/provider.ts`).
 *
 *   support_search_tickets  tickets matching a query in the desk's own search
 *                           language, or the most recently updated
 *   support_read_ticket     one ticket whole: status, requester, assignee,
 *                           tags, and the thread with internal notes marked
 *
 * The knowledge index holds a copy of each ticket as of the last sync; a seat
 * answering a customer reads the ticket here, as it stands now. Present for
 * any agent whose `connectorSources` include a help-desk source
 * (`familyInScope`). The one write — a draft reply, posted as an internal
 * note — is the `support.draft_reply` action through `propose_action`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, familySourceSlugs } from '@/libs/connectors/families';

export const SEARCH_TICKETS_TOOL = 'support_search_tickets';
export const READ_TICKET_TOOL = 'support_read_ticket';

/** A message a model can read inline; a longer one is cut once. */
const MESSAGE_MAX = 6000;

export function supportTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'support')) {
    return [];
  }
  return [searchTicketsTool(ctx), readTicketTool(ctx)];
}

async function providerFor(ctx: RuntimeContext, source: string | undefined) {
  const { supportProviderFor } = await import('@/services/support/provider');
  return supportProviderFor(ctx.orgId, { sourceSlug: source ?? null, slugs: familySourceSlugs(ctx, 'support') });
}

function searchTicketsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const tickets = await provider.searchTickets(args.query ?? '', { status: args.status ?? null, limit: args.limit ?? 20 });
        return JSON.stringify({ ok: true, desk: provider.label, source: provider.sourceSlug, count: tickets.length, tickets, note: tickets.length === 0 ? 'Nothing matched.' : `Read one whole with ${READ_TICKET_TOOL}.` });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: SEARCH_TICKETS_TOOL,
      description: 'Search the connected help desk (Zendesk, Intercom or Freshdesk) live. The query is in the desk\'s own search language — Zendesk search syntax (priority:high requester:dana@northwind.example), plain words on Intercom, a filter query on Freshdesk (priority:4 AND status:2) — and status narrows by state (open, pending, solved/resolved, closed). Leave the query empty for the most recently updated. Returns id, subject, status, requester, updated and the link per ticket.',
      schema: z.object({
        query: z.string().max(1000).optional().describe('The query, in the desk\'s own language. Empty: the most recently updated tickets.'),
        status: z.string().max(40).optional().describe('Only tickets in this state, as the desk names it (open, pending, solved, closed…).'),
        limit: z.number().int().min(1).max(50).optional().describe('How many (default 20).'),
        source: z.string().optional().describe('The help-desk source, when the workspace has more than one.'),
      }),
    },
  );
}

function readTicketTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const ticket = await provider.readTicket(args.id);
        const messages = ticket.messages.map(m => (m.body.length > MESSAGE_MAX ? { ...m, body: `${m.body.slice(0, MESSAGE_MAX)} [cut at ${MESSAGE_MAX} of ${m.body.length} characters]` } : m));
        return JSON.stringify({
          ok: true,
          desk: provider.label,
          source: provider.sourceSlug,
          ticket: { ...ticket, messages },
          note: 'Messages with public: false are internal notes the customer never saw. To draft a reply, propose_action support.draft_reply with this id: it lands on the ticket as an internal note for a person on the support team to edit and send.',
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_TICKET_TOOL,
      description: 'One ticket (a conversation, on Intercom) on the connected help desk, read live: subject, status, priority, requester, assignee, tags, channel, dates, and the whole thread oldest first with who wrote each message and whether it was an internal note. Read it before drafting a reply or answering about a customer\'s request; the index holds only a copy as of the last sync.',
      schema: z.object({
        id: z.string().min(1).max(64).describe('The ticket or conversation id, as the desk shows it (12345, or #12345).'),
        source: z.string().optional().describe('The help-desk source, when the workspace has more than one.'),
      }),
    },
  );
}
