/**
 * The three help-desk connectors against recorded vendor answers: each syncs
 * tickets with their threads as documents, asks only for what changed on an
 * incremental run, skips what the desk reports deleted, and says in Test
 * connection whose credential it is — or why it is not accepted. The desks
 * and the people on them are invented.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshdeskConnector, freshdeskCredentialsFrom } from './freshdesk';
import { intercomConnector } from './intercom';
import { normalizeZendeskSubdomain, zendeskConnector } from './zendesk';

type Route = [RegExp, (url: string, init: RequestInit) => unknown, number?];

/**
 * A fetch that answers from a list of routes, and remembers every call.
 * @param routes - Pattern, answer, status.
 */
function vendor(routes: Route[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) {
      return new Response(JSON.stringify({ error: `no route for ${url}` }), { status: 404 });
    }
    return new Response(JSON.stringify(hit[1](url, init)), { status: hit[2] ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function collect(docs: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of docs) {
    out.push(d);
  }
  return out;
}

function ctx(over: Partial<SourceContext>): SourceContext {
  return { sourceId: 1, orgId: 'org_1', config: {}, ...over };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zendesk', () => {
  const credentials = { subdomain: 'https://northwind.zendesk.com/', email: 'ops@northwind.example', apiToken: 'zd_tok_1' };

  it('syncs tickets with their comment threads, skips deleted ones, and authenticates as email/token', async () => {
    const calls = vendor([
      [/incremental\/tickets\/cursor\.json/, () => ({
        tickets: [
          { id: 101, subject: 'Invoice total is off', status: 'open', priority: 'high', requester_id: 7, tags: ['billing'], updated_at: '2026-10-01T10:00:00Z' },
          { id: 102, subject: 'gone', status: 'deleted' },
        ],
        end_of_stream: true,
      })],
      [/tickets\/101\/comments\.json/, () => ({
        comments: [
          { id: 1, author_id: 7, public: true, plain_body: 'The October invoice double-counts seats.', created_at: '2026-10-01T09:00:00Z' },
          { id: 2, author_id: 8, public: false, plain_body: 'Looks like the proration bug.', created_at: '2026-10-01T09:30:00Z' },
        ],
        users: [{ id: 7, name: 'Dana Reyes', role: 'end-user' }, { id: 8, name: 'Jamie Smith', role: 'agent' }],
      })],
    ]);

    const docs = await collect(zendeskConnector.sync(ctx({ config: { lookbackDays: 30 }, credentials })));

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ externalId: 'zendesk:101', title: '#101 Invoice total is off', uri: 'https://northwind.zendesk.com/agent/tickets/101', metadata: { status: 'open', priority: 'high', requester: 'Dana Reyes', tags: ['billing'] } });
    expect(docs[0]!.content).toContain('Dana Reyes (customer): The October invoice double-counts seats.');
    expect(docs[0]!.content).toContain('Jamie Smith (internal note): Looks like the proration bug.');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('ops@northwind.example/token:zd_tok_1').toString('base64')}`);

    // A full run reaches back `lookbackDays`.
    const start = Number(new URL(calls[0]!.url).searchParams.get('start_time'));

    expect(Math.abs(start - (Date.now() / 1000 - 30 * 86_400))).toBeLessThan(60);
  });

  it('asks the export only for what changed since the watermark, less five minutes, and follows the cursor', async () => {
    const since = new Date(Date.now() - 3_600_000);
    const calls = vendor([
      [/start_time=/, () => ({ tickets: [], after_cursor: 'c2', end_of_stream: false })],
      [/cursor=c2/, () => ({ tickets: [], end_of_stream: true })],
    ]);

    await collect(zendeskConnector.sync(ctx({ config: { includeComments: false }, credentials, since })));

    expect(Number(new URL(calls[0]!.url).searchParams.get('start_time'))).toBe(Math.floor(since.getTime() / 1000) - 300);
    expect(calls[1]!.url).toContain('cursor=c2');
  });

  it('Test connection names the agent, and calls out a token Zendesk answered as an anonymous visitor', async () => {
    vendor([[/users\/me/, () => ({ user: { id: 8, name: 'Jamie Smith', role: 'agent' } })], [/tickets\/count/, () => ({ count: { value: 42 } })]]);

    await expect(zendeskConnector.inspect!({ config: {}, credentials, options: {} })).resolves.toMatchObject({ authorized: true, error: null, checks: [{ ok: true, detail: 'Jamie Smith (agent)' }, { ok: true, detail: '42 tickets in the account.' }] });

    vendor([[/users\/me/, () => ({ user: { id: null, name: 'Anonymous user' } })]]);
    const refused = await zendeskConnector.inspect!({ config: {}, credentials, options: {} }) as { authorized: boolean; error: string };

    expect(refused.authorized).toBe(false);
    expect(refused.error).toMatch(/anonymous visitor/);
    await expect(zendeskConnector.inspect!({ config: {}, credentials: { email: 'ops@northwind.example' }, options: {} })).rejects.toThrow(/subdomain/);
    expect(normalizeZendeskSubdomain('Northwind.zendesk.com')).toBe('northwind');
  });
});

describe('intercom', () => {
  it('syncs conversations found by updated time, read whole, in the region the source names', async () => {
    const calls = vendor([
      [/\/me$/, () => ({ id: '991', name: 'Jamie Smith', app: { id_code: 'nw42', name: 'Northwind' } })],
      [/conversations\/search/, () => ({ conversations: [{ id: '501' }], pages: { next: null } })],
      [/conversations\/501/, () => ({
        id: '501',
        state: 'open',
        updated_at: 1_790_000_000,
        source: { subject: '', body: '<p>Can I export my reports?</p>', author: { type: 'user', name: 'Dana Reyes' } },
        conversation_parts: { conversation_parts: [
          { id: 'p1', part_type: 'comment', body: '<p>Yes, from Settings.</p>', author: { type: 'admin', name: 'Jamie Smith' }, created_at: 1_790_000_100 },
          { id: 'p2', part_type: 'note', body: '<p>Check plan limits.</p>', author: { type: 'admin', name: 'Jamie Smith' }, created_at: 1_790_000_200 },
        ] },
      })],
    ]);

    const docs = await collect(intercomConnector.sync(ctx({ config: { region: 'eu', lookbackDays: 7 }, credentials: { token: 'ic_tok_1' } })));

    expect(calls.every(c => c.url.startsWith('https://api.eu.intercom.io/'))).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer ic_tok_1');
    expect(docs[0]).toMatchObject({ externalId: 'intercom:501', title: 'Can I export my reports?', uri: 'https://app.eu.intercom.com/a/inbox/nw42/inbox/conversation/501' });
    expect(docs[0]!.content).toContain('Jamie Smith (agent): Yes, from Settings.');
    expect(docs[0]!.content).toContain('Jamie Smith (internal note): Check plan limits.');

    const search = JSON.parse(String(calls[1]!.init.body)) as { query: { field: string; value: number } };

    expect(search.query.field).toBe('updated_at');
  });

  it('Test connection says whose token it is, or passes the refusal on', async () => {
    vendor([[/\/me$/, () => ({ name: 'Jamie Smith', app: { name: 'Northwind' } })], [/\/conversations\?/, () => ({ total_count: 3 })]]);

    await expect(intercomConnector.inspect!({ config: {}, credentials: { token: 'ic_tok_1' }, options: {} })).resolves.toMatchObject({ authorized: true, checks: [{ detail: 'Jamie Smith in Northwind' }, { ok: true }] });

    vendor([[/\/me$/, () => ({ errors: [{ message: 'Access Token Invalid' }] }), 401]]);

    await expect(intercomConnector.inspect!({ config: {}, credentials: { token: 'bad' }, options: {} })).resolves.toMatchObject({ authorized: false, error: expect.stringContaining('Access Token Invalid') });
  });
});

describe('freshdesk', () => {
  const credentials = { domain: 'northwind.freshdesk.com', apiKey: 'fd_key_1' };

  it('syncs tickets updated in the window with their conversations, page by page', async () => {
    const calls = vendor([
      [/\/tickets\?updated_since=/, url => (url.includes('page=1') ? [{ id: 7, subject: 'Login loop', status: 2, priority: 3, description_text: 'I keep getting logged out.', requester: { name: 'Dana Reyes' }, updated_at: '2026-10-02T00:00:00Z' }] : [])],
      [/tickets\/7\/conversations/, () => [{ id: 70, body_text: 'Cleared the session.', incoming: false, private: false }, { id: 71, body_text: 'SSO misconfigured.', incoming: false, private: true }]],
    ]);

    const docs = await collect(freshdeskConnector.sync(ctx({ config: {}, credentials })));

    expect(docs[0]).toMatchObject({ externalId: 'freshdesk:7', uri: 'https://northwind.freshdesk.com/a/tickets/7', metadata: { status: 'open', priority: 'high' } });
    expect(docs[0]!.content).toContain('Dana Reyes (customer): I keep getting logged out.');
    expect(docs[0]!.content).toContain('Agent (private note): SSO misconfigured.');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('fd_key_1:X').toString('base64')}`);
    expect(calls[0]!.url).toContain('order_by=updated_at');
  });

  it('refuses a credential with no domain, by name', () => {
    expect(freshdeskCredentialsFrom({ apiKey: 'k' })).toMatchObject({ ok: false, message: expect.stringContaining('domain') });
  });
});
