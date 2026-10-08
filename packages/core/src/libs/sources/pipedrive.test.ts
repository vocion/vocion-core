/**
 * The Pipedrive connector against a recorded API: organizations first so a
 * person's and a deal's organization has a name, deals carry their stage by
 * name, an incremental run passes `updated_since`, notes stop at the cutoff,
 * the token rides a header and never the URL, and Test connection says whose
 * token it is. Every company, record and token is invented.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pipedriveConnector } from './pipedrive';

const TOKEN = 'pd_fixture_token_northwind_0001';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return { sourceId: 9, orgId: 'org_northwind', config: {}, credentials: { token: TOKEN }, ...over };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

const RECENT = new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
const OLD = '2020-01-01 00:00:00';

function company(seen: Array<{ url: string; token: string | null }>, overrides: Record<string, () => Response> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    seen.push({ url: decodeURIComponent(url), token: new Headers(init?.headers).get('x-api-token') });
    const path = new URL(url).pathname;
    if (overrides[path]) {
      return overrides[path]();
    }
    switch (path) {
      case '/v1/users/me': return json({ success: true, data: { id: 1, name: 'Dana Reyes', email: 'dana@northwind.example', company_name: 'Northwind', company_domain: 'northwind' } });
      case '/v1/users': return json({ success: true, data: [{ id: 1, name: 'Dana Reyes' }] });
      case '/api/v2/pipelines': return json({ success: true, data: [{ id: 1, name: 'Sales' }] });
      case '/api/v2/stages': return json({ success: true, data: [{ id: 3, name: 'Proposal made', pipeline_id: 1 }] });
      case '/api/v2/organizations': return json({ success: true, data: [{ id: 50, name: 'Contoso Supply', owner_id: 1, add_time: '2026-01-01T00:00:00Z', update_time: '2026-09-01T00:00:00Z' }], additional_data: { next_cursor: null } });
      case '/api/v2/persons': return json({ success: true, data: [{ id: 60, name: 'Lee Park', emails: [{ value: 'lee@contoso.example', primary: true }], org_id: 50, owner_id: 1 }], additional_data: {} });
      case '/api/v2/deals': return json({ success: true, data: [{ id: 70, title: 'Contoso rollout', value: 48000, currency: 'USD', status: 'open', stage_id: 3, org_id: 50, owner_id: 1, expected_close_date: '2026-12-01' }, { id: 71, title: 'Gone', is_deleted: true }], additional_data: {} });
      case '/api/v2/activities': return json({ success: true, data: [{ id: 80, subject: 'Discovery call', type: 'call', done: true, deal_id: 70, owner_id: 1, due_date: '2026-09-28', note: '<p>Wants SSO.</p>', update_time: '2026-09-28T10:00:00Z' }], additional_data: {} });
      case '/v1/notes': return json({ success: true, data: [{ id: 90, content: 'Budget <b>approved</b>.', deal_id: 70, add_time: RECENT, update_time: RECENT, user: { name: 'Dana Reyes' } }, { id: 91, content: 'Ancient.', deal_id: 70, add_time: OLD, update_time: OLD }], additional_data: { pagination: { more_items_in_collection: true, next_start: 2 } } });
      default: return json({ success: false, error: 'not found' }, 404);
    }
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('pipedriveConnector.sync', () => {
  it('yields organizations, people, deals, activities and notes in the family shape', async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    vi.stubGlobal('fetch', company(seen));
    const docs = await collect(pipedriveConnector.sync(ctx()));
    const byId = Object.fromEntries(docs.map(d => [d.externalId, d]));

    expect(Object.keys(byId)).toEqual(['pipedrive:account:50', 'pipedrive:contact:60', 'pipedrive:deal:70', 'pipedrive:activity:activity-80', 'pipedrive:activity:note-90']);
    expect(byId['pipedrive:contact:60']!.content).toBe('Lee Park\nContoso Supply\nlee@contoso.example');
    expect(byId['pipedrive:deal:70']!.metadata).toMatchObject({ stage: 'Proposal made', amount: 48000, currency: 'USD', dealOpen: true, accountName: 'Contoso Supply', owner: 'Dana Reyes' });
    expect(byId['pipedrive:deal:70']!.uri).toBe('https://northwind.pipedrive.com/deal/70');
    expect(byId['pipedrive:activity:activity-80']!.content).toContain('Wants SSO.');
    expect(byId['pipedrive:activity:note-90']!.content).toContain('Budget approved.');
    // The old note ends the walk: no second page of notes is asked for.
    expect(seen.filter(s => s.url.includes('/v1/notes'))).toHaveLength(1);
    // The token rides a header, never the URL.
    expect(seen.every(s => s.token === TOKEN && !s.url.includes(TOKEN))).toBe(true);
  });

  it('passes updated_since when incremental', async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    vi.stubGlobal('fetch', company(seen));
    await collect(pipedriveConnector.sync(ctx({ since: new Date('2026-10-01T00:00:00.000Z'), config: { objects: ['deals'] } })));

    expect(seen.find(s => s.url.includes('/api/v2/deals'))!.url).toContain('updated_since=2026-10-01T00:00:00Z');
    expect(seen.some(s => s.url.includes('/api/v2/persons'))).toBe(false);
  });

  it('waits out a 429 and carries on', async () => {
    let refused = false;
    const seen: Array<{ url: string; token: string | null }> = [];
    vi.stubGlobal('fetch', company(seen, {
      '/api/v2/organizations': () => {
        if (!refused) {
          refused = true;
          return json({ success: false }, 429, { 'retry-after': '0' });
        }
        return json({ success: true, data: [{ id: 50, name: 'Contoso Supply' }] });
      },
    }));
    const docs = await collect(pipedriveConnector.sync(ctx({ config: { objects: ['accounts'] } })));

    expect(docs.map(d => d.externalId)).toEqual(['pipedrive:account:50']);
  });

  it('refuses to run without a token', async () => {
    await expect(collect(pipedriveConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/No Pipedrive API token/);
  });
});

describe('pipedriveConnector.inspect', () => {
  it('says whose token it is', async () => {
    vi.stubGlobal('fetch', company([]));
    const out = await pipedriveConnector.inspect!({ config: {}, credentials: { token: TOKEN }, options: {} }) as { authorized: boolean; checks: Array<{ ok: boolean; detail: string | null }> };

    expect(out.authorized).toBe(true);
    expect(out.checks[0]!.detail).toBe('Dana Reyes (dana@northwind.example) at Northwind.');
  });

  it('says the token was refused and what to do', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, error: 'unauthorized access' }, 401)));
    const out = await pipedriveConnector.inspect!({ config: {}, credentials: { token: TOKEN }, options: {} }) as { authorized: boolean; error: string };

    expect(out.authorized).toBe(false);
    expect(out.error).toMatch(/unauthorized access.*Personal preferences → API/);
  });
});
