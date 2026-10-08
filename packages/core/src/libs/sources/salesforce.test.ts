/**
 * The Salesforce connector against a recorded API: records become documents
 * whose content is who or what they are (stage and amount are metadata), an
 * incremental run asks only for what changed, pages follow nextRecordsUrl, a
 * pasted client-credentials app mints its own token, and Test connection says
 * what it found. Every org, record and token here is invented.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));

const { salesforceConnector } = await import('./salesforce');

const INSTANCE = 'https://northwind.my.salesforce.com';
const LOGIN = { accessToken: '00Dxx!login', refreshToken: 'r-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), instanceUrl: INSTANCE, account: 'ops@northwind.example' };

const ACCOUNT = { attributes: { type: 'Account' }, Id: '001xx000003DGb2AAG', Name: 'Kestrel Capital', Website: 'https://www.kestrel.example', Industry: 'Finance', Description: 'Growth equity.', OwnerId: '005xx000001X8UzAAK', Owner: { Name: 'Dana Reyes' }, CreatedDate: '2026-01-02T00:00:00.000+0000', LastModifiedDate: '2026-09-30T10:00:00.000+0000' };
const CONTACT = { attributes: { type: 'Contact' }, Id: '003xx000004TmiQAAS', Name: 'Ari Moss', FirstName: 'Ari', LastName: 'Moss', Email: 'ari@kestrel.example', Title: 'COO', AccountId: ACCOUNT.Id, Account: { Name: 'Kestrel Capital' }, Owner: { Name: 'Dana Reyes' }, LastModifiedDate: '2026-09-30T10:00:00.000+0000' };
const DEAL = { attributes: { type: 'Opportunity' }, Id: '006xx000001a2bCAAQ', Name: 'Kestrel platform', StageName: 'Negotiation', Amount: 120000, CloseDate: '2026-11-30', IsClosed: false, AccountId: ACCOUNT.Id, Account: { Name: 'Kestrel Capital' }, Owner: { Name: 'Dana Reyes' }, LastModifiedDate: '2026-10-01T09:00:00.000+0000' };
const TASK = { attributes: { type: 'Task' }, Id: '00Txx000002AbCdEAK', Subject: 'Call', Description: 'Asked for the security review.', IsClosed: true, ActivityDate: '2026-09-29', TaskSubtype: 'Call', WhatId: DEAL.Id, What: { Name: 'Kestrel platform' }, Owner: { Name: 'Dana Reyes' }, LastModifiedDate: '2026-09-29T15:00:00.000+0000' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return { sourceId: 7, orgId: 'org_northwind', config: {}, credentials: LOGIN, ...over };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

/**
 * A recorded org: answers each SOQL query by the object it selects FROM.
 * @param seen - Collects every URL asked for.
 */
function org(seen: string[]) {
  return vi.fn(async (url: string) => {
    seen.push(decodeURIComponent(url));
    const soql = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
    const from = /FROM (\w+)/.exec(soql)?.[1];
    const rows = from === 'Account' ? [ACCOUNT] : from === 'Contact' ? [CONTACT] : from === 'Opportunity' ? [DEAL] : from === 'Task' ? [TASK] : [];
    return json({ totalSize: rows.length, done: true, records: rows });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('salesforceConnector.sync', () => {
  it('yields accounts, contacts, opportunities and activity, identity in content and the rest in metadata', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', org(seen));
    const docs = await collect(salesforceConnector.sync(ctx()));
    const byId = Object.fromEntries(docs.map(d => [d.externalId, d]));

    expect(Object.keys(byId)).toEqual([
      `salesforce:account:${ACCOUNT.Id}`,
      `salesforce:contact:${CONTACT.Id}`,
      `salesforce:deal:${DEAL.Id}`,
      `salesforce:activity:${TASK.Id}`,
    ]);
    expect(byId[`salesforce:contact:${CONTACT.Id}`]!.content).toBe('Ari Moss\nCOO at Kestrel Capital\nari@kestrel.example');
    expect(byId[`salesforce:account:${ACCOUNT.Id}`]!.metadata).toMatchObject({ domain: 'kestrel.example', industry: 'Finance', owner: 'Dana Reyes' });

    const deal = byId[`salesforce:deal:${DEAL.Id}`]!;

    expect(deal.content).toBe('Kestrel platform\nKestrel Capital');
    expect(deal.content).not.toContain('Negotiation');
    expect(deal.metadata).toMatchObject({ stage: 'Negotiation', amount: 120000, dealOpen: true, accountName: 'Kestrel Capital' });
    expect(deal.uri).toBe(`${INSTANCE}/lightning/r/Opportunity/${DEAL.Id}/view`);
    expect(byId[`salesforce:activity:${TASK.Id}`]!.content).toContain('Asked for the security review.');
    // A full run reads every record; only activity is windowed.
    expect(seen.find(u => u.includes('FROM Account'))).not.toContain('WHERE');
    expect(seen.find(u => u.includes('FROM Task'))).toContain('WHERE LastModifiedDate >= ');
  });

  it('asks only for what changed since the watermark when incremental', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', org(seen));
    await collect(salesforceConnector.sync(ctx({ since: new Date('2026-10-01T00:00:00.000Z'), config: { objects: ['accounts', 'activities'] } })));

    expect(seen.some(u => u.includes('FROM Contact'))).toBe(false);
    expect(seen.find(u => u.includes('FROM Account'))).toContain('WHERE SystemModstamp >= 2026-10-01T00:00:00Z');
    expect(seen.find(u => u.includes('FROM Task'))).toContain('AND SystemModstamp >= 2026-10-01T00:00:00Z');
  });

  it('follows nextRecordsUrl across pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ done: false, nextRecordsUrl: '/services/data/v61.0/query/01gxx-2000', records: [ACCOUNT] }))
      .mockResolvedValueOnce(json({ done: true, records: [{ ...ACCOUNT, Id: '001xx000003DGb3AAG', Name: 'Contoso Supply' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(salesforceConnector.sync(ctx({ config: { objects: ['accounts'] } })));

    expect(docs.map(d => d.title)).toEqual(['Kestrel Capital', 'Contoso Supply']);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`${INSTANCE}/services/data/v61.0/query/01gxx-2000`);
  });

  it('mints a token from a pasted client-credentials app, once, and calls the org it names', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith('/services/oauth2/token')) {
        expect(new URLSearchParams(String(init?.body)).get('grant_type')).toBe('client_credentials');

        return json({ access_token: '00Dxx!cc', instance_url: INSTANCE });
      }

      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer 00Dxx!cc');

      return json({ done: true, records: [] });
    }));
    const pasted = { instanceUrl: 'https://kestrel-cc.my.salesforce.com', clientId: '3MVG9-fixture', clientSecret: 'cc-secret-1' };
    await collect(salesforceConnector.sync(ctx({ credentials: pasted, config: { objects: ['accounts'] } })));
    await collect(salesforceConnector.sync(ctx({ credentials: pasted, config: { objects: ['accounts'] } })));

    expect(calls.filter(u => u.endsWith('/oauth2/token'))).toEqual(['https://kestrel-cc.my.salesforce.com/services/oauth2/token']);
  });

  it('refuses to run without a credential, and names both ways to connect', async () => {
    await expect(collect(salesforceConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/Connect with Salesforce.*client-credentials/);
  });

  it('throws the vendor\'s refusal so the run is marked failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID' }], 401)));

    await expect(collect(salesforceConnector.sync(ctx({ config: { objects: ['accounts'] } })))).rejects.toThrow(/Salesforce refused the credential \(HTTP 401: Session expired or invalid\)/);
  });
});

describe('salesforceConnector.inspect', () => {
  it('reports the API allowance and what this user can read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/limits')) {
        return json({ DailyApiRequests: { Max: 15000, Remaining: 14980 } });
      }
      return json({ totalSize: 12, done: true, records: [] });
    }));
    const out = await salesforceConnector.inspect!({ config: {}, credentials: LOGIN, options: {} }) as { authorized: boolean; checks: Array<{ key: string; ok: boolean; detail: string }> };

    expect(out.authorized).toBe(true);
    expect(out.checks.map(c => [c.key, c.ok])).toEqual([['token', true], ['account', true], ['deal', true]]);
    expect(out.checks[0]!.detail).toContain('14980 of 15000 API requests left today');
  });

  it('says the token was refused, in Salesforce\'s words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID' }], 401)));
    const out = await salesforceConnector.inspect!({ config: {}, credentials: LOGIN, options: {} }) as { authorized: boolean; error: string };

    expect(out.authorized).toBe(false);
    expect(out.error).toMatch(/Session expired or invalid/);
  });

  it('asks for a credential when none was typed', async () => {
    await expect(salesforceConnector.inspect!({ config: {}, credentials: {}, options: {} })).rejects.toThrow(/Connect with Salesforce/);
  });
});
