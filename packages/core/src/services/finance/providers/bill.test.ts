/**
 * BILL as a finance provider, against recorded answers (fictional cast:
 * Northwind pays its bills, Contoso Supply is a vendor, Acme a customer).
 * No live calls.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ BILL_DEV_KEY: undefined as string | undefined }));
vi.mock('@/libs/Env', () => ({ Env: env }));

const { billFinanceProvider } = await import('./bill');

type Seen = { method: string; url: string; body: string | null; headers: Record<string, string> };

function fakeFetch(table: Record<string, unknown>, seen: Seen[] = []) {
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    seen.push({ method, url, body: typeof init?.body === 'string' ? init.body : null, headers: (init?.headers ?? {}) as Record<string, string> });
    const entry = table[`${method} ${u.pathname}`];
    if (entry === undefined) {
      return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    }
    if (entry && typeof entry === 'object' && 'status' in entry && typeof (entry as { status: unknown }).status === 'number') {
      const b = entry as { status: number; body: unknown };
      return new Response(JSON.stringify(b.body), { status: b.status });
    }
    return new Response(JSON.stringify(entry), { status: 200 });
  };
}

const LOGIN = { 'POST /connect/v3/login': { sessionId: 'sess_fixture_northwind_01', organizationId: '00801FIXTURE0001', userId: '00601FIXTURE0001' } };
const CREDS = { username: 'ap-bot@northwind.example', password: 'fixture-password', organizationId: '00801FIXTURE0001', devKey: '01FIXTUREDEVKEY0001' };

const BILL = {
  id: '00n01FIXTUREBILL01',
  vendorId: '00901FIXTUREVEND01',
  vendorName: 'Contoso Supply',
  invoice: { invoiceNumber: 'CS-2207', invoiceDate: '2026-09-10' },
  dueDate: '2026-10-10',
  amount: 4800,
  dueAmount: 4800,
  paymentStatus: 'UNPAID',
  approvalStatus: 'APPROVING',
  createdTime: '2026-09-10T15:00:00.000+00:00',
  updatedTime: '2026-09-11T09:00:00.000+00:00',
  billLineItems: [{ description: 'Pallet racking', quantity: 4, amount: 4800 }],
};

function provider(fetchImpl: ReturnType<typeof fakeFetch>, credentials: Record<string, unknown> = CREDS, config: Record<string, unknown> = {}) {
  return billFinanceProvider({ orgId: 'org_a', source: { id: 1, slug: 'bill', config }, credentials, persistence: { kind: 'never' }, fetch: fetchImpl });
}

beforeEach(() => {
  env.BILL_DEV_KEY = undefined;
});

describe('bill finance provider', () => {
  it('signs in once with the user, organization and developer key, then reads bills with the session', async () => {
    const seen: Seen[] = [];
    const p = provider(fakeFetch({ ...LOGIN, 'GET /connect/v3/bills': { results: [BILL], nextPage: 'pg_fixture_2' } }, seen));
    const page = await p.list('bill', { limit: 20 });
    await p.list('bill', { limit: 20, cursor: 'pg_fixture_2' });

    expect(JSON.parse(seen[0]!.body!)).toEqual({ username: 'ap-bot@northwind.example', password: 'fixture-password', organizationId: '00801FIXTURE0001', devKey: '01FIXTUREDEVKEY0001' });
    expect(seen[1]!.headers).toMatchObject({ devKey: '01FIXTUREDEVKEY0001', sessionId: 'sess_fixture_northwind_01' });
    expect(new URL(seen[1]!.url).searchParams.get('max')).toBe('20');
    expect(new URL(seen[2]!.url).searchParams.get('page')).toBe('pg_fixture_2');
    expect(seen.filter(s => s.method === 'POST')).toHaveLength(1);
    expect(page.records[0]).toMatchObject({ kind: 'bill', number: 'CS-2207', party: 'Contoso Supply', status: 'UNPAID', amount: 4800, balance: 4800, date: '2026-09-10', dueDate: '2026-10-10', url: null, details: { approvalStatus: 'APPROVING', paymentStatus: 'UNPAID' } });
    expect(page.records[0]!.lines).toBeUndefined();
    expect(page.nextCursor).toBe('pg_fixture_2');
  });

  it('gets one bill whole, with its lines', async () => {
    const p = provider(fakeFetch({ ...LOGIN, [`GET /connect/v3/bills/${BILL.id}`]: BILL }));

    expect((await p.get('bill', BILL.id)).lines).toEqual([{ description: 'Pallet racking', quantity: 4, amount: 4800 }]);
  });

  it('maps a receivable invoice and a customer, and names every filter it ignored', async () => {
    const p = provider(fakeFetch({
      ...LOGIN,
      'GET /connect/v3/invoices': { results: [{ id: '00e01FIXTUREINV01', invoiceNumber: 'NW-311', customer: { id: '0cu01FIXTURE01', name: 'Acme Corp' }, totalAmount: 1500, dueAmount: 500, status: 'PARTIAL_PAYMENT', invoiceDate: '2026-09-01', dueDate: '2026-10-01' }] },
      'GET /connect/v3/customers': { results: [{ id: '0cu01FIXTURE01', name: 'Acme Corp', email: 'ap@acme.example', archived: false }] },
    }));
    const invoices = await p.list('invoice', { limit: 5, query: 'Acme', status: 'open', partyId: '0cu01FIXTURE01' });

    expect(invoices.records[0]).toMatchObject({ number: 'NW-311', party: 'Acme Corp', amount: 1500, balance: 500, status: 'PARTIAL_PAYMENT' });
    expect(invoices.ignored).toEqual(['query', 'status', 'party_id']);
    expect((await p.list('customer', { limit: 5 })).records[0]).toMatchObject({ title: 'Acme Corp', status: 'active', details: { email: 'ap@acme.example' } });
  });

  it('uses the sandbox host when the source says so, and the server\'s developer key when the credential has none', async () => {
    env.BILL_DEV_KEY = 'SERVERDEVKEY0001';
    const seen: Seen[] = [];
    const { devKey: _omit, ...withoutKey } = CREDS;
    const p = provider(fakeFetch({ 'POST /connect/v3/login': LOGIN['POST /connect/v3/login'], 'GET /connect/v3/vendors': { results: [] } }, seen), withoutKey, { sandbox: true });
    await p.list('vendor', { limit: 1 });

    expect(new URL(seen[0]!.url).host).toBe('gateway.stage.bill.com');
    expect(JSON.parse(seen[0]!.body!).devKey).toBe('SERVERDEVKEY0001');
  });

  it('says where a developer key goes when there is none, and refuses to build without a sign-in', () => {
    const { devKey: _omit, ...withoutKey } = CREDS;

    expect(() => provider(fakeFetch({}), withoutKey)).toThrow(/BILL needs a developer key: add one to the BILL credential on the Connectors page, or set BILL_DEV_KEY/);
    expect(() => provider(fakeFetch({}), {})).toThrow(/No BILL sign-in is stored/);
  });

  it('turns a refused sign-in into a sentence that says who fixes it', async () => {
    const p = provider(fakeFetch({ 'POST /connect/v3/login': { status: 401, body: { message: 'Invalid username or password' } } }));

    await expect(p.list('vendor', { limit: 1 })).rejects.toThrow(/BILL refused the credential \(401\)\. An admin needs to replace it.*Invalid username or password/);
  });

  it('refuses a kind BILL does not hold', async () => {
    await expect(provider(fakeFetch(LOGIN)).list('payout', { limit: 1 })).rejects.toThrow(/BILL holds no payout records here\. It holds: bill, vendor, invoice, customer\./);
  });

  it('signs each org in with its own user: two providers, two sessions', async () => {
    const seen: Seen[] = [];
    const table = { 'GET /connect/v3/vendors': { results: [] } };
    const login = (sessionId: string) => ({ 'POST /connect/v3/login': { sessionId } });
    await provider(fakeFetch({ ...table, ...login('sess_northwind') }, seen)).list('vendor', { limit: 1 });
    await provider(fakeFetch({ ...table, ...login('sess_kestrel') }, seen), { ...CREDS, username: 'ap@kestrel.example', organizationId: '00801FIXTURE0002' }).list('vendor', { limit: 1 });
    const posts = seen.filter(s => s.method === 'POST').map(s => JSON.parse(s.body!).username);
    const gets = seen.filter(s => s.method === 'GET').map(s => s.headers.sessionId);

    expect(posts).toEqual(['ap-bot@northwind.example', 'ap@kestrel.example']);
    expect(gets).toEqual(['sess_northwind', 'sess_kestrel']);
  });
});
