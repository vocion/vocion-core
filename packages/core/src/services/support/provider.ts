/**
 * THE SUPPORT FAMILY — a help desk, named for its constructs.
 *
 * Zendesk calls it a ticket, Intercom a conversation, Freshdesk a ticket
 * again; each is one customer's request with the thread of messages on it,
 * a status, a requester and an assignee. So an agent's tools are
 * `support_search_tickets` and `support_read_ticket`, the one write is the
 * `support.draft_reply` action, and the vendor is a provider behind this
 * interface, chosen by the source the workspace connected. Nothing an agent
 * is told, no trust rule and no skill names the vendor.
 *
 * A draft reply is an INTERNAL note on the ticket — the words a person on
 * the support team reads, edits and sends. Vocion never writes to the
 * customer through a help desk.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { FAMILY_LABEL, familySourcesForOrg } from '@/libs/connectors/families';
import { credentialsForSource, pickFamilySource } from '@/services/connectors/sourceCredentials';

export type SupportMessage = {
  id: string;
  author: string | null;
  /** Who wrote it, as the desk says: the customer, someone on the team, or the system. */
  authorRole: 'customer' | 'agent' | 'system' | null;
  /** False for an internal note only the team sees. */
  public: boolean;
  created: string | null;
  body: string;
};

export type SupportTicket = {
  id: string;
  url: string;
  subject: string;
  status: string;
  priority: string | null;
  requester: string | null;
  assignee: string | null;
  tags: string[];
  channel: string | null;
  created: string | null;
  updated: string | null;
  /** The thread, oldest first, capped by the provider. */
  messages: SupportMessage[];
};

export type SupportTicketRow = { id: string; url: string; subject: string; status: string; requester: string | null; updated: string | null };

export type SupportProvider = {
  /** The connector kind behind this provider (`zendesk`). */
  kind: string;
  /** The desk as a person names it ("Zendesk"). */
  label: string;
  /** The source slug it answers for. */
  sourceSlug: string;
  /**
   * Tickets matching a query in the desk's own search language (Zendesk
   * search syntax, Intercom text, a Freshdesk filter query), newest first.
   * Empty: the most recently updated.
   */
  searchTickets: (query: string, opts: { status?: string | null; limit: number }) => Promise<SupportTicketRow[]>;
  readTicket: (id: string) => Promise<SupportTicket>;
  /** Put a draft reply on the ticket as an internal note, never sent to the customer. */
  addInternalNote: (id: string, body: string) => Promise<{ noteId: string; url: string }>;
  ticketUrl: (id: string) => string;
};

/**
 * The provider for the workspace's help desk: the named source, else its one
 * help-desk source.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - A source slug, when the workspace has more than one.
 * @param opts.slugs - Only these sources: an agent's own, narrowed by the person's source ACL.
 */
export async function supportProviderFor(orgId: string, opts: { sourceSlug?: string | null; slugs?: readonly string[] } = {}): Promise<SupportProvider> {
  const source = pickFamilySource(await familySourcesForOrg(orgId, 'support', opts.slugs), FAMILY_LABEL.support, opts.sourceSlug);
  return providerFor(orgId, source);
}

async function providerFor(orgId: string, source: FamilySource): Promise<SupportProvider> {
  const credentials = await credentialsForSource(orgId, source);
  switch (source.kind) {
    case 'zendesk': {
      const { zendeskSupportProvider } = await import('./providers/zendesk');
      return zendeskSupportProvider(source, credentials);
    }
    case 'intercom': {
      const { intercomSupportProvider } = await import('./providers/intercom');
      return intercomSupportProvider(source, credentials);
    }
    case 'freshdesk': {
      const { freshdeskSupportProvider } = await import('./providers/freshdesk');
      return freshdeskSupportProvider(source, credentials);
    }
    default:
      throw new Error(`${source.slug} is a ${source.kind} source, which no help-desk provider serves yet.`);
  }
}
