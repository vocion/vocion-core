/**
 * Xero as a finance provider, against recorded answers (fictional cast:
 * Northwind's books, Contoso Supply the customer, Acme the supplier). No
 * live calls.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Env', () => ({ Env: {} }));

const { xeroDate, xeroFinanceProvider } = await import('./xero');

type Seen = { method: string; url: string; headers: Record<string, string>; body: string | null };

function fakeFetch(table: Record<string, unknown>, seen: Seen[] = []) {
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    seen.push({ method: init?.method ?? 'GET', url, headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === 'string' ? init.body : null });
    const key = `${init?.method ?? 'GET'} ${u.origin}${u.pathname}`;
    const body = table[key];
    return body === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  };
}

const TENANT = 'bbbb2222-0000-4000-8000-000000000002';
const LOGIN = { accessToken: 'xat-live', refreshToken: 'xrt', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), tenantId: TENANT, tenantName: 'Northwind' };
const INVOICE = {
  InvoiceID: 'cccc3333-0000-4000-8000-000000000003',
  InvoiceNumber: 'INV-0042',
  Type: 'ACCREC',
  Status: 'AUTHORISED',
  Contact: { ContactID: 'dddd4444-0000-4000-8000-000000000004', Name: 'Contoso Supply' },
  DateString: '2026-09-01T00:00:00',
  DueDateString: '2026-10-01T00:00:00',
  Total: 12500,
  AmountDue: 10000,
  AmountPaid: 2500,
  CurrencyCode: 'USD',
  UpdatedDateUTC: '/Date(1790000000000+0000)/',
  LineItems: [{ Description: 'Implementation, phase 1', Quantity: 1, LineAmount: 12500 }],
};

function provider(credentials: Record<string, unknown>, fetchImpl: ReturnType<typeof fakeFetch>, config: Record<string, unknown> = {}) {
  return xeroFinanceProvider({ orgId: 'org_a', source: { id: 1, slug: 'xero', config }, credentials, persistence: { kind: 'never' }, fetch: fetchImpl });
}

describe('xero finance provider', () => {
  it('reads Xero dates in both shapes', () => {
    expect(xeroDate('/Date(1790000000000+0000)/')).toBe('2026-09-21');
    expect(xeroDate('2026-09-01T00:00:00')).toBe('2026-09-01');
    expect(xeroDate('/Date(1790000000000+0000)/', false)).toBe('2026-09-21T14:13:20.000Z');
    expect(xeroDate(null)).toBeNull();
  });

  it('lists sales invoices for the login\'s organisation, filtered and paged', async () => {
    const seen: Seen[] = [];
    const p = await provider(LOGIN, fakeFetch({ 'GET https://api.xero.com/api.xro/2.0/Invoices': { Invoices: [INVOICE] } }, seen));
    const page = await p.list('invoice', { limit: 1, status: 'authorised', partyId: INVOICE.Contact.ContactID, since: '2026-09-01' });

    expect(page.records[0]).toMatchObject({ kind: 'invoice', number: 'INV-0042', party: 'Contoso Supply', status: 'AUTHORISED', amount: 12500, balance: 10000, currency: 'USD', date: '2026-09-01', dueDate: '2026-10-01', url: `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${INVOICE.InvoiceID}` });
    expect(page.nextCursor).toBe('page:2');

    const url = new URL(seen[0]!.url);

    expect(url.searchParams.get('where')).toBe('Type=="ACCREC" AND Date>=DateTime(2026,09,01)');
    expect(url.searchParams.get('Statuses')).toBe('AUTHORISED');
    expect(url.searchParams.get('ContactIDs')).toBe(INVOICE.Contact.ContactID);
    expect(seen[0]!.headers['xero-tenant-id']).toBe(TENANT);
    expect(seen[0]!.headers.authorization).toBe('Bearer xat-live');
  });

  it('asks only for what changed since the watermark', async () => {
    const seen: Seen[] = [];
    const p = await provider(LOGIN, fakeFetch({ 'GET https://api.xero.com/api.xro/2.0/Invoices': { Invoices: [] } }, seen));
    await p.list('bill', { limit: 100, updatedSince: new Date('2026-09-30T08:00:00Z') });

    expect(seen[0]!.headers['If-Modified-Since']).toBe('2026-09-30T08:00:00');
    expect(new URL(seen[0]!.url).searchParams.get('where')).toBe('Type=="ACCPAY"');
  });

  it('escapes quotes so a search cannot change the filter', async () => {
    const seen: Seen[] = [];
    const p = await provider(LOGIN, fakeFetch({ 'GET https://api.xero.com/api.xro/2.0/Contacts': { Contacts: [] } }, seen));
    await p.list('vendor', { limit: 5, status: 'act"ive' });

    expect(new URL(seen[0]!.url).searchParams.get('where')).toBe('IsSupplier==true AND ContactStatus=="ACT\\"IVE"');
  });

  it('gets one invoice whole, with its lines', async () => {
    const p = await provider(LOGIN, fakeFetch({ [`GET https://api.xero.com/api.xro/2.0/Invoices/${INVOICE.InvoiceID}`]: { Invoices: [INVOICE] } }));
    const record = await p.get('invoice', INVOICE.InvoiceID);

    expect(record.lines).toEqual([{ description: 'Implementation, phase 1', quantity: 1, amount: 12500 }]);
  });

  it('reads a customer with what it owes', async () => {
    const p = await provider(LOGIN, fakeFetch({ 'GET https://api.xero.com/api.xro/2.0/Contacts': { Contacts: [{ ContactID: 'c1', Name: 'Contoso Supply', EmailAddress: 'ap@contoso.example', ContactStatus: 'ACTIVE', Balances: { AccountsReceivable: { Outstanding: 10000, Overdue: 0 } } }] } }));
    const page = await p.list('customer', { limit: 10, query: 'Contoso' });

    expect(page.records[0]).toMatchObject({ title: 'Contoso Supply', balance: 10000, details: { email: 'ap@contoso.example' } });
  });

  it('mints a custom connection\'s token per call and finds its one organisation', async () => {
    const seen: Seen[] = [];
    const p = await provider({ clientId: 'CUSTOMCLIENTID0000000000000000AA', clientSecret: 'custom-secret-aa' }, fakeFetch({
      'POST https://identity.xero.com/connect/token': { access_token: 'xat-custom', expires_in: 1800 },
      'GET https://api.xero.com/connections': [{ tenantId: TENANT, tenantType: 'ORGANISATION' }],
      'GET https://api.xero.com/api.xro/2.0/Accounts': { Accounts: [{ AccountID: 'a1', Code: '200', Name: 'Sales', Type: 'REVENUE', Status: 'ACTIVE' }] },
    }, seen));
    const page = await p.list('account', { limit: 10, query: 'sales' });

    expect(new URLSearchParams(seen[0]!.body!).get('grant_type')).toBe('client_credentials');
    expect(seen.at(-1)!.headers['xero-tenant-id']).toBe(TENANT);
    expect(page.records[0]).toMatchObject({ number: '200', title: '200 Sales' });
  });

  it('each provider instance sends its own credential', async () => {
    const seen: Seen[] = [];
    const table = { 'GET https://api.xero.com/api.xro/2.0/Payments': { Payments: [] } };
    const a = await provider(LOGIN, fakeFetch(table, seen));
    const b = await provider({ ...LOGIN, accessToken: 'xat-kestrel', tenantId: 'eeee5555-0000-4000-8000-000000000005' }, fakeFetch(table, seen));
    await a.list('payment', { limit: 1 });
    await b.list('payment', { limit: 1 });

    expect(seen.map(s => [s.headers.authorization, s.headers['xero-tenant-id']])).toEqual([['Bearer xat-live', TENANT], ['Bearer xat-kestrel', 'eeee5555-0000-4000-8000-000000000005']]);
  });

  it('says what to do when nothing is stored', async () => {
    await expect(provider({}, fakeFetch({}))).rejects.toThrow(/No Xero login or custom connection is stored/);
  });
});
