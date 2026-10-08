/**
 * The Salesforce CRM provider: each workspace calls its own org with its own
 * credential; a person's words never change a query's meaning; an update
 * records what it overwrote; a note is a completed Task, and Undo deletes
 * that one Task. Every org, record and token is invented.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));

const future = () => new Date(Date.now() + 3_600_000).toISOString();
const CREDENTIALS: Record<string, Record<string, unknown>> = {
  org_northwind: { accessToken: 'tok_northwind', refreshToken: 'r1', expiresAt: future(), instanceUrl: 'https://northwind.my.salesforce.com' },
  org_contoso: { accessToken: 'tok_contoso', refreshToken: 'r2', expiresAt: future(), instanceUrl: 'https://contoso.my.salesforce.com' },
};
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async (input: { orgId: string }) => CREDENTIALS[input.orgId],
}));

const { salesforceCrmProvider } = await import('./salesforce');

const SOURCE: FamilySource = { id: 4, slug: 'salesforce', kind: 'salesforce', config: {}, apiTokenId: null };
const DEAL = { Id: '006xx000001a2bCAAQ', Name: 'Kestrel platform', StageName: 'Negotiation', Amount: 120000, IsClosed: false, Owner: { Name: 'Dana Reyes' }, LastModifiedDate: '2026-10-01T09:00:00.000+0000' };

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

type Call = { url: string; method: string; auth: string | null; body: string };

function recorder(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url: decodeURIComponent(url), method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization'), body: String(init?.body ?? '') };
    calls.push(call);
    return answer(call);
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('salesforceCrmProvider', () => {
  it('calls each workspace\'s own org with its own token, in turn', async () => {
    const calls = recorder(() => json({ done: true, records: [DEAL] }));
    await (await salesforceCrmProvider('org_northwind', SOURCE)).listDeals({ status: 'open', limit: 5 });
    await (await salesforceCrmProvider('org_contoso', SOURCE)).listDeals({ status: 'open', limit: 5 });

    expect(calls.map(c => [new URL(c.url).hostname, c.auth])).toEqual([
      ['northwind.my.salesforce.com', 'Bearer tok_northwind'],
      ['contoso.my.salesforce.com', 'Bearer tok_contoso'],
    ]);
    expect(calls[0]!.url).toContain('WHERE IsClosed = false ORDER BY LastModifiedDate ASC LIMIT 5');
  });

  it('quotes a person\'s words so they cannot change the query', async () => {
    const calls = recorder(() => json({ done: true, records: [] }));
    const provider = await salesforceCrmProvider('org_northwind', SOURCE);
    await provider.search('contact', 'O\'Brien%\' OR Name != \'', 10);

    expect(calls[0]!.url).toContain('WHERE (Name LIKE \'%O\\\'Brien\\%\\\' OR Name != \\\'%\' OR Email LIKE');
  });

  it('refuses an id that is not a Salesforce id before calling anything', async () => {
    const calls = recorder(() => json({}));
    const provider = await salesforceCrmProvider('org_northwind', SOURCE);

    await expect(provider.getRecord('deal', 'Kestrel platform')).rejects.toThrow(/not a Salesforce record id/);
    expect(calls).toHaveLength(0);
  });

  it('records what an update overwrote, then patches', async () => {
    const calls = recorder(call => (call.method === 'PATCH' ? json(undefined, 204) : json({ done: true, records: [{ Id: DEAL.Id, StageName: 'Negotiation', NextStep: null }] })));
    const provider = await salesforceCrmProvider('org_northwind', SOURCE);
    const out = await provider.updateRecord('deal', DEAL.Id, { StageName: 'Closed Won', NextStep: 'Kickoff' });

    expect(out.previous).toEqual({ StageName: 'Negotiation', NextStep: null });
    expect(calls[0]!.url).toContain(`SELECT Id, StageName, NextStep FROM Opportunity WHERE Id = '${DEAL.Id}'`);
    expect(calls[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ StageName: 'Closed Won', NextStep: 'Kickoff' }) });
    expect(calls[1]!.url).toBe(`https://northwind.my.salesforce.com/services/data/v61.0/sobjects/Opportunity/${DEAL.Id}`);
    expect(out.url).toBe(`https://northwind.my.salesforce.com/lightning/r/Opportunity/${DEAL.Id}/view`);
  });

  it('refuses a field name that is not an API name', async () => {
    recorder(() => json({}));
    const provider = await salesforceCrmProvider('org_northwind', SOURCE);

    await expect(provider.updateRecord('deal', DEAL.Id, { 'StageName FROM User --': 'x' })).rejects.toThrow(/not a Salesforce field API name/);
  });

  it('logs a note as a completed Task on the record, and deletes that Task', async () => {
    const calls = recorder(call => (call.method === 'POST' ? json({ id: '00Txx000002AbCdEAK', success: true }, 201) : json(undefined, 204)));
    const provider = await salesforceCrmProvider('org_northwind', SOURCE);
    const note = await provider.addNote('deal', DEAL.Id, { title: 'Call summary', text: 'They want the security review by Friday.' });
    await provider.deleteNote(note.id);

    expect(JSON.parse(calls[0]!.body)).toMatchObject({ Subject: 'Call summary', Description: 'They want the security review by Friday.', Status: 'Completed', WhatId: DEAL.Id });
    expect(calls[1]).toMatchObject({ method: 'DELETE' });
    expect(calls[1]!.url).toContain('/sobjects/Task/00Txx000002AbCdEAK');
  });

  it('names the writable fields and a pick-list\'s values', async () => {
    recorder(() => json({ fields: [{ name: 'StageName', label: 'Stage', type: 'picklist', updateable: true, picklistValues: [{ value: 'Negotiation', active: true }, { value: 'Old', active: false }] }, { name: 'Id', label: 'Opportunity ID', type: 'id', updateable: false }] }));
    const fields = await (await salesforceCrmProvider('org_northwind', SOURCE)).fields('deal');

    expect(fields).toEqual([
      { name: 'StageName', label: 'Stage', type: 'picklist', writable: true, options: ['Negotiation'] },
      { name: 'Id', label: 'Opportunity ID', type: 'id', writable: false },
    ]);
  });

  it('says plainly when the source has no credential', async () => {
    await expect(salesforceCrmProvider('org_nobody', SOURCE)).rejects.toThrow(/has no Salesforce credential/);
  });
});
