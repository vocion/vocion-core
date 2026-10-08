/**
 * QuickBooks Online as a finance provider: the sample company (no login),
 * the query a live list sends, and that each login spends its own token.
 * Fictional cast; no live calls.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Env', () => ({ Env: {} }));

const { quickbooksFinanceProvider, quickbooksListQuery } = await import('./quickbooks');

type Seen = { url: string; auth: string };

function fakeFetch(answer: unknown, seen: Seen[] = []) {
  return async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: (init?.headers as Record<string, string>).authorization! });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
}

const LOGIN = { accessToken: 'qat-northwind', refreshToken: 'qrt', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), realmId: '9130350000000001', environment: 'sandbox' };

function provider(credentials: Record<string, unknown>, config: Record<string, unknown>, fetchImpl?: ReturnType<typeof fakeFetch>) {
  return quickbooksFinanceProvider({ orgId: 'org_a', source: { id: 1, slug: 'quickbooks', config }, credentials, persistence: { kind: 'never' }, fetch: fetchImpl });
}

describe('quickbooks finance provider', () => {
  it('reads the sample company with no login: what it holds, filtered, and nothing it does not', async () => {
    const p = await provider({}, { sample: true });

    expect(p.vendor).toBe('QuickBooks (sample company)');
    expect(p.kinds).toEqual(['invoice', 'bill', 'payment', 'account']);

    const invoices = await p.list('invoice', { limit: 100 });

    expect(invoices.records.length).toBeGreaterThan(0);
    expect(invoices.records.every(r => r.url === null)).toBe(true);

    const unpaid = await p.list('invoice', { limit: 100, status: 'unpaid' });

    expect(unpaid.records.every(r => r.status === 'unpaid')).toBe(true);

    const one = await p.get('invoice', invoices.records[0]!.id);

    expect(one.id).toBe(invoices.records[0]!.id);
    await expect(p.list('customer', { limit: 1 })).rejects.toThrow(/holds no customer records/);
  });

  it('builds its query from controlled values, escaping quotes', () => {
    const { sql, ignored } = quickbooksListQuery('customer', { query: 'O\'Brien', status: 'active', since: '2026-09-01' }, 1, 25);

    expect(sql).toBe('SELECT * FROM Customer WHERE DisplayName LIKE \'%O\\\'Brien%\' AND Active = true ORDERBY Metadata.LastUpdatedTime DESC STARTPOSITION 1 MAXRESULTS 25');
    expect(ignored).toEqual(['since/until']);
    expect(quickbooksListQuery('bill', { status: 'open', partyId: '58', updatedSince: new Date('2026-09-30T08:00:00Z') }, 26, 25).sql)
      .toBe('SELECT * FROM Bill WHERE Balance > \'0\' AND VendorRef = \'58\' AND Metadata.LastUpdatedTime >= \'2026-09-30T08:00:00.000Z\' ORDERBY Metadata.LastUpdatedTime DESC STARTPOSITION 26 MAXRESULTS 25');
  });

  it('lists live invoices on the login\'s environment, linked into QuickBooks', async () => {
    const seen: Seen[] = [];
    const p = await provider(LOGIN, {}, fakeFetch({ QueryResponse: { Invoice: [{ Id: '130', DocNumber: '1042', CustomerRef: { value: '58', name: 'Contoso Supply' }, TotalAmt: 12500, Balance: 10000, TxnDate: '2026-09-01', DueDate: '2026-10-01', CurrencyRef: { value: 'USD' } }] } }, seen));
    const page = await p.list('invoice', { limit: 1 });

    expect(page.records[0]).toMatchObject({ number: '1042', party: 'Contoso Supply', status: 'partly paid', amount: 12500, balance: 10000, url: 'https://app.sandbox.qbo.intuit.com/app/invoice?txnId=130' });
    expect(page.nextCursor).toBe('start:2');
    expect(seen[0]!.url.startsWith('https://sandbox-quickbooks.api.intuit.com/v3/company/9130350000000001/query?')).toBe(true);
  });

  it('each login spends its own token', async () => {
    const seen: Seen[] = [];
    const a = await provider(LOGIN, {}, fakeFetch({ QueryResponse: {} }, seen));
    const b = await provider({ ...LOGIN, accessToken: 'qat-kestrel', realmId: '9130350000000002' }, {}, fakeFetch({ QueryResponse: {} }, seen));
    await a.list('account', { limit: 1 });
    await b.list('account', { limit: 1 });

    expect(seen.map(s => s.auth)).toEqual(['Bearer qat-northwind', 'Bearer qat-kestrel']);
    expect(seen[1]!.url).toContain('/company/9130350000000002/');
  });

  it('asks for a login when there is none and no sample', async () => {
    await expect(provider({}, {})).rejects.toThrow(/QuickBooks needs a login/);
  });
});
