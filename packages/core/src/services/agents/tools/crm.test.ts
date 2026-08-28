/**
 * CRM tool suite — the properties that make a structured read trustworthy:
 *
 *   - `total` is a real COUNT(*), independent of the page size. This is the
 *     whole point: a relevance top-k could never answer "how many".
 *   - Facets report every value actually present, so filter strings are
 *     DISCOVERABLE instead of guessed.
 *   - Pagination is explicit — `has_more` + `next_offset`, never a silent cap.
 *   - One tool per object type: the contacts tool never returns a deal.
 *   - `unavailable_fields` names what the mirror does not carry, so a missing
 *     column yields an honest refusal rather than a plausible number.
 *   - Source-gated, not granted; and cross-tenant isolated.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, knowledgeDocumentSchema } = await import('@/models/Schema');
const { crmTools } = await import('./crm');
const { buildDomainTools } = await import('./registry');

const ORG = 'org_crm';
const NOW = new Date('2026-08-21T12:00:00.000Z');

function ctxFor(orgId: string, sources: string[] = ['hubspot'], allowed?: string[]): RuntimeContext {
  return {
    orgId,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    connectorSources: sources,
    ...(allowed ? { allowedSourceSlugs: allowed } : {}),
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function toolsByName(orgId: string, sources?: string[], allowed?: string[]) {
  const list = crmTools(ctxFor(orgId, sources, allowed)) as unknown as Invokable[];
  return new Map(list.map(t => [t.name, t]));
}

type Response = {
  object_type: string;
  total: number;
  returned: number;
  offset: number;
  has_more: boolean;
  total_amount?: number;
  next_offset?: number;
  facets: Record<string, Record<string, number>>;
  facet_amounts?: Record<string, Record<string, number>>;
  unknown_filters?: Array<{ field: string; requested: string[]; not_found: string[] }>;
  available_values?: Record<string, Record<string, number>>;
  unavailable_fields: string[];
  created_after_applied?: string;
  as_of: string | null;
  sources_read: string[];
  records: Array<Record<string, unknown>>;
  error?: string;
};

async function call(tool: Invokable | undefined, args: Record<string, unknown> = {}): Promise<Response> {
  return JSON.parse(await tool!.invoke(args)) as Response;
}

/**
 * A realistic mirror: three sources on the hubspot connector, stored the way
 * `addSource` stores them (kind `plugin`, connector slug in config).
 * @param orgId
 */
async function seedCrm(orgId = ORG) {
  async function source(slug: string, lastSyncedAt: Date | null) {
    const [row] = await db.insert(knowledgeSourceSchema).values({
      orgId,
      slug,
      kind: 'plugin',
      configJson: { _connector: 'hubspot' },
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
    }).returning({ id: knowledgeSourceSchema.id });
    return row!.id;
  }
  const contacts = await source('hubspot-contacts', new Date(NOW.getTime() - 3_600_000));
  const deals = await source('hubspot', new Date(NOW.getTime() - 7_200_000));
  const companies = await source('hubspot-companies', null);

  async function doc(sourceId: number, externalId: string, title: string, metadata: Record<string, unknown>) {
    await db.insert(knowledgeDocumentSchema).values({
      orgId,
      sourceId,
      externalId,
      title,
      metadata,
      contentHash: externalId,
      ingestedAt: NOW,
    });
  }

  // 3 leads, 1 SQL, 1 customer.
  for (const [i, stage] of ['lead', 'lead', 'lead', 'salesqualifiedlead', 'customer'].entries()) {
    await doc(contacts, `contacts:${i + 1}`, `Person ${i + 1}`, {
      objectType: 'contacts',
      hubspotId: String(i + 1),
      lifecycleStage: stage,
      primaryEmail: `person${i + 1}@acme.com`,
      emailDomain: 'acme.com',
      company: 'Acme',
      jobTitle: 'Ops Lead',
      ownerId: i === 0 ? '77' : '88',
    });
  }
  // 2 deals with amounts, 1 without — proves a partial sum is still honest.
  await doc(deals, 'deals:10', 'Acme expansion', { objectType: 'deals', hubspotId: '10', dealStage: 'presentationscheduled', dealStageLabel: 'Presentation Scheduled', pipelineLabel: 'Sales Pipeline', dealClosed: false, amount: 5000 });
  await doc(deals, 'deals:11', 'Acme renewal', { objectType: 'deals', hubspotId: '11', dealStage: 'presentationscheduled', dealStageLabel: 'Presentation Scheduled', pipelineLabel: 'Sales Pipeline', dealClosed: false, amount: 2500.5 });
  await doc(deals, 'deals:12', 'Acme pilot', { objectType: 'deals', hubspotId: '12', dealStage: 'qualifiedtobuy', dealStageLabel: 'Qualified To Buy', pipelineLabel: 'Sales Pipeline', dealClosed: false });
  // A closed deal in a CUSTOM pipeline whose stage id gives no hint it is
  // closed — the case a hardcoded stage-name list gets wrong.
  await doc(deals, 'deals:13', 'Acme lost', { objectType: 'deals', hubspotId: '13', dealStage: '1386961513', dealStageLabel: 'Dropped', pipelineLabel: 'Nurture Pipeline', dealClosed: true, amount: 9000 });
  // Companies carry NO industry — the pre-backfill shape.
  await doc(companies, 'companies:20', 'Acme Inc', { objectType: 'companies', hubspotId: '20', domain: 'acme.com' });
}

beforeEach(async () => {
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('source gating', () => {
  it('builds nothing for an agent with no HubSpot source in scope', () => {
    expect(crmTools(ctxFor(ORG, ['gmail', 'zoom']))).toHaveLength(0);
  });

  it('builds all three for any agent with a HubSpot source — no grant needed', () => {
    const names = buildDomainTools(ctxFor(ORG, ['hubspot'])).map(t => t.name);

    expect(names).toContain('get_hubspot_contacts');
    expect(names).toContain('get_hubspot_deals');
    expect(names).toContain('get_hubspot_companies');
  });

  it('matches a differently-named HubSpot source too', () => {
    expect(crmTools(ctxFor(ORG, ['hubspot-contacts']))).toHaveLength(3);
  });
});

describe('counts', () => {
  it('returns an exact total, not the page length', async () => {
    await seedCrm();

    const all = await call(toolsByName(ORG).get('get_hubspot_contacts'), { limit: 2 });

    expect(all.total).toBe(5);
    expect(all.returned).toBe(2);
    expect(all.has_more).toBe(true);
    expect(all.next_offset).toBe(2);
  });

  it('filters by lifecycle stage, case-insensitively', async () => {
    await seedCrm();
    const tool = toolsByName(ORG).get('get_hubspot_contacts');

    expect((await call(tool, { lifecycle_stages: ['lead'] })).total).toBe(3);
    expect((await call(tool, { lifecycle_stages: ['LEAD'] })).total).toBe(3);
    expect((await call(tool, { lifecycle_stages: ['lead', 'salesqualifiedlead'] })).total).toBe(4);
  });

  it('filters by owner', async () => {
    await seedCrm();

    expect((await call(toolsByName(ORG).get('get_hubspot_contacts'), { owner_ids: ['77'] })).total).toBe(1);
  });

  it('reports zero, not an error, when a source exists but has no records of that type', async () => {
    const [src] = await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'hubspot',
      kind: 'plugin',
      configJson: { _connector: 'hubspot' },
    }).returning({ id: knowledgeSourceSchema.id });

    expect(src).toBeDefined();

    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'));

    expect(res.total).toBe(0);
    expect(res.error).toBeUndefined();
  });

  it('says so plainly when no HubSpot source is connected at all', async () => {
    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'));

    expect(res.error).toBe('no_hubspot_source');
    expect(res.total).toBe(0);
  });
});

describe('facets make filter values discoverable', () => {
  it('reports every lifecycle stage present with its count', async () => {
    await seedCrm();

    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'));

    expect(res.facets.lifecycleStage).toEqual({ lead: 3, salesqualifiedlead: 1, customer: 1 });
    // The facet counts sum to the total — the property that makes a
    // breakdown answer trustworthy.
    expect(Object.values(res.facets.lifecycleStage!).reduce((a, b) => a + b, 0)).toBe(res.total);
  });

  it('reports deal stage and pipeline separately', async () => {
    await seedCrm();

    const res = await call(toolsByName(ORG).get('get_hubspot_deals'));

    expect(res.facets.dealStageLabel).toEqual({ 'Presentation Scheduled': 2, 'Qualified To Buy': 1, 'Dropped': 1 });
    expect(res.facets.pipelineLabel).toEqual({ 'Sales Pipeline': 3, 'Nurture Pipeline': 1 });
  });
});

describe('one tool per object type', () => {
  it('the contacts tool returns only contacts', async () => {
    await seedCrm();
    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'));

    expect(res.total).toBe(5);
    expect(res.records.every(r => String(r.ref).startsWith('contacts:'))).toBe(true);
  });

  it('the deals tool returns only deals, and companies only companies', async () => {
    await seedCrm();
    const tools = toolsByName(ORG);

    const deals = await call(tools.get('get_hubspot_deals'));
    const companies = await call(tools.get('get_hubspot_companies'));

    expect(deals.total).toBe(4);
    expect(deals.records.every(r => String(r.ref).startsWith('deals:'))).toBe(true);
    expect(companies.total).toBe(1);
    expect(companies.records.every(r => String(r.ref).startsWith('companies:'))).toBe(true);
  });
});

describe('deal value', () => {
  it('sums amounts across ALL matches, not just the page', async () => {
    await seedCrm();

    const res = await call(toolsByName(ORG).get('get_hubspot_deals'), { limit: 1 });

    expect(res.returned).toBe(1);
    expect(res.total_amount).toBeCloseTo(16500.5, 2);
  });

  it('omits total_amount entirely when no deal carries an amount', async () => {
    const [src] = await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'hubspot',
      kind: 'plugin',
      configJson: { _connector: 'hubspot' },
    }).returning({ id: knowledgeSourceSchema.id });
    await db.insert(knowledgeDocumentSchema).values({
      orgId: ORG,
      sourceId: src!.id,
      externalId: 'deals:99',
      title: 'No amount',
      metadata: { objectType: 'deals', hubspotId: '99', dealStage: 'qualifiedtobuy' },
      contentHash: 'deals:99',
      ingestedAt: NOW,
    });

    const res = await call(toolsByName(ORG).get('get_hubspot_deals'));

    expect(res.total).toBe(1);
    expect(res.total_amount).toBeUndefined();
    expect(res.unavailable_fields).toContain('amount');
  });
});

describe('honesty about what the mirror lacks', () => {
  it('names unsynced fields so the agent can refuse instead of guessing', async () => {
    await seedCrm();

    const companies = await call(toolsByName(ORG).get('get_hubspot_companies'));

    // Seeded companies carry no industry — the pre-backfill shape.
    expect(companies.unavailable_fields).toContain('industry');
    expect(companies.facets.industry).toBeUndefined();

    const contacts = await call(toolsByName(ORG).get('get_hubspot_contacts'));

    // jobTitle IS stamped, so it must not be reported as unavailable.
    expect(contacts.unavailable_fields).not.toContain('jobTitle');
    expect(contacts.unavailable_fields).toContain('createdAt');
  });

  it('reports the last sync time so staleness is visible', async () => {
    await seedCrm();

    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'));

    expect(res.as_of).toBe(new Date(NOW.getTime() - 3_600_000).toISOString());
    expect(res.sources_read).toContain('hubspot-contacts');
  });
});

describe('open vs closed deals', () => {
  it('resolves open/closed from the pipeline flag, not from stage names', async () => {
    await seedCrm();
    const tool = toolsByName(ORG).get('get_hubspot_deals');

    const open = await call(tool, { status: 'open' });
    const closed = await call(tool, { status: 'closed' });

    expect(open.total).toBe(3);
    expect(open.total_amount).toBeCloseTo(7500.5, 2);
    // The closed one sits in a custom pipeline under stage id `1386961513`,
    // which no name-matching heuristic would recognise as closed.
    expect(closed.total).toBe(1);
    expect(closed.total_amount).toBeCloseTo(9000, 2);
    // Open + closed must reconstruct the whole set, or one of them is wrong.
    expect(open.total + closed.total).toBe((await call(tool)).total);
  });

  it('reports value per stage in ONE call, so nothing needs paging to sum', async () => {
    await seedCrm();

    const res = await call(toolsByName(ORG).get('get_hubspot_deals'), { status: 'open', limit: 1 });

    expect(res.returned).toBe(1);
    expect(res.facet_amounts?.dealStageLabel).toEqual({ 'Presentation Scheduled': 7500.5 });
    // Sums cover every match, not just the returned page.
    expect(res.facet_amounts!.dealStageLabel!['Presentation Scheduled']).toBeCloseTo(res.total_amount!, 2);
  });
});

describe('a filter value that does not exist is refused, not answered', () => {
  it('withholds the count and lists the real values instead', async () => {
    await seedCrm();

    // "MQL" is what a caller naturally writes; the stored value is
    // `marketingqualifiedlead`. Returning 0 here is how a wrong number gets
    // reported as fact.
    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'), { lifecycle_stages: ['MQL'] });

    expect(res.error).toBe('unknown_filter_value');
    expect(res.total).toBeUndefined();
    expect(res.unknown_filters?.[0]).toMatchObject({ field: 'lifecycleStage', not_found: ['MQL'] });
    expect(res.available_values?.lifecycleStage).toMatchObject({ salesqualifiedlead: 1 });
  });

  it('flags a bad value even when other values in the same filter do match', async () => {
    await seedCrm();

    // Silently dropping "MQL" here would return 3 and read as "leads + MQLs".
    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'), { lifecycle_stages: ['lead', 'MQL'] });

    expect(res.error).toBe('unknown_filter_value');
    expect(res.total).toBeUndefined();
  });

  it('accepts a stage LABEL for deals and rejects the raw internal id', async () => {
    await seedCrm();
    const tool = toolsByName(ORG).get('get_hubspot_deals');

    expect((await call(tool, { deal_stages: ['Presentation Scheduled'] })).total).toBe(2);
    expect((await call(tool, { deal_stages: ['presentationscheduled'] })).error).toBe('unknown_filter_value');
  });

  it('still answers normally when every requested value exists', async () => {
    await seedCrm();

    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'), { lifecycle_stages: ['lead'] });

    expect(res.error).toBeUndefined();
    expect(res.total).toBe(3);
  });

  it('shows the full value distribution even while a filter is applied', async () => {
    await seedCrm();

    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'), { lifecycle_stages: ['lead'] });

    // Facets describe the scope BEFORE the value filter, so a caller can see
    // what else it could have asked for.
    expect(res.facets.lifecycleStage).toMatchObject({ lead: 3, salesqualifiedlead: 1, customer: 1 });
  });
});

describe('created-date window', () => {
  it('filters by created_after and created_before', async () => {
    await seedCrm();
    const tool = toolsByName(ORG).get('get_hubspot_contacts');

    // Seeded contacts carry no createdAt, so the window matches nothing —
    // which is the honest answer, not an error.
    expect((await call(tool, { created_after: '2026-08-01' })).total).toBe(0);

    // Companies DO get one with a date.
    const [src] = await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'hubspot-extra',
      kind: 'plugin',
      configJson: { _connector: 'hubspot' },
    }).returning({ id: knowledgeSourceSchema.id });
    for (const [i, created] of ['2026-08-20T10:00:00.000Z', '2026-06-01T10:00:00.000Z'].entries()) {
      await db.insert(knowledgeDocumentSchema).values({
        orgId: ORG,
        sourceId: src!.id,
        externalId: `contacts:dated-${i}`,
        title: `Dated ${i}`,
        metadata: { objectType: 'contacts', hubspotId: `d${i}`, lifecycleStage: 'lead', createdAt: created },
        contentHash: `contacts:dated-${i}`,
        ingestedAt: NOW,
      });
    }

    expect((await call(tool, { created_after: '2026-08-01' })).total).toBe(1);
    expect((await call(tool, { created_after: '2026-01-01' })).total).toBe(2);
    expect((await call(tool, { created_before: '2026-08-01' })).total).toBe(1);
    expect((await call(tool, { created_after: '2026-01-01', created_before: '2026-08-01' })).total).toBe(1);
  });

  it('accepts a bare date as midnight UTC, so same-day records are included', async () => {
    const [src] = await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'hubspot',
      kind: 'plugin',
      configJson: { _connector: 'hubspot' },
    }).returning({ id: knowledgeSourceSchema.id });
    await db.insert(knowledgeDocumentSchema).values({
      orgId: ORG,
      sourceId: src!.id,
      externalId: 'contacts:midnight',
      title: 'Midnight',
      // Stored without milliseconds — the other ISO shape HubSpot emits.
      metadata: { objectType: 'contacts', hubspotId: 'm1', createdAt: '2026-08-20T00:00:00Z' },
      contentHash: 'contacts:midnight',
      ingestedAt: NOW,
    });
    const tool = toolsByName(ORG).get('get_hubspot_contacts');

    expect((await call(tool, { created_after: '2026-08-20' })).total).toBe(1);
    expect((await call(tool, { created_after: '2026-08-21' })).total).toBe(0);
  });

  it('resolves created_within_days on the server, so the caller never needs today\'s date', async () => {
    const [src] = await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'hubspot',
      kind: 'plugin',
      configJson: { _connector: 'hubspot' },
    }).returning({ id: knowledgeSourceSchema.id });
    const day = 86_400_000;
    for (const [i, ageDays] of [2, 20].entries()) {
      await db.insert(knowledgeDocumentSchema).values({
        orgId: ORG,
        sourceId: src!.id,
        externalId: `contacts:rel-${i}`,
        title: `Relative ${i}`,
        metadata: { objectType: 'contacts', hubspotId: `r${i}`, createdAt: new Date(Date.now() - ageDays * day).toISOString() },
        contentHash: `contacts:rel-${i}`,
        ingestedAt: NOW,
      });
    }
    const tool = toolsByName(ORG).get('get_hubspot_contacts');

    const week = await call(tool, { created_within_days: 7 });
    const month = await call(tool, { created_within_days: 30 });

    expect(week.total).toBe(1);
    expect(month.total).toBe(2);
    // The bound is reported back, so a run states the window it really used.
    expect(week.created_after_applied).toBeTruthy();
  });

  it('lets created_within_days win over a created_after the caller also passed', async () => {
    const [src] = await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'hubspot',
      kind: 'plugin',
      configJson: { _connector: 'hubspot' },
    }).returning({ id: knowledgeSourceSchema.id });
    await db.insert(knowledgeDocumentSchema).values({
      orgId: ORG,
      sourceId: src!.id,
      externalId: 'contacts:recent',
      title: 'Recent',
      metadata: { objectType: 'contacts', hubspotId: 'rr', createdAt: new Date(Date.now() - 86_400_000).toISOString() },
      contentHash: 'contacts:recent',
      ingestedAt: NOW,
    });
    const tool = toolsByName(ORG).get('get_hubspot_contacts');

    // A caller that got today's date wrong by years still gets the right window.
    const res = await call(tool, { created_within_days: 7, created_after: '2020-01-01' });

    expect(res.total).toBe(1);
    expect(res.created_after_applied?.slice(0, 4)).not.toBe('2020');
  });

  it('rejects an unparseable date as data instead of throwing the turn away', async () => {
    await seedCrm();

    const res = await call(toolsByName(ORG).get('get_hubspot_contacts'), { created_after: 'last tuesday' });

    expect(res.error).toBe('bad_argument');
    expect(res.total).toBeUndefined();
  });
});

describe('query lookup', () => {
  it('finds a record by email, company, and HubSpot id, and returns total 0 for a miss', async () => {
    await seedCrm();
    const tool = toolsByName(ORG).get('get_hubspot_contacts');

    expect((await call(tool, { query: 'person1@acme.com' })).total).toBe(1);
    expect((await call(tool, { query: 'acme.com' })).total).toBe(5);
    expect((await call(tool, { query: 'Person 3' })).total).toBe(1);
    expect((await call(tool, { query: 'nobody-by-this-name' })).total).toBe(0);
  });
});

describe('access control', () => {
  it('returns nothing from another org', async () => {
    await seedCrm();

    const res = await call(toolsByName('org_other').get('get_hubspot_contacts'));

    expect(res.total).toBe(0);
    expect(res.error).toBe('no_hubspot_source');
  });

  it('honours the per-user source ACL', async () => {
    await seedCrm();

    // Permitted only the deals source: contacts become unreadable.
    const res = await call(toolsByName(ORG, ['hubspot'], ['hubspot']).get('get_hubspot_contacts'));

    expect(res.total).toBe(0);
    expect(res.sources_read ?? []).not.toContain('hubspot-contacts');
  });
});
