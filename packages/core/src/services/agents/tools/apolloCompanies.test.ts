/**
 * The company tools, and the two things that make them safe to ship against
 * an unverified plan tier:
 *
 *   - company search states the credit it just spent, EVERY time, so a paging
 *     loop is visible spend rather than silent spend;
 *   - a closed plan tier comes back as `plan_tier_unavailable` — a limit to
 *     report, not an error to retry.
 *
 * Plus the grounding rule the output shape makes enforceable: Apollo's
 * estimated headcount and revenue are labelled `modeled`.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { apolloCompanyTools } = await import('./apolloCompanies');

const ORG = 'org_apollo_companies';

/**
 * A runtime context with an apollo source in scope.
 * @param orgId - Whose workspace.
 */
function ctxFor(orgId = ORG): RuntimeContext {
  return {
    orgId,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    connectorSources: ['apollo'],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function toolsByName(): Map<string, Invokable> {
  return new Map((apolloCompanyTools(ctxFor()) as unknown as Invokable[]).map(t => [t.name, t]));
}

async function call(tool: Invokable | undefined, args: Record<string, unknown> = {}) {
  return JSON.parse(await tool!.invoke(args));
}

/**
 * One canned response.
 * @param status - HTTP status.
 * @param body - JSON body.
 */
function res(status: number, body: unknown): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ACME = {
  id: 'org_1',
  name: 'Acme',
  primary_domain: 'acme.com',
  industry: 'construction',
  estimated_num_employees: 120,
  organization_revenue: 18_000_000,
  latest_funding_stage: 'Series B',
  technology_names: ['HubSpot', 'Google Analytics'],
  city: 'Denver',
  state: 'CO',
  country: 'United States',
  short_description: 'Rock-picking robots.',
};

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(getCredentialsForSource).mockReset();
  vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'apollo-key' });
  const { eq } = await import('drizzle-orm');
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'apollo', kind: 'plugin', configJson: { _connector: 'apollo' } });
});

afterAll(async () => {
  const { eq } = await import('drizzle-orm');
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
});

describe('apollo_search_companies', () => {
  it('states the credit it just spent, so a paging loop is visible spend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, {
      organizations: [ACME],
      pagination: { page: 1, total_entries: 340, total_pages: 14 },
    })));

    const out = await call(toolsByName().get('apollo_search_companies'), { organization_locations: ['Colorado, US'] });

    expect(out).toMatchObject({ ok: true, credits_spent: 1, total: 340, returned: 1, has_more: true });
    expect(out.note).toContain('cost 1 Apollo credit');
    expect(out.note).toContain('every further page costs another');
  });

  it('labels the modeled fields as modeled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { organizations: [ACME] })));

    const out = await call(toolsByName().get('apollo_search_companies'), {});

    expect(out.companies[0].modeled).toEqual(['employees', 'revenue']);
    expect(out.note).toContain('Never quote one back to the company');
  });

  it('reports a closed plan tier as a plan tier, not a bug', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, { error: 'forbidden' })));

    const out = await call(toolsByName().get('apollo_search_companies'), {});

    expect(out).toMatchObject({ ok: false, error: 'plan_tier_unavailable', endpoint: 'company_search' });
    expect(out.message).toContain('People search and enrichment are unaffected');
  });

  it('sends the filters under the names Apollo expects', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return res(200, { organizations: [] });
    }));

    await call(toolsByName().get('apollo_search_companies'), {
      domains: ['acme.com'],
      num_employees_ranges: ['51,200'],
      revenue_min: 5_000_000,
      revenue_max: 50_000_000,
      name: 'Acme',
    });

    expect(bodies[0]).toContain('"q_organization_domains_list":["acme.com"]');
    expect(bodies[0]).toContain('"revenue_range":{"min":5000000,"max":50000000}');
    expect(bodies[0]).toContain('"q_organization_name":"Acme"');
  });

  it('says outright when it dropped domains past Apollo\'s cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { organizations: [] })));
    const domains = Array.from({ length: 1200 }, (_, i) => `company${i}.com`);

    const out = await call(toolsByName().get('apollo_search_companies'), { domains });

    expect(out.truncation).toContain('first 1000 domains');
  });
});

describe('apollo_enrich_company', () => {
  it('enriches one domain through the single endpoint', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return res(200, { organization: ACME });
    }));

    const out = await call(toolsByName().get('apollo_enrich_company'), { domains: ['acme.com'] });

    expect(urls[0]).toContain('/api/v1/organizations/enrich');
    expect(out).toMatchObject({ ok: true, domains_in: 1, matched: 1, missed: 0 });
    expect(out.companies[0]).toMatchObject({ name: 'Acme', industry: 'construction', funding_stage: 'Series B' });
    expect(out.companies[0].technologies).toEqual(['HubSpot', 'Google Analytics']);
  });

  it('enriches several through the bulk endpoint, and names what missed', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return res(200, { organizations: [ACME] });
    }));

    const out = await call(toolsByName().get('apollo_enrich_company'), { domains: ['acme.com', 'ghost.io'] });

    expect(urls[0]).toContain('/api/v1/organizations/bulk_enrich');
    expect(out).toMatchObject({ domains_in: 2, matched: 1, missed: 1 });
    expect(out.missed_domains).toEqual(['ghost.io']);
  });

  it('trims a pasted URL down to its host rather than sending it whole', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return res(200, { organization: ACME });
    }));

    await call(toolsByName().get('apollo_enrich_company'), { domains: ['https://www.acme.com/about'] });

    expect(bodies[0]).toBe(JSON.stringify({ domain: 'acme.com' }));
  });

  it('labels the modeled fields here too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { organization: { name: 'Acme', primary_domain: 'acme.com' } })));

    const out = await call(toolsByName().get('apollo_enrich_company'), { domains: ['acme.com'] });

    // Nothing modeled came back, so nothing is labelled — the flag tracks the
    // data, it is not a constant.
    expect(out.companies[0].modeled).toEqual([]);
    expect(out.note).toContain('ESTIMATES');
  });
});
