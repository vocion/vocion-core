/**
 * NetSuite as a finance provider: the OAuth 1.0a signature (checked against
 * one computed independently), the SuiteQL each list sends, and the mapping
 * of its rows. Fictional cast; no live calls.
 */
import { describe, expect, it } from 'vitest';
import { netsuiteAccount, netsuiteAuthorization, netsuiteFinanceProvider, netsuiteQuery } from './netsuite';

const CREDS = {
  accountId: '1234567_SB1',
  consumerKey: 'ck_fixture_northwind_0001',
  consumerSecret: 'cs_fixture_secret_0001',
  tokenId: 'tk_fixture_northwind_0001',
  tokenSecret: 'ts_fixture_secret_0001',
};

type Seen = { url: string; auth: string; q: string };

function fakeFetch(answers: Array<{ items: unknown[]; hasMore?: boolean }>, seen: Seen[] = []) {
  let i = 0;
  return async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    seen.push({ url, auth: headers.authorization!, q: JSON.parse(String(init?.body)).q });
    const answer = answers[Math.min(i++, answers.length - 1)];
    return new Response(JSON.stringify(answer), { status: 200 });
  };
}

function provider(credentials: Record<string, unknown>, fetchImpl: ReturnType<typeof fakeFetch>) {
  return netsuiteFinanceProvider({ orgId: 'org_a', source: { id: 1, slug: 'netsuite', config: {} }, credentials, persistence: { kind: 'never' }, fetch: fetchImpl });
}

describe('netsuite finance provider', () => {
  it('derives the REST host and the OAuth realm from the account id', () => {
    expect(netsuiteAccount('1234567_SB1')).toEqual({ host: 'https://1234567-sb1.suitetalk.api.netsuite.com', appHost: 'https://1234567-sb1.app.netsuite.com', realm: '1234567_SB1' });
  });

  it('signs with HMAC-SHA256 over the method, the URL and every parameter, query included', () => {
    const header = netsuiteAuthorization({ method: 'POST', url: 'https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=5&offset=0', credentials: CREDS, nonce: 'nonce123', timestamp: 1790000000 });

    expect(header.startsWith('OAuth realm="1234567_SB1", ')).toBe(true);
    expect(header).toContain('oauth_signature_method="HMAC-SHA256"');
    expect(header).toContain(`oauth_signature="${encodeURIComponent('i5N96dntCPwQxt5nmt4CTIwwqOil0S5uaxOufUBfaJs=')}"`);
    expect(header).not.toContain('cs_fixture_secret_0001');
    expect(header).not.toContain('ts_fixture_secret_0001');
  });

  it('builds SuiteQL from its own values, escaping text and refusing a party id that is not digits', () => {
    const { sql, ignored } = netsuiteQuery('invoice', { query: 'O\'Brien', status: 'open', partyId: '1 OR 1=1', since: '2026-09-01', updatedSince: new Date('2026-09-30T08:00:00Z') });

    expect(sql).toContain('t.type = \'CustInvc\'');
    expect(sql).toContain('LIKE \'%o\'\'brien%\'');
    expect(sql).toContain('t.trandate >= TO_DATE(\'2026-09-01\', \'YYYY-MM-DD\')');
    expect(sql).toContain('t.lastmodifieddate >= TO_TIMESTAMP(\'2026-09-30 08:00:00\', \'YYYY-MM-DD HH24:MI:SS\')');
    expect(sql).not.toContain('1=1');
    expect(ignored).toEqual(['party_id']);
    expect(() => netsuiteQuery('bill', { since: '2026-09-01\' OR 1=1' })).toThrow(/not an ISO date/);
  });

  it('lists invoices with their party, balance and a link into NetSuite, paging by offset', async () => {
    const seen: Seen[] = [];
    const p = provider(CREDS, fakeFetch([{ items: [{ id: 101, tranid: 'INV-0042', trandate: '2026-09-01', duedate: '2026-10-01', status: 'Invoice : Open', entity: 77, entityname: 'Contoso Supply', foreigntotal: 12500, foreignamountremaining: 10000, currency: 'USD', lastmodified: '2026-09-02T10:00:00' }], hasMore: true }], seen));
    const page = await p.list('invoice', { limit: 1 });

    expect(page.records[0]).toMatchObject({ id: '101', number: 'INV-0042', party: 'Contoso Supply', status: 'Invoice : Open', amount: 12500, balance: 10000, date: '2026-09-01', dueDate: '2026-10-01', updatedAt: '2026-09-02T10:00:00Z', url: 'https://1234567-sb1.app.netsuite.com/app/accounting/transactions/custinvc.nl?id=101' });
    expect(page.nextCursor).toBe('offset:1');
    expect(seen[0]!.url).toBe('https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1&offset=0');
  });

  it('gets a bill whole, its lines from transactionline', async () => {
    const seen: Seen[] = [];
    const p = provider(CREDS, fakeFetch([
      { items: [{ id: 202, tranid: 'B-7', entityname: 'Acme', foreigntotal: 900, foreignamountremaining: 900, currency: 'USD' }] },
      { items: [{ item: 'Freight', memo: 'September', quantity: -2, foreignamount: -900 }] },
    ], seen));
    const record = await p.get('bill', '202');

    expect(record.lines).toEqual([{ description: 'Freight: September', quantity: 2, amount: 900 }]);
    expect(seen[1]!.q).toContain('tl.transaction = 202');
    await expect(p.get('bill', '202; DROP')).rejects.toThrow(/not a NetSuite internal id/);
  });

  it('each provider instance signs with its own token', async () => {
    const seen: Seen[] = [];
    const a = provider(CREDS, fakeFetch([{ items: [] }], seen));
    const b = provider({ ...CREDS, accountId: '7654321', tokenId: 'tk_fixture_kestrel_0002' }, fakeFetch([{ items: [] }], seen));
    await a.list('customer', { limit: 1 });
    await b.list('customer', { limit: 1 });

    expect(seen[0]!.auth).toContain('oauth_token="tk_fixture_northwind_0001"');
    expect(seen[0]!.url.startsWith('https://1234567-sb1.')).toBe(true);
    expect(seen[1]!.auth).toContain('oauth_token="tk_fixture_kestrel_0002"');
    expect(seen[1]!.auth).toContain('realm="7654321"');
  });

  it('names what an incomplete credential is missing', () => {
    expect(() => provider({ accountId: '1234567' }, fakeFetch([]))).toThrow(/missing consumerKey, consumerSecret, tokenId, tokenSecret/);
  });
});
