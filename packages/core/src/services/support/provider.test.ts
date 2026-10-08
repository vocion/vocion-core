/**
 * The support family's providers: the source decides the desk, search speaks
 * each desk's language, a ticket reads back as one shape with internal notes
 * marked, and a draft reply lands as an internal note — never a public reply.
 * Sources and credentials are mocked; the desks are recorded answers.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));

const sources = vi.hoisted(() => ({ list: [] as FamilySource[] }));
vi.mock('@/libs/connectors/families', async importActual => ({
  ...(await importActual<typeof import('@/libs/connectors/families')>()),
  familySourcesForOrg: vi.fn(async () => sources.list),
}));
vi.mock('@/services/SourceCredentialService', () => ({
  ConnectorCredentialError: class ConnectorCredentialError extends Error {},
  getCredentialsForConnector: vi.fn(async ({ connectorSlug }: { connectorSlug: string }) => ({
    zendesk: { subdomain: 'northwind', email: 'ops@northwind.example', apiToken: 'zd' },
    intercom: { token: 'ic' },
    freshdesk: { domain: 'northwind', apiKey: 'fd' },
  } as Record<string, unknown>)[connectorSlug]),
}));
vi.mock('@/services/ApiTokenService', () => ({ resolvePlatformCredential: vi.fn(async () => null) }));

const { supportProviderFor } = await import('./provider');

type Call = { url: string; method: string; body: unknown };

function vendor(route: (url: string, method: string) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(route(url, method)), { status: 200 });
  }));
  return calls;
}

function only(kind: string, config: Record<string, unknown> = {}) {
  sources.list = [{ id: 1, slug: kind, kind, config, apiTokenId: null }];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('supportProviderFor', () => {
  it('refuses with what is connected when there is none, or more than one and none named', async () => {
    sources.list = [];

    await expect(supportProviderFor('org_1')).rejects.toThrow(/no help desk connected/);

    sources.list = [{ id: 1, slug: 'zendesk', kind: 'zendesk', config: {}, apiTokenId: null }, { id: 2, slug: 'freshdesk', kind: 'freshdesk', config: {}, apiTokenId: null }];

    await expect(supportProviderFor('org_1')).rejects.toThrow(/2 help desk sources; name one.*zendesk \(zendesk\), freshdesk \(freshdesk\)/);
    await expect(supportProviderFor('org_1', { sourceSlug: 'freshdesk' })).resolves.toMatchObject({ kind: 'freshdesk' });
  });
});

describe('zendesk', () => {
  it('searches in Zendesk syntax narrowed to tickets, names requesters, and drafts as a private comment', async () => {
    only('zendesk');
    const calls = vendor((url) => {
      if (url.includes('/search.json')) {
        return { results: [{ id: 5, subject: 'Refund', status: 'open', requester_id: 7, updated_at: '2026-10-01T00:00:00Z' }] };
      }
      if (url.includes('show_many')) {
        return { users: [{ id: 7, name: 'Dana Reyes' }] };
      }
      return { audit: { events: [{ id: 900, type: 'Comment' }] } };
    });
    const provider = await supportProviderFor('org_1');

    await expect(provider.searchTickets('priority:high', { status: 'open', limit: 5 })).resolves.toEqual([{ id: '5', url: 'https://northwind.zendesk.com/agent/tickets/5', subject: 'Refund', status: 'open', requester: 'Dana Reyes', updated: '2026-10-01T00:00:00Z' }]);
    expect(new URL(calls[0]!.url).searchParams.get('query')).toBe('type:ticket priority:high status:open');

    await expect(provider.addInternalNote('#5', 'Hi Dana, the refund is on its way.')).resolves.toEqual({ noteId: '900', url: 'https://northwind.zendesk.com/agent/tickets/5' });
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { ticket: { comment: { body: 'Hi Dana, the refund is on its way.', public: false } } } });
  });

  it('reads a ticket whole, the thread in order with internal notes marked', async () => {
    only('zendesk');
    vendor((url) => {
      if (url.includes('/comments.json')) {
        return { comments: [{ id: 1, author_id: 7, public: true, plain_body: 'Help' }, { id: 2, author_id: 8, public: false, plain_body: 'Escalate' }], users: [{ id: 7, name: 'Dana Reyes', role: 'end-user' }, { id: 8, name: 'Jamie Smith', role: 'admin' }] };
      }
      if (url.includes('show_many')) {
        return { users: [] };
      }
      return { ticket: { id: 5, subject: 'Refund', status: 'pending', requester_id: 7, assignee_id: 8, tags: ['vip'], via: { channel: 'email' } } };
    });

    const ticket = await (await supportProviderFor('org_1')).readTicket('5');

    expect(ticket).toMatchObject({ id: '5', status: 'pending', requester: 'Dana Reyes', assignee: 'Jamie Smith', tags: ['vip'], channel: 'email' });
    expect(ticket.messages).toEqual([
      expect.objectContaining({ author: 'Dana Reyes', authorRole: 'customer', public: true, body: 'Help' }),
      expect.objectContaining({ author: 'Jamie Smith', authorRole: 'agent', public: false, body: 'Escalate' }),
    ]);
  });
});

describe('intercom', () => {
  it('drafts a reply as an admin note written as the token\'s admin, in HTML', async () => {
    only('intercom', { region: 'us' });
    const calls = vendor((url) => {
      if (url.endsWith('/me')) {
        return { id: '991', app: { id_code: 'nw42' } };
      }
      return { id: '501', conversation_parts: { conversation_parts: [{ id: 'p9', part_type: 'note' }] } };
    });

    const out = await (await supportProviderFor('org_1')).addInternalNote('501', 'Hi Dana,\n\nExport is under Settings.');

    expect(out).toEqual({ noteId: 'p9', url: 'https://app.intercom.com/a/inbox/nw42/inbox/conversation/501' });
    expect(calls.find(c => c.url.endsWith('/reply'))?.body).toEqual({ message_type: 'note', type: 'admin', admin_id: '991', body: '<p>Hi Dana,</p><p>Export is under Settings.</p>' });
  });
});

describe('freshdesk', () => {
  it('passes a filter query through with the status folded in, refuses a status it does not have, and drafts a private note', async () => {
    only('freshdesk');
    const calls = vendor((_url, method) => (method === 'POST' ? { id: 77 } : { results: [{ id: 3, subject: 'Login loop', status: 2, requester: { name: 'Dana Reyes' } }] }));
    const provider = await supportProviderFor('org_1');

    await expect(provider.searchTickets('priority:4', { status: 'open', limit: 5 })).resolves.toEqual([expect.objectContaining({ id: '3', status: 'open', requester: 'Dana Reyes' })]);
    expect(new URL(calls[0]!.url).searchParams.get('query')).toBe('"(priority:4) AND status:2"');
    await expect(provider.searchTickets('', { status: 'snoozed', limit: 5 })).rejects.toThrow(/no status "snoozed"/);

    await expect(provider.addInternalNote('3', 'On it.')).resolves.toEqual({ noteId: '77', url: 'https://northwind.freshdesk.com/a/tickets/3' });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { body: '<p>On it.</p>', private: true } });
  });
});
