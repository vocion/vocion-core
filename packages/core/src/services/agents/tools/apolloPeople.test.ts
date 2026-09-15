/**
 * The people tools, and the honesty rules the output shape has to carry:
 *
 *   - search reports `email_available`, never an address, because Apollo does
 *     not send one and inventing one is the worst thing this tool could do;
 *   - an address appears only from an explicit enrich, and an unverified one
 *     is flagged;
 *   - employment history is a first-class field, not buried in a raw payload;
 *   - bulk enrich reports records-in / matched / missed, and NAMES what missed.
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
const { apolloPeopleTools } = await import('./apolloPeople');

const ORG = 'org_apollo_people';

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
  return new Map((apolloPeopleTools(ctxFor()) as unknown as Invokable[]).map(t => [t.name, t]));
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

/** A search hit: Apollo sends availability flags and no contact details. */
const SEARCH_HIT = {
  id: 'per_1',
  first_name: 'Dana',
  last_name: 'Reyes',
  title: 'VP Marketing',
  seniority: 'vp',
  city: 'Denver',
  state: 'CO',
  country: 'United States',
  has_email: true,
  has_direct_phone: false,
  organization: { name: 'Acme', primary_domain: 'acme.com', estimated_num_employees: 120 },
};

/** A match hit: the address is revealed, and Apollo states its own verdict. */
const MATCH_HIT = {
  id: 'per_1',
  first_name: 'Dana',
  last_name: 'Reyes',
  title: 'VP Marketing',
  email: 'dana@acme.com',
  email_status: 'verified',
  employment_history: [
    { organization_name: 'Acme', title: 'VP Marketing', start_date: '2024-03-01', current: true },
    { organization_name: 'Northwind', title: 'Director of Demand Gen', start_date: '2021-01-01', current: false },
  ],
  organization: { name: 'Acme', primary_domain: 'acme.com', estimated_num_employees: 120 },
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

describe('apollo_search_people', () => {
  it('reports availability, never an address, and says so in the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, {
      people: [SEARCH_HIT],
      pagination: { page: 1, per_page: 25, total_entries: 4210, total_pages: 169 },
    })));

    const out = await call(toolsByName().get('apollo_search_people'), { titles: ['VP Marketing'] });

    expect(out).toMatchObject({ ok: true, credits_spent: 0, total: 4210, returned: 1, has_more: true });
    expect(out.people[0]).toMatchObject({ id: 'per_1', name: 'Dana Reyes', email_available: true, direct_phone_available: false });
    // The rule this tool exists to hold: no address anywhere in the payload.
    expect(out.people[0].email).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('@acme.com');
    expect(out.note).toContain('NO email addresses');
  });

  it('reports the total, not the page size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { people: [SEARCH_HIT], pagination: { total_entries: 4210, total_pages: 169 } })));

    const out = await call(toolsByName().get('apollo_search_people'), {});

    expect(out.note).toContain('Report the TOTAL (4210)');
  });

  it('passes the filters through under the names Apollo expects', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return res(200, { people: [] });
    }));

    await call(toolsByName().get('apollo_search_people'), {
      titles: ['VP Marketing'],
      seniorities: ['vp'],
      organization_domains: ['acme.com'],
      organization_num_employees_ranges: ['51,200'],
      limit: 50,
      page: 3,
    });

    expect(bodies[0]).toContain('"person_titles":["VP Marketing"]');
    expect(bodies[0]).toContain('"person_seniorities":["vp"]');
    expect(bodies[0]).toContain('"q_organization_domains_list":["acme.com"]');
    expect(bodies[0]).toContain('"per_page":50');
    expect(bodies[0]).toContain('"page":3');
  });

  it('says outright when the result set is deeper than Apollo will page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { people: [SEARCH_HIT], pagination: { total_entries: 900_000, total_pages: 9000 } })));

    const out = await call(toolsByName().get('apollo_search_people'), {});

    expect(out.truncation).toContain('stops at page 500');
  });

  it('caps the page size at Apollo\'s own limit rather than sending a bad request', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return res(200, { people: [] });
    }));

    await call(toolsByName().get('apollo_search_people'), { limit: 5000 });

    expect(bodies[0]).toContain('"per_page":100');
  });

  it('uses the api_search path, never the legacy one that 403s on lower tiers', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return res(200, { people: [] });
    }));

    await call(toolsByName().get('apollo_search_people'), {});

    expect(urls[0]).toContain('/api/v1/mixed_people/api_search');
  });
});

describe('apollo_enrich', () => {
  it('returns the revealed contact with employment history as a first-class field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { person: MATCH_HIT })));

    const out = await call(toolsByName().get('apollo_enrich'), { contact: { email: 'dana@acme.com' } });

    expect(out).toMatchObject({ ok: true, source: 'apollo_live', credits_spent: 1 });
    expect(out.contact.email).toBe('dana@acme.com');
    expect(out.contact.email_verified).toBe(true);
    expect(out.contact.employment_history).toHaveLength(2);
    expect(out.contact.employment_history[1].organization_name).toBe('Northwind');
    // The ported contract: a normalized contact plus its field list.
    expect(out.fields.some((f: { key: string }) => f.key === 'employment_history')).toBe(true);
  });

  it('flags an address Apollo did not verify, rather than passing it off as real', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { person: { ...MATCH_HIT, email_status: 'guessed' } })));

    const out = await call(toolsByName().get('apollo_enrich'), { contact: { email: 'dana@acme.com' } });

    expect(out.contact.email_verified).toBe(false);
    expect(out.warning).toContain('guessed');
  });

  it('matches on a name plus a company when there is no email', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return res(200, { person: MATCH_HIT });
    }));

    await call(toolsByName().get('apollo_enrich'), { contact: { first_name: 'Dana', last_name: 'Reyes', company: 'Acme' } });

    expect(bodies[0]).toContain('"organization_name":"Acme"');
  });

  it('refuses when there is nothing to match on', async () => {
    const out = await call(toolsByName().get('apollo_enrich'), { contact: { lifecycle_stage: 'lead' } });

    expect(out).toMatchObject({ ok: false, error: 'bad_argument' });
  });

  it('reports a miss as an absence in Apollo, not as proof nobody exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { person: null })));

    const out = await call(toolsByName().get('apollo_enrich'), { contact: { email: 'nobody@acme.com' } });

    expect(out).toMatchObject({ ok: true, contact: null, reason: 'no_match', credits_spent: 0 });
    expect(out.message).toContain('not proof the person does not exist');
  });
});

describe('apollo_bulk_enrich', () => {
  it('batches past Apollo\'s ten-per-call limit and reports the arithmetic', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      bodies.push(body);
      const count = (JSON.parse(body) as { details: unknown[] }).details.length;
      // Every second record misses, so the missed count is not just zero.
      return res(200, { matches: Array.from({ length: count }, (_, i) => (i % 2 === 0 ? MATCH_HIT : null)) });
    }));

    const contacts = Array.from({ length: 12 }, (_, i) => ({ email: `person${i}@acme.com` }));
    const out = await call(toolsByName().get('apollo_bulk_enrich'), { contacts });

    // Twelve in, ten then two: the batching is the tool's job, not the model's.
    expect(bodies).toHaveLength(2);
    expect(out).toMatchObject({ ok: true, records_in: 12, matched: 6, missed: 6 });
    // Named, not just counted.
    expect(out.missed_records).toContain('person1@acme.com');
    expect(out.credits_spent).toBe(6);
  });

  it('says how much had already been spent when a batch fails part-way', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      return callCount === 1
        ? res(200, { matches: Array.from({ length: 10 }, () => MATCH_HIT) })
        : res(500, { error: 'boom' });
    }));

    const contacts = Array.from({ length: 12 }, (_, i) => ({ email: `person${i}@acme.com` }));
    const out = await call(toolsByName().get('apollo_bulk_enrich'), { contacts });

    expect(out).toMatchObject({ ok: false, error: 'apollo_error', matched_before_failure: 10 });
  });

  it('counts how many revealed addresses are unverified', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, {
      matches: [MATCH_HIT, { ...MATCH_HIT, email_status: 'guessed' }],
    })));

    const out = await call(toolsByName().get('apollo_bulk_enrich'), {
      contacts: [{ email: 'a@acme.com' }, { email: 'b@acme.com' }],
    });

    expect(out).toMatchObject({ matched: 2, unverified: 1 });
  });

  it('refuses an empty list rather than calling Apollo with nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // The schema refuses it first; the tool body carries the same guard for a
    // caller that reaches it another way (the tool endpoint, a replayed call).
    await expect(call(toolsByName().get('apollo_bulk_enrich'), { contacts: [] })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
