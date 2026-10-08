/**
 * Ramp as a finance provider, against recorded answers (fictional cast:
 * Northwind is the company, Contoso Supply a vendor). No live calls.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { rampAmount, rampFinanceProvider } from './ramp';

type Seen = { method: string; url: string; body: string | null; auth: string | null };

function fakeFetch(table: Record<string, unknown>, seen: Seen[] = []) {
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    seen.push({ method, url, body: typeof init?.body === 'string' ? init.body : null, auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null });
    const entry = table[`${method} ${u.pathname}`];
    if (entry === undefined) {
      return new Response(JSON.stringify({ error_v2: { message: 'not found' } }), { status: 404 });
    }
    if (entry && typeof entry === 'object' && 'status' in entry && typeof (entry as { status: unknown }).status === 'number') {
      const b = entry as { status: number; body: unknown };
      return new Response(JSON.stringify(b.body), { status: b.status });
    }
    return new Response(JSON.stringify(entry), { status: 200 });
  };
}

const TOKEN = { 'POST /developer/v1/token': { access_token: 'ramp_tok_fixture_01', token_type: 'Bearer', expires_in: 864000 } };

const TXN = {
  id: '6b1f0c2e-0000-4000-8000-00000000a001',
  amount: 1234.5,
  currency_code: 'USD',
  merchant_name: 'Contoso Supply',
  state: 'CLEARED',
  user_transaction_time: '2026-09-14T17:02:00Z',
  sk_category_name: 'Office supplies',
  memo: 'Q3 restock',
  card_holder: { first_name: 'Dana', last_name: 'Reyes', department_name: 'Operations' },
};

function provider(fetchImpl: ReturnType<typeof fakeFetch>, credentials: Record<string, unknown> = { clientId: 'ramp_id_FixtureNorthwind', clientSecret: 'ramp_sec_FixtureNorthwind' }, config: Record<string, unknown> = {}) {
  return rampFinanceProvider({ orgId: 'org_a', source: { id: 1, slug: 'ramp', config }, credentials, persistence: { kind: 'never' }, fetch: fetchImpl });
}

describe('ramp finance provider', () => {
  it('reads a plain amount as major units and an amount object as minor units', () => {
    expect(rampAmount(12.5, 'usd')).toEqual({ amount: 12.5, currency: 'USD' });
    expect(rampAmount({ amount: 250000, currency_code: 'USD' })).toEqual({ amount: 2500, currency: 'USD' });
    expect(rampAmount(undefined)).toEqual({ amount: null, currency: null });
  });

  it('gets a token with the app\'s client credentials and read scopes, then lists transactions with it', async () => {
    const seen: Seen[] = [];
    const p = provider(fakeFetch({ ...TOKEN, 'GET /developer/v1/transactions': { data: [TXN], page: { next: 'https://api.ramp.com/developer/v1/transactions?start=6b1f&page_size=25' } } }, seen));
    const page = await p.list('transaction', { limit: 25, since: '2026-09-01', until: '2026-09-30' });

    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from('ramp_id_FixtureNorthwind:ramp_sec_FixtureNorthwind').toString('base64')}`);

    const form = new URLSearchParams(seen[0]!.body!);

    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('transactions:read reimbursements:read bills:read vendors:read users:read business:read');
    expect(seen[1]!.auth).toBe('Bearer ramp_tok_fixture_01');

    const url = new URL(seen[1]!.url);

    expect(url.searchParams.get('from_date')).toBe('2026-09-01T00:00:00Z');
    expect(url.searchParams.get('to_date')).toBe('2026-09-30T23:59:59Z');
    expect(page.records[0]).toMatchObject({ kind: 'transaction', party: 'Contoso Supply', amount: 1234.5, currency: 'USD', status: 'CLEARED', date: '2026-09-14', url: null, details: { cardholder: 'Dana Reyes', department: 'Operations' } });
    expect(page.nextCursor).toBe('https://api.ramp.com/developer/v1/transactions?start=6b1f&page_size=25');
  });

  it('follows a next page on its own host only, and asks for the token once', async () => {
    const seen: Seen[] = [];
    const p = provider(fakeFetch({ ...TOKEN, 'GET /developer/v1/transactions': { data: [], page: { next: 'https://elsewhere.example/steal' } } }, seen));
    const page = await p.list('transaction', { limit: 5, cursor: 'https://api.ramp.com/developer/v1/transactions?start=abc' });

    expect(page.nextCursor).toBeNull();
    await expect(p.list('transaction', { limit: 5, cursor: 'https://elsewhere.example/x' })).rejects.toThrow(/not a Ramp page/);
    expect(seen.filter(s => s.method === 'POST')).toHaveLength(1);
  });

  it('maps a bill\'s minor-unit amount and says which filters it ignored', async () => {
    const p = provider(fakeFetch({ ...TOKEN, 'GET /developer/v1/bills': { data: [{ id: 'bill_fixture_01', invoice_number: 'CS-1001', vendor: { remote_name: 'Contoso Supply' }, amount: { amount: 480000, currency_code: 'USD' }, status: 'OPEN', approval_status: 'APPROVED', payment_status: 'UNPAID', due_at: '2026-10-15T00:00:00Z', issued_at: '2026-09-15T00:00:00Z' }], page: { next: null } } }));
    const page = await p.list('bill', { limit: 10, query: 'Contoso', since: '2026-09-01', status: 'OPEN' });

    expect(page.records[0]).toMatchObject({ number: 'CS-1001', party: 'Contoso Supply', amount: 4800, currency: 'USD', dueDate: '2026-10-15', details: { approvalStatus: 'APPROVED', paymentStatus: 'UNPAID' } });
    expect(page.ignored).toEqual(['since', 'query', 'status']);
  });

  it('gets one vendor', async () => {
    const p = provider(fakeFetch({ ...TOKEN, 'GET /developer/v1/vendors/ven_fixture_01': { id: 'ven_fixture_01', name: 'Acme Logistics', is_active: true } }));

    expect(await p.get('vendor', 'ven_fixture_01')).toMatchObject({ title: 'Acme Logistics', status: 'active' });
  });

  it('turns a refused app into a sentence that says who fixes it', async () => {
    const p = provider(fakeFetch({ 'POST /developer/v1/token': { status: 401, body: { error: 'invalid_client' } } }));

    await expect(p.list('vendor', { limit: 2 })).rejects.toThrow(/Ramp refused the credential \(401\)\. An admin needs to replace it/);
  });

  it('refuses a kind Ramp does not hold, and refuses to build without an app', async () => {
    await expect(provider(fakeFetch(TOKEN)).list('invoice', { limit: 1 })).rejects.toThrow(/Ramp holds no invoice records here\. It holds: transaction, reimbursement, bill, vendor\./);
    expect(() => provider(fakeFetch({}), {})).toThrow(/No Ramp app is stored/);
  });

  it('spends each org\'s own app: two providers, two credentials, two tokens', async () => {
    const seen: Seen[] = [];
    const table = { ...TOKEN, 'GET /developer/v1/vendors': { data: [], page: {} } };
    await provider(fakeFetch(table, seen), { clientId: 'ramp_id_Northwind', clientSecret: 'ramp_sec_Northwind' }).list('vendor', { limit: 2 });
    await provider(fakeFetch(table, seen), { clientId: 'ramp_id_Kestrel', clientSecret: 'ramp_sec_Kestrel' }, { baseUrl: 'https://demo-api.ramp.com' }).list('vendor', { limit: 2 });
    const posts = seen.filter(s => s.method === 'POST');

    expect(posts.map(s => Buffer.from(s.auth!.slice(6), 'base64').toString())).toEqual(['ramp_id_Northwind:ramp_sec_Northwind', 'ramp_id_Kestrel:ramp_sec_Kestrel']);
    expect(new URL(posts[1]!.url).host).toBe('demo-api.ramp.com');
  });
});
