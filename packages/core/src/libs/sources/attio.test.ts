/**
 * The Attio connector against a recorded API: each value is read by its
 * attribute type, companies come first so a person's company has a name, a
 * record's newest value stands in for its last-modified time, notes are kept
 * to the window, and Test connection names the workspace. Every workspace,
 * record and token is invented.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attioConnector } from './attio';

const TOKEN = 'attio_fixture_token_0001';
const COMPANY_ID = '0b1e8c52-3f7a-4c1d-9e2b-1a2b3c4d5e6f';
const PERSON_ID = '1c2f9d63-4a8b-4d2e-8f3c-2b3c4d5e6f70';
const DEAL_ID = '2d3a0e74-5b9c-4e3f-9a4d-3c4d5e6f7081';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return { sourceId: 11, orgId: 'org_northwind', config: {}, credentials: { token: TOKEN }, ...over };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

const text = (value: string, at = '2026-09-01T00:00:00Z') => ({ attribute_type: 'text', value, active_from: at, active_until: null });

const RECORDS: Record<string, unknown[]> = {
  companies: [{ id: { record_id: COMPANY_ID }, created_at: '2026-01-01T00:00:00Z', web_url: `https://app.attio.example/northwind/company/${COMPANY_ID}`, values: {
    name: [text('Acme Robotics')],
    domains: [{ attribute_type: 'domain', domain: 'acme.example', active_from: '2026-01-01T00:00:00Z' }],
    description: [text('Warehouse robots.', '2026-09-20T00:00:00Z')],
  } }],
  people: [{ id: { record_id: PERSON_ID }, created_at: '2026-02-01T00:00:00Z', values: {
    name: [{ attribute_type: 'personal-name', full_name: 'Sam Okoro', first_name: 'Sam', last_name: 'Okoro', active_from: '2026-02-01T00:00:00Z' }],
    email_addresses: [{ attribute_type: 'email-address', email_address: 'sam@acme.example', active_from: '2026-02-01T00:00:00Z' }],
    job_title: [text('Head of Ops')],
    company: [{ attribute_type: 'record-reference', target_object: 'companies', target_record_id: COMPANY_ID, active_from: '2026-02-01T00:00:00Z' }],
  } }],
  deals: [{ id: { record_id: DEAL_ID }, created_at: '2026-03-01T00:00:00Z', values: {
    name: [text('Acme pilot')],
    stage: [{ attribute_type: 'status', status: { title: 'In negotiation' }, active_from: '2026-10-02T08:00:00Z' }],
    value: [{ attribute_type: 'currency', currency_value: 30000, currency_code: 'EUR', active_from: '2026-03-01T00:00:00Z' }],
    owner: [{ attribute_type: 'actor-reference', referenced_actor_type: 'workspace-member', referenced_actor_id: 'm-1', active_from: '2026-03-01T00:00:00Z' }],
    associated_company: [{ attribute_type: 'record-reference', target_object: 'companies', target_record_id: COMPANY_ID, active_from: '2026-03-01T00:00:00Z' }],
  } }],
};

function workspace(seen: string[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method ?? 'GET'} ${decodeURIComponent(url)}`);

    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);

    const path = new URL(url).pathname;
    const query = /\/v2\/objects\/(\w+)\/records\/query$/.exec(path);
    if (query) {
      return json({ data: RECORDS[query[1]!] ?? [] });
    }
    if (path === '/v2/workspace_members') {
      return json({ data: [{ id: { workspace_member_id: 'm-1' }, first_name: 'Dana', last_name: 'Reyes' }] });
    }
    if (path === '/v2/notes') {
      return json({ data: [
        { id: { note_id: '3e4b1f85-6cad-4f40-8b5e-4d5e6f708192' }, parent_object: 'companies', parent_record_id: COMPANY_ID, title: 'Kickoff', content_plaintext: 'They want a pilot in Q1.', created_at: new Date(Date.now() - 86_400_000).toISOString(), created_by_actor: { id: 'm-1' } },
        { id: { note_id: '4f5c2a96-7dbe-4a51-9c6f-5e6f708192a3' }, parent_object: 'companies', parent_record_id: COMPANY_ID, title: 'Old', content_plaintext: 'Long ago.', created_at: '2020-01-01T00:00:00Z' },
      ] });
    }
    if (path === '/v2/self') {
      return json({ active: true, workspace_name: 'Northwind', workspace_slug: 'northwind' });
    }
    return json({ data: [] });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('attioConnector.sync', () => {
  it('yields companies, people, deals and recent notes, each value read by its type', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', workspace(seen));
    const docs = await collect(attioConnector.sync(ctx()));
    const byId = Object.fromEntries(docs.map(d => [d.externalId, d]));

    expect(Object.keys(byId)).toEqual([
      `attio:account:${COMPANY_ID}`,
      `attio:contact:${PERSON_ID}`,
      `attio:deal:${DEAL_ID}`,
      'attio:activity:3e4b1f85-6cad-4f40-8b5e-4d5e6f708192',
    ]);
    expect(byId[`attio:account:${COMPANY_ID}`]!.content).toBe('Acme Robotics\nacme.example\nWarehouse robots.');
    expect(byId[`attio:contact:${PERSON_ID}`]!.content).toBe('Sam Okoro\nHead of Ops at Acme Robotics\nsam@acme.example');
    expect(byId[`attio:deal:${DEAL_ID}`]!.metadata).toMatchObject({ stage: 'In negotiation', amount: 30000, currency: 'EUR', owner: 'Dana Reyes', accountName: 'Acme Robotics' });
    // No record-level stamp: the newest value's active_from stands in.
    expect(byId[`attio:deal:${DEAL_ID}`]!.lastModifiedAt?.toISOString()).toBe('2026-10-02T08:00:00.000Z');
    expect(byId['attio:activity:3e4b1f85-6cad-4f40-8b5e-4d5e6f708192']!.content).toContain('On: Acme Robotics (account)');
    expect(seen.filter(s => s.startsWith('POST'))).toHaveLength(3);
  });

  it('reads only the objects asked for', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', workspace(seen));
    const docs = await collect(attioConnector.sync(ctx({ config: { objects: ['deals'] } })));

    expect(docs.map(d => d.externalId)).toEqual([`attio:deal:${DEAL_ID}`]);
    expect(seen.some(s => s.includes('/notes'))).toBe(false);
  });

  it('refuses to run without a token', async () => {
    await expect(collect(attioConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/No Attio access token/);
  });
});

describe('attioConnector.inspect', () => {
  it('names the workspace the token is for', async () => {
    vi.stubGlobal('fetch', workspace([]));
    const out = await attioConnector.inspect!({ config: {}, credentials: { token: TOKEN }, options: {} }) as { authorized: boolean; checks: Array<{ detail: string | null }> };

    expect(out.authorized).toBe(true);
    expect(out.checks[0]!.detail).toBe('Workspace Northwind.');
  });

  it('says an inactive token is no longer active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ active: false })));
    const out = await attioConnector.inspect!({ config: {}, credentials: { token: TOKEN }, options: {} }) as { authorized: boolean; error: string };

    expect(out.authorized).toBe(false);
    expect(out.error).toMatch(/no longer active/);
  });
});
