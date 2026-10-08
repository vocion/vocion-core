/**
 * Stripe as a finance provider, against recorded answers (fictional cast:
 * Contoso Supply is the customer, Northwind the account). No live calls.
 */
import { describe, expect, it } from 'vitest';
import { stripeFinanceProvider, stripeMajor } from './stripe';

type Seen = { method: string; url: string; body: string | null; auth: string | null };

/**
 * A fetch that answers from a table keyed by "METHOD path", and records each call.
 * @param table - Answers.
 * @param seen - Calls made.
 */
function fakeFetch(table: Record<string, unknown | ((url: URL) => unknown)>, seen: Seen[] = []) {
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    seen.push({ method, url, body: typeof init?.body === 'string' ? init.body : null, auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null });
    const key = `${method} ${u.pathname}`;
    const entry = table[key];
    if (entry === undefined) {
      return new Response(JSON.stringify({ error: { message: `No such route: ${key}` } }), { status: 404 });
    }
    const body = typeof entry === 'function' ? (entry as (url: URL) => unknown)(u) : entry;
    if (body && typeof body === 'object' && 'status' in body && typeof (body as { status: unknown }).status === 'number') {
      const b = body as { status: number; body: unknown };
      return new Response(JSON.stringify(b.body), { status: b.status });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

const INVOICE = {
  id: 'in_1NwFixtureContoso01',
  object: 'invoice',
  number: 'NW-0042',
  customer: 'cus_FixtureContoso01',
  customer_name: 'Contoso Supply',
  customer_email: 'ap@contoso.example',
  status: 'open',
  currency: 'usd',
  total: 1250000,
  amount_paid: 250000,
  amount_remaining: 1000000,
  created: 1790000000,
  due_date: 1792592000,
  collection_method: 'send_invoice',
  lines: { data: [{ description: 'Implementation, phase 1', quantity: 1, amount: 1250000 }] },
};

function provider(fetchImpl: ReturnType<typeof fakeFetch>, apiKey = 'rk_live_FixtureNorthwind0001') {
  return stripeFinanceProvider({ orgId: 'org_a', source: { id: 1, slug: 'stripe', config: {} }, credentials: { apiKey }, persistence: { kind: 'never' }, fetch: fetchImpl });
}

describe('stripe finance provider', () => {
  it('reads minor units as major, except zero-decimal currencies', () => {
    expect(stripeMajor(1250000, 'usd')).toBe(12500);
    expect(stripeMajor(5000, 'jpy')).toBe(5000);
    expect(stripeMajor(undefined, 'usd')).toBeNull();
  });

  it('lists invoices with the customer, what is still owed and a dashboard link, paging by the last id', async () => {
    const seen: Seen[] = [];
    const p = provider(fakeFetch({ 'GET /v1/invoices': { data: [INVOICE], has_more: true } }, seen));
    const page = await p.list('invoice', { limit: 1, status: 'open', partyId: 'cus_FixtureContoso01', since: '2026-09-01' });

    expect(page.records[0]).toMatchObject({ kind: 'invoice', id: INVOICE.id, number: 'NW-0042', party: 'Contoso Supply', status: 'open', amount: 12500, balance: 10000, currency: 'USD', url: `https://dashboard.stripe.com/invoices/${INVOICE.id}` });
    expect(page.nextCursor).toBe(`after:${INVOICE.id}`);

    const url = new URL(seen[0]!.url);

    expect(url.searchParams.get('status')).toBe('open');
    expect(url.searchParams.get('customer')).toBe('cus_FixtureContoso01');
    expect(url.searchParams.get('created[gte]')).toBe(String(Date.parse('2026-09-01T00:00:00Z') / 1000));
    expect(seen[0]!.auth).toBe('Bearer rk_live_FixtureNorthwind0001');
  });

  it('searches customers by name or email through the Search API, and pages by its token', async () => {
    const seen: Seen[] = [];
    const p = provider(fakeFetch({ 'GET /v1/customers/search': { data: [{ id: 'cus_FixtureContoso01', name: 'Contoso Supply', email: 'ap@contoso.example', created: 1790000000 }], has_more: true, next_page: 'tok_page2' } }, seen));
    const page = await p.list('customer', { limit: 10, query: 'Contoso' });

    expect(new URL(seen[0]!.url).searchParams.get('query')).toBe('name~"Contoso" OR email~"Contoso"');
    expect(page.records[0]).toMatchObject({ title: 'Contoso Supply', details: { email: 'ap@contoso.example' } });
    expect(page.nextCursor).toBe('page:tok_page2');
  });

  it('says which filters a list could not apply', async () => {
    const p = provider(fakeFetch({ 'GET /v1/payouts': { data: [{ id: 'po_Fixture01', amount: 980000, currency: 'usd', status: 'paid', arrival_date: 1790500000, created: 1790400000 }], has_more: false } }));
    const page = await p.list('payout', { limit: 5, query: 'anything', partyId: 'cus_x' });

    expect(page.ignored).toEqual(['query', 'party_id']);
    expect(page.records[0]).toMatchObject({ kind: 'payout', amount: 9800, status: 'paid' });
    expect(page.nextCursor).toBeNull();
  });

  it('gets one invoice whole, with its lines', async () => {
    const p = provider(fakeFetch({ [`GET /v1/invoices/${INVOICE.id}`]: INVOICE }));
    const record = await p.get('invoice', INVOICE.id);

    expect(record.lines).toEqual([{ description: 'Implementation, phase 1', quantity: 1, amount: 12500 }]);
  });

  it('links a test-mode key\'s records to the test dashboard', async () => {
    const p = provider(fakeFetch({ [`GET /v1/invoices/${INVOICE.id}`]: INVOICE }), 'rk_test_FixtureNorthwind0001');

    expect((await p.get('invoice', INVOICE.id)).url).toBe(`https://dashboard.stripe.com/test/invoices/${INVOICE.id}`);
  });

  it('refuses a kind Stripe does not hold, naming the ones it does', async () => {
    const p = provider(fakeFetch({}));

    await expect(p.list('bill', { limit: 1 })).rejects.toThrow(/Stripe holds no bill records here\. It holds: customer, invoice, subscription, payment, payout\./);
  });

  it('turns a refused key into a sentence that says who fixes it', async () => {
    const p = provider(fakeFetch({ 'GET /v1/customers': { status: 401, body: { error: { message: 'Invalid API Key provided: rk_live_****0001' } } } }));

    await expect(p.list('customer', { limit: 1 })).rejects.toThrow(/Stripe refused the credential \(401\)\. An admin needs to replace it/);
  });

  it('drafts an invoice that is never sent: auto_advance off, one item per line, the total read back', async () => {
    const seen: Seen[] = [];
    const draft = { id: 'in_FixtureDraft01', status: 'draft', currency: 'usd', total: 375000, number: null };
    const p = provider(fakeFetch({
      'POST /v1/invoices': draft,
      'POST /v1/invoiceitems': { id: 'ii_Fixture' },
      'GET /v1/invoices/in_FixtureDraft01': draft,
    }, seen));
    const out = await p.draftInvoice!({ customerId: 'cus_FixtureContoso01', lines: [{ description: 'Onboarding workshop', quantity: 1, unitAmount: 2500 }, { description: 'Support hours', quantity: 2.5, unitAmount: 500 }] });

    const created = new URLSearchParams(seen[0]!.body!);

    expect(created.get('auto_advance')).toBe('false');
    expect(created.get('collection_method')).toBe('send_invoice');
    expect(new URLSearchParams(seen[1]!.body!).get('amount')).toBe('250000');
    expect(new URLSearchParams(seen[2]!.body!).get('amount')).toBe('125000');
    expect(new URLSearchParams(seen[2]!.body!).get('description')).toBe('2.5 × Support hours');
    expect(out).toEqual({ id: 'in_FixtureDraft01', number: null, url: 'https://dashboard.stripe.com/invoices/in_FixtureDraft01', total: 3750, currency: 'usd' });
  });

  it('takes a half-built draft back when a line fails', async () => {
    const seen: Seen[] = [];
    const p = provider(fakeFetch({
      'POST /v1/invoices': { id: 'in_FixtureDraft02', status: 'draft', currency: 'usd' },
      'POST /v1/invoiceitems': { status: 403, body: { error: { message: 'The provided key does not have the required permissions' } } },
      'DELETE /v1/invoices/in_FixtureDraft02': { id: 'in_FixtureDraft02', deleted: true },
    }, seen));

    await expect(p.draftInvoice!({ customerId: 'cus_FixtureContoso01', lines: [{ description: 'Onboarding', quantity: 1, unitAmount: 100 }] })).rejects.toThrow(/403/);
    expect(seen.map(s => `${s.method} ${new URL(s.url).pathname}`)).toContain('DELETE /v1/invoices/in_FixtureDraft02');
  });

  it('undo deletes a draft, and leaves an invoice someone has since finalized alone', async () => {
    const seen: Seen[] = [];
    const draft = provider(fakeFetch({ 'GET /v1/invoices/in_D': { id: 'in_D', status: 'draft' }, 'DELETE /v1/invoices/in_D': { deleted: true } }, seen));
    await draft.discardDraftInvoice!('in_D');

    expect(seen.at(-1)!.method).toBe('DELETE');

    const sent = provider(fakeFetch({ 'GET /v1/invoices/in_S': { id: 'in_S', status: 'open' } }));

    await expect(sent.discardDraftInvoice!('in_S')).rejects.toThrow(/is open now, not a draft, so it was left alone/);
  });

  it('refuses to build without a key, in words', () => {
    expect(() => stripeFinanceProvider({ orgId: 'o', source: { id: 1, slug: 'stripe', config: {} }, credentials: {}, persistence: { kind: 'never' } })).toThrow(/No Stripe key is stored/);
  });
});
