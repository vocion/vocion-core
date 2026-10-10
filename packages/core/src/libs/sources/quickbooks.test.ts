/**
 * The QuickBooks Online connector: the sample company with no login, the
 * mapping of each entity into a document a bookkeeper can read, the live
 * query API (paging, incremental, the sandbox host, failures), and a login
 * whose expiring token is refreshed and whose rotated refresh token is saved.
 * Intuit is a stub; the database is pglite.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = { QUICKBOOKS_CLIENT_ID: 'qb_client', QUICKBOOKS_CLIENT_SECRET: 'qb_app_value' };
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { quickbooksConnector } = await import('./quickbooks');
const { QUICKBOOKS_PAGE_SIZE, quickbooksQuery } = await import('@/libs/quickbooks/client');

const REALM = '4620816365211234';
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const EXPIRED = '2000-01-01T00:00:00.000Z';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

/**
 * Drain a sync, collecting documents and progress errors.
 * @param ctx - The context fields that vary.
 * @param ctx.config - Source config.
 * @param ctx.credentials - The bag the sync loaded.
 * @param ctx.since - Incremental watermark.
 * @param ctx.orgId - The workspace.
 * @param ctx.sourceId - The source row.
 */
async function sync(ctx: { config: Record<string, unknown>; credentials?: Record<string, unknown>; since?: Date; orgId?: string; sourceId?: number }) {
  const docs: IngestDoc[] = [];
  const errors: string[] = [];
  for await (const doc of quickbooksConnector.sync({
    sourceId: ctx.sourceId ?? 1,
    orgId: ctx.orgId ?? 'org_quickbooks',
    config: ctx.config,
    credentials: ctx.credentials,
    since: ctx.since,
    onProgress: event => event.kind === 'error' && errors.push(event.message ?? ''),
  })) {
    docs.push(doc);
  }
  return { docs, errors };
}

/**
 * Stub the query API: each entity answers with the rows given, paged the way
 * Intuit pages, or with a status. Records every call.
 * @param answers - Entity to its rows, or to an HTTP status.
 */
function stubQuickbooks(answers: Partial<Record<string, Array<Record<string, unknown>> | number>>) {
  const calls: Array<{ url: string; authorization: string | null; query: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const authorization = new Headers(init?.headers).get('authorization');
    if (String(url) === TOKEN_URL) {
      calls.push({ url: String(url), authorization, query: null });
      return new Response(JSON.stringify({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }), { status: 200 });
    }
    const query = parsed.searchParams.get('query');
    calls.push({ url: String(url), authorization, query });
    const entity = /FROM (\w+)/.exec(query ?? '')?.[1] ?? '';
    const start = Number(/STARTPOSITION (\d+)/.exec(query ?? '')?.[1] ?? '1');
    const max = Number(/MAXRESULTS (\d+)/.exec(query ?? '')?.[1] ?? '1000');
    const answer = answers[entity];
    if (typeof answer === 'number') {
      return new Response(JSON.stringify({ Fault: { Error: [{ Message: 'Not permitted' }] } }), { status: answer });
    }
    const rows = (answer ?? []).slice(start - 1, start - 1 + max);
    return new Response(JSON.stringify({ QueryResponse: rows.length > 0 ? { [entity]: rows, startPosition: start, maxResults: rows.length } : {}, time: '2026-10-07T12:00:00Z' }), { status: 200 });
  }));
  return calls;
}

const LOGIN = { accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE, realmId: REALM, companyName: 'Larkfield Systems', environment: 'production' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sample data, with no login', () => {
  it('reads the fictional company: every entity, every document marked as sample', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('the sample must not call out');
    }));
    const { docs, errors } = await sync({ config: { sample: true } });

    expect(errors).toEqual([]);

    const byType = (type: string) => docs.filter(doc => doc.metadata?.objectType === type);

    expect(byType('account')).toHaveLength(11);
    expect(byType('invoice')).toHaveLength(5);
    expect(byType('bill')).toHaveLength(3);
    expect(byType('payment')).toHaveLength(2);
    expect(byType('bill-payment')).toHaveLength(2);
    expect(byType('purchase')).toHaveLength(4);
    expect(byType('journal-entry')).toHaveLength(2);

    for (const doc of docs) {
      expect(doc.title).toMatch(/^Sample · /);
      expect(doc.content).toMatch(/^QuickBooks · Larkfield Systems \(sample company\) · sample data, not real books\n/);
      expect(doc.metadata).toMatchObject({ sample: true, realmId: 'sample' });
      expect(doc.externalId).toMatch(/^quickbooks:sample:/);
      // Nothing to open in QuickBooks for a company that does not exist.
      expect(doc.uri).toBeUndefined();
    }
  });

  it('writes an invoice the way a bookkeeper reads it, with its numbers on metadata', async () => {
    const { docs } = await sync({ config: { sample: true } });
    const invoice = docs.find(doc => doc.externalId === 'quickbooks:sample:invoice:131')!;

    expect(invoice.title).toBe('Sample · Invoice 1042 · Northwind');
    expect(invoice.content).toBe([
      'QuickBooks · Larkfield Systems (sample company) · sample data, not real books',
      'Invoice 1042 to Northwind',
      'Dated 2026-09-01, due 2026-10-01',
      'Total USD 14,500.00; balance USD 2,500.00 (partly paid)',
      'Lines:',
      '- Retainer: Monthly operations retainer, September: USD 12,000.00',
      '- Workshop: Onboarding workshop, two sessions (2 × 1,250.00): USD 2,500.00',
    ].join('\n'));
    expect(invoice.metadata).toMatchObject({ objectType: 'invoice', quickbooksId: '131', docNumber: '1042', customer: 'Northwind', total: 14_500, balance: 2_500, status: 'partly paid', currency: 'USD', dueDate: '2026-10-01' });
    expect(invoice.lastModifiedAt).toEqual(new Date('2026-09-22T14:40:00-07:00'));
  });

  it('names the invoice or bill a payment settled, and keeps the link on metadata', async () => {
    const { docs } = await sync({ config: { sample: true } });
    const payment = docs.find(doc => doc.externalId === 'quickbooks:sample:payment:302')!;
    const billPayment = docs.find(doc => doc.externalId === 'quickbooks:sample:bill-payment:402')!;

    expect(payment.content).toContain('Payment received from Northwind on 2026-09-22');
    expect(payment.content).toContain('Amount USD 12,000.00, reference ACH-55871, deposited to Operating Checking');
    expect(payment.content).toContain('Applied to: Invoice 1042');
    expect(payment.metadata).toMatchObject({ direction: 'received', appliedTo: [{ type: 'Invoice', id: '131', docNumber: '1042' }] });
    expect(billPayment.content).toContain('Bill payment made to Corvus Media on 2026-09-30');
    expect(billPayment.content).toContain('Applied to: Bill CM-118');
  });

  it('writes a paid bill, an account and a journal entry', async () => {
    const { docs } = await sync({ config: { sample: true } });
    const find = (id: string) => docs.find(doc => doc.externalId === id)!;

    expect(find('quickbooks:sample:bill:210').content).toContain('Total USD 6,500.00; paid in full');
    expect(find('quickbooks:sample:bill:210').metadata).toMatchObject({ vendor: 'Bellwater Hall', status: 'paid', balance: 0 });
    expect(find('quickbooks:sample:account:84').content).toContain('Account 1200 Accounts Receivable (A/R) (Asset · Accounts Receivable · AccountsReceivable)\nBalance USD 42,100.00 as of 2026-10-01T16:20:00-07:00');
    expect(find('quickbooks:sample:journal-entry:501').content).toContain('- Debit Depreciation: USD 750.00 (Office equipment, September)\n- Credit Accumulated Depreciation: USD 750.00');
    expect(find('quickbooks:sample:journal-entry:501').metadata).toMatchObject({ total: 750 });
  });

  it('writes a card charge with the account each line is coded to, and never "overdue"', async () => {
    const { docs } = await sync({ config: { sample: true } });
    const google = docs.find(doc => doc.externalId === 'quickbooks:sample:purchase:604')!;

    expect(google.title).toBe('Sample · Card charge · Google · 2026-10-01');
    expect(google.content).toBe([
      'QuickBooks · Larkfield Systems (sample company) · sample data, not real books',
      'Card charge to Google on 2026-10-01',
      'Amount USD 588.00, paid from Company Card',
      'Coded to:',
      '- Software and Subscriptions: Google Workspace Business Standard, 12 users, October: USD 168.00',
      '- Marketing: Google Ads, September: USD 420.00',
    ].join('\n'));
    expect(google.metadata).toMatchObject({ objectType: 'purchase', vendor: 'Google', total: 588, txnDate: '2026-10-01', paymentType: 'CreditCard', account: 'Company Card', accounts: ['Software and Subscriptions', 'Marketing'] });
    expect(docs.filter(doc => doc.metadata?.objectType === 'purchase').every(doc => !/overdue/i.test(doc.content))).toBe(true);
  });

  it('reads only what changed since the watermark', async () => {
    const { docs } = await sync({ config: { sample: true }, since: new Date('2026-09-30T18:00:00-07:00') });

    expect(docs.map(doc => doc.externalId).sort()).toEqual([
      'quickbooks:sample:account:35',
      'quickbooks:sample:account:41',
      'quickbooks:sample:account:64',
      'quickbooks:sample:account:66',
      'quickbooks:sample:account:84',
      'quickbooks:sample:invoice:134',
      'quickbooks:sample:journal-entry:501',
      'quickbooks:sample:journal-entry:502',
      'quickbooks:sample:purchase:604',
    ]);
  });
});

describe('a connected company', () => {
  it('needs a login, and says how to get one or try the sample', async () => {
    await expect(sync({ config: {} })).rejects.toThrow(/logs in with QuickBooks on the Connectors page, once per company\. To try the connector first, turn on sample data/);
    await expect(sync({ config: {}, credentials: { token: 'pasted' } })).rejects.toThrow(/needs a login/);
  });

  it('queries every entity on the production host with the login\'s token and the minor version', async () => {
    const calls = stubQuickbooks({ Invoice: [{ Id: '9', DocNumber: '77', CustomerRef: { name: 'Acme Retail' }, TotalAmt: 100, Balance: 100, CurrencyRef: { value: 'USD' } }] });
    const { docs } = await sync({ config: {}, credentials: LOGIN });

    expect(calls.map(call => /FROM (\w+)/.exec(call.query ?? '')?.[1])).toEqual(['Account', 'Invoice', 'Bill', 'Payment', 'BillPayment', 'Purchase', 'JournalEntry']);

    const first = new URL(calls[0]!.url);

    expect(first.origin + first.pathname).toBe(`https://quickbooks.api.intuit.com/v3/company/${REALM}/query`);
    expect(first.searchParams.get('minorversion')).toBe('75');
    expect(calls[0]!.authorization).toBe('Bearer at-good');
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      externalId: `quickbooks:${REALM}:invoice:9`,
      title: 'Invoice 77 · Acme Retail',
      uri: 'https://app.qbo.intuit.com/app/invoice?txnId=9',
      metadata: { company: 'Larkfield Systems', realmId: REALM, status: 'unpaid' },
    });
    expect(docs[0]!.content.startsWith('QuickBooks · Larkfield Systems\n')).toBe(true);
    expect(docs[0]!.metadata?.sample).toBeUndefined();
  });

  it('reads a sandbox company on the sandbox host, and links into the sandbox app', async () => {
    const calls = stubQuickbooks({ Bill: [{ Id: '3', VendorRef: { name: 'Summit Facilities' }, TotalAmt: 50, Balance: 0 }] });
    const { docs } = await sync({ config: {}, credentials: { ...LOGIN, environment: 'sandbox' } });

    expect(calls[0]!.url.startsWith('https://sandbox-quickbooks.api.intuit.com/')).toBe(true);
    expect(docs[0]!.uri).toBe('https://app.sandbox.qbo.intuit.com/app/bill?txnId=3');
  });

  it('pages through more than one page of an entity', async () => {
    const accounts = Array.from({ length: QUICKBOOKS_PAGE_SIZE + 2 }, (_, i) => ({ Id: String(i + 1), Name: `Account ${i + 1}` }));
    const calls = stubQuickbooks({ Account: accounts });
    const { docs } = await sync({ config: {}, credentials: LOGIN });

    expect(docs).toHaveLength(QUICKBOOKS_PAGE_SIZE + 2);
    expect(calls.filter(call => call.query?.includes('FROM Account')).map(call => /STARTPOSITION (\d+)/.exec(call.query!)?.[1])).toEqual(['1', '1001']);
  });

  it('asks only for what changed since the watermark', async () => {
    const calls = stubQuickbooks({});
    await sync({ config: {}, credentials: LOGIN, since: new Date('2026-10-01T00:00:00.000Z') });

    expect(calls[0]!.query).toBe(quickbooksQuery('Account', { start: 1, max: QUICKBOOKS_PAGE_SIZE, since: new Date('2026-10-01T00:00:00.000Z') }));
    expect(calls[0]!.query).toBe('SELECT * FROM Account WHERE Metadata.LastUpdatedTime >= \'2026-10-01T00:00:00.000Z\' STARTPOSITION 1 MAXRESULTS 1000');
  });

  it('reports an entity the login may not read and carries on with the rest', async () => {
    stubQuickbooks({ Bill: 403, Invoice: [{ Id: '1', TotalAmt: 1, Balance: 0 }] });
    const { docs, errors } = await sync({ config: {}, credentials: LOGIN });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/would not let this login read Bill records \(403\).*QuickBooks said: Not permitted/);
    expect(docs.map(doc => doc.metadata?.objectType)).toEqual(['invoice']);
  });

  it('ends the run on a refused login, saying to log in again', async () => {
    stubQuickbooks({ Account: 401 });

    await expect(sync({ config: {}, credentials: LOGIN })).rejects.toThrow(/refused the login \(401\)\. An admin needs to log in with QuickBooks again/);
  });
});

describe('a login whose token has expired', () => {
  it('is refreshed before the sync reads, and the rotated refresh token is saved to the login', async () => {
    const orgId = 'org_quickbooks_refresh';
    const stored = await storeLoginCredential({ orgId, platform: 'quickbooks', name: 'QuickBooks — Larkfield Systems', account: `Larkfield Systems (company ${REALM})`, values: { ...LOGIN, accessToken: 'at-old', expiresAt: EXPIRED }, createdBy: 'user_admin' });
    const [source] = await db.insert(knowledgeSourceSchema).values({
      orgId,
      slug: 'quickbooks',
      kind: 'plugin',
      configJson: { _connector: 'quickbooks' },
      apiTokenId: stored.id,
      apiTokenExclusive: false,
    }).returning({ id: knowledgeSourceSchema.id });
    const calls = stubQuickbooks({});

    await sync({ config: {}, credentials: { ...LOGIN, accessToken: 'at-old', expiresAt: EXPIRED }, orgId, sourceId: source!.id });

    expect(calls[0]!.url).toBe(TOKEN_URL);
    expect(calls[1]!.authorization).toBe('Bearer at-new');

    const saved = await getCredentialsForConnector({ orgId, connectorSlug: 'quickbooks', apiTokenId: stored.id });

    expect(saved).toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new', realmId: REALM, companyName: 'Larkfield Systems' });
  });
});
