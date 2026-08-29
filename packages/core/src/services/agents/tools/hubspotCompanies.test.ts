/**
 * Company tools — the "why did we lose X" chain:
 *
 *   - search matches by name and domain; "Terra Clear" also matches
 *     "TerraClear" (de-spaced variant); a multi-word miss broadens once.
 *   - get_company returns the firmographics row.
 *   - company_deals includes closed-won AND closed-lost, newest-closed
 *     first, with combined loss_reason on lost rows.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { combineLossReason, hubspotCompanyTools } = await import('./hubspotCompanies');

const ORG = 'org_hs_companies';

function ctxFor(): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    connectorSources: ['hubspot'],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function toolsByName(): Map<string, Invokable> {
  const list = hubspotCompanyTools(ctxFor()) as unknown as Invokable[];
  return new Map(list.map(t => [t.name, t]));
}

async function call(tool: Invokable | undefined, args: Record<string, unknown>) {
  return JSON.parse(await tool!.invoke(args));
}

function res(status: number, body: unknown): Response {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const TERRACLEAR = {
  id: '501',
  properties: {
    name: 'TerraClear',
    domain: 'terraclear.com',
    industry: 'COMPUTER_SOFTWARE',
    lifecyclestage: 'customer',
    annualrevenue: '12000000',
    numberofemployees: '120',
    city: 'Grangeville',
    state: 'ID',
    country: 'USA',
    description: 'Rock-picking robots.',
  },
};

const PIPELINES = {
  results: [{
    id: 'p1',
    label: 'Sales Pipeline',
    stages: [
      { id: 'stage_open', label: 'Discovery', metadata: { isClosed: 'false' } },
      { id: 'stage_won', label: 'Closed won', metadata: { isClosed: 'true' } },
      { id: 'stage_lost', label: 'Closed lost', metadata: { isClosed: 'true' } },
    ],
  }],
};

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(getCredentialsForSource).mockReset();
  vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'pat-1' });
  const { eq } = await import('drizzle-orm');
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot' } });
});

describe('hubspot_search_companies', () => {
  it('searches the query AND its de-spaced variant in one call', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return res(200, { results: [TERRACLEAR] });
    }));
    const out = await call(toolsByName().get('hubspot_search_companies'), { name: 'Terra Clear' });

    expect(out).toMatchObject({ ok: true, count: 1, broadened: false });
    expect(out.companies[0]).toMatchObject({ id: '501', name: 'TerraClear', domain: 'terraclear.com', location: 'Grangeville, ID, USA' });
    // One request, four filter groups: name+domain for both variants.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('"value":"Terra Clear"');
    expect(bodies[0]).toContain('"value":"TerraClear"');
  });

  it('broadens a multi-word miss once to the most distinctive token', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      bodies.push(body);
      return res(200, body.includes('"value":"Holdings"') && !body.includes('Acme Holdings Inc') ? { results: [TERRACLEAR] } : { results: [] });
    }));
    const out = await call(toolsByName().get('hubspot_search_companies'), { name: 'Acme Holdings Inc' });

    expect(out.broadened).toBe(true);
    expect(bodies).toHaveLength(2);
  });
});

describe('hubspot_get_company', () => {
  it('returns domain, industry, lifecycle stage, revenue, employees, location, description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, TERRACLEAR)));
    const out = await call(toolsByName().get('hubspot_get_company'), { company_id: '501' });

    expect(out.ok).toBe(true);
    expect(out.company).toEqual({
      id: '501',
      name: 'TerraClear',
      domain: 'terraclear.com',
      industry: 'COMPUTER_SOFTWARE',
      lifecycle_stage: 'customer',
      revenue: '12000000',
      employees: '120',
      location: 'Grangeville, ID, USA',
      description: 'Rock-picking robots.',
    });
  });

  it('reports an unknown id as no_match, not an exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(404, { message: 'not found' })));
    const out = await call(toolsByName().get('hubspot_get_company'), { company_id: '999' });

    expect(out).toMatchObject({ ok: true, company: null, reason: 'no_match' });
  });
});

describe('hubspot_company_deals', () => {
  it('includes closed-won AND closed-lost, newest-closed first, with combined loss_reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/crm/v3/objects/companies/501')) {
        return res(200, { id: '501', associations: { deals: { results: [{ id: 11 }, { id: 12 }, { id: 13 }] } } });
      }
      if (u.includes('/crm/v3/pipelines/deals')) {
        return res(200, PIPELINES);
      }
      return res(200, { results: [
        { id: '11', properties: { dealname: 'TerraClear website', dealstage: 'stage_lost', amount: '40000', closedate: '2026-03-01', closed_lost_reason_dropdown: 'Budget', closed_lost_reason: 'Went with an internal build' } },
        { id: '12', properties: { dealname: 'TerraClear retainer', dealstage: 'stage_won', amount: '90000', closedate: '2026-06-15' } },
        { id: '13', properties: { dealname: 'TerraClear phase 2', dealstage: 'stage_open', amount: '15000' } },
      ] });
    }));
    const out = await call(toolsByName().get('hubspot_company_deals'), { company_id: '501' });

    expect(out).toMatchObject({ ok: true, count: 3 });
    // Newest-closed first, open (no closedate) last.
    expect(out.deals.map((d: { deal_id: string }) => d.deal_id)).toEqual(['12', '11', '13']);
    expect(out.deals[0]).toMatchObject({ is_closed: true, is_won: true, loss_reason: null });
    expect(out.deals[1]).toMatchObject({
      is_closed: true,
      is_won: false,
      loss_reason: 'Budget - Went with an internal build',
      stage: 'Closed lost',
    });
    expect(out.deals[2]).toMatchObject({ is_closed: false, is_won: false, loss_reason: null });
  });

  it('an account with no deals returns count 0, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { id: '501', associations: {} })));
    const out = await call(toolsByName().get('hubspot_company_deals'), { company_id: '501' });

    expect(out).toMatchObject({ ok: true, count: 0, deals: [] });
  });
});

describe('hubspot_company_activity', () => {
  it('one newest-first timeline; auto-replies dropped, invite bodies blanked, HTML stripped', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/crm/v3/objects/companies/501')) {
        return res(200, { id: '501', associations: {
          notes: { results: [{ id: 'n1' }] },
          emails: { results: [{ id: 'e1' }, { id: 'e2' }] },
          meetings: { results: [{ id: 'm1' }] },
          calls: { results: [{ id: 'c1' }] },
        } });
      }
      if (u.includes('/crm/v3/objects/notes/batch/read')) {
        return res(200, { results: [{ id: 'n1', properties: { hs_note_body: '<p>Client asked for a &amp; revised SOW</p>', hs_timestamp: '2026-04-02T10:00:00Z' } }] });
      }
      if (u.includes('/crm/v3/objects/emails/batch/read')) {
        return res(200, { results: [
          { id: 'e1', properties: { hs_email_subject: 'Checking in', hs_email_text: 'Any update on the contract?', hs_email_direction: 'INCOMING_EMAIL', hs_timestamp: '2026-04-05T10:00:00Z' } },
          { id: 'e2', properties: { hs_email_subject: 'Out of Office', hs_email_text: 'I am out of the office until Monday', hs_email_direction: 'INCOMING_EMAIL', hs_timestamp: '2026-04-06T10:00:00Z' } },
        ] });
      }
      if (u.includes('/crm/v3/objects/meetings/batch/read')) {
        return res(200, { results: [{ id: 'm1', properties: { hs_meeting_title: 'Kickoff sync', hs_meeting_body: '<p>Bob is inviting you to a scheduled Zoom meeting. Join Zoom Meeting https://zoom.us/j/123</p>', hs_timestamp: '2026-04-01T10:00:00Z' } }] });
      }
      if (u.includes('/crm/v3/objects/calls/batch/read')) {
        return res(200, { results: [{ id: 'c1', properties: { hs_call_title: 'Pricing call', hs_call_body: '<p>Talked through <b>tiered pricing</b> and they want a smaller phase 1</p>', hs_timestamp: '2026-04-03T10:00:00Z' } }] });
      }
      return res(500, {});
    }));
    const out = await call(toolsByName().get('hubspot_company_activity'), { company_id: '501' });

    expect(out).toMatchObject({ ok: true, count: 4 });
    // Newest first; the OOO email is gone entirely.
    expect(out.activity.map((a: { type: string }) => a.type)).toEqual(['email', 'call', 'note', 'meeting']);
    expect(out.activity[0]).toMatchObject({ direction: 'in', subject: 'Checking in', when: '2026-04-05' });
    // Call body: HTML stripped, content kept.
    expect(out.activity[1].snippet).toBe('Talked through tiered pricing and they want a smaller phase 1');
    // Note: entities unescaped, no tags.
    expect(out.activity[2].snippet).toBe('Client asked for a & revised SOW');
    // Meeting: informative title kept, join-invite boilerplate blanked.
    expect(out.activity[3]).toMatchObject({ subject: 'Kickoff sync', snippet: '' });
  });
});

describe('combineLossReason', () => {
  it('combines category + details, drops placeholder junk, falls back to the stage label', () => {
    expect(combineLossReason({ closed_lost_reason_dropdown: 'Budget', closed_lost_reason: 'Too pricey' }, 'Closed lost')).toBe('Budget - Too pricey');
    expect(combineLossReason({ closed_lost_reason_dropdown: 'Budget', closed_lost_reason: '^' }, 'Closed lost')).toBe('Budget');
    expect(combineLossReason({ closed_lost_reason_dropdown: '', closed_lost_reason: '' }, 'Closed lost')).toBe('Closed lost');
  });
});
