/**
 * hubspot_list_deals — pipeline hygiene without guesses:
 *
 *   - Open deals only (closed stages excluded via pipeline definitions),
 *     oldest-modified first.
 *   - stalled_only returns only deals past their configured stage threshold,
 *     most overdue first, with days_overdue + threshold_days.
 *   - No configured thresholds → an explanation, never a guess.
 */
import type { RuntimeContext } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { hubspotDealTools } = await import('./hubspotDeals');

const ORG = 'org_hs_deals';
const NOW = new Date('2026-08-29T12:00:00.000Z');

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

function theTool(): Invokable {
  const [t] = hubspotDealTools(ctxFor());
  return t as unknown as Invokable;
}

async function call(args: Record<string, unknown> = {}) {
  return JSON.parse(await theTool().invoke(args));
}

function res(status: number, body: unknown): Response {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const PIPELINES = {
  results: [{
    id: 'p1',
    label: 'Sales Pipeline',
    stages: [
      { id: 'stage_disc', label: 'Discovery', metadata: { isClosed: 'false' } },
      { id: 'stage_neg', label: 'Negotiation', metadata: { isClosed: 'false' } },
      { id: 'stage_won', label: 'Closed won', metadata: { isClosed: 'true' } },
    ],
  }],
};

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

// Oldest-modified first, as HubSpot returns them under the ASC sort.
const OPEN_DEALS = {
  total: 3,
  results: [
    { id: '21', properties: { dealname: 'Meridian site', dealstage: 'stage_disc', amount: '30000', hs_lastmodifieddate: daysAgo(30) } },
    { id: '22', properties: { dealname: 'Acme retainer', dealstage: 'stage_neg', amount: '55000', hs_lastmodifieddate: daysAgo(10) } },
    { id: '23', properties: { dealname: 'Bolt refresh', dealstage: 'stage_disc', amount: '12000', hs_lastmodifieddate: daysAgo(2) } },
  ],
};

function stubHubspot() {
  const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/crm/v3/pipelines/deals')) {
      return res(200, PIPELINES);
    }
    bodies.push(String(init?.body ?? ''));
    return res(200, OPEN_DEALS);
  }));
  return bodies;
}

async function seedSource(configJson: Record<string, unknown>) {
  const { eq } = await import('drizzle-orm');
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getCredentialsForSource).mockReset();
  vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'pat-1' });
});

afterEach(() => vi.useRealTimers());

describe('hubspot_list_deals', () => {
  it('lists open deals only, oldest-modified first, filtering by open stage ids', async () => {
    await seedSource({ _connector: 'hubspot' });
    const bodies = stubHubspot();
    const out = await call();

    expect(out).toMatchObject({ ok: true, total_open: 3, returned: 3, thresholds_configured: false });
    expect(out.deals.map((d: { deal_id: string }) => d.deal_id)).toEqual(['21', '22', '23']);
    expect(out.deals[0]).toMatchObject({ stage: 'Discovery', days_since_modified: 30, threshold_days: null, days_overdue: null });
    // The search filtered to open stages and excluded the closed one.
    expect(bodies[0]).toContain('stage_disc');
    expect(bodies[0]).toContain('stage_neg');
    expect(bodies[0]).not.toContain('stage_won');
  });

  it('stalled_only returns only deals past their stage threshold, most overdue first', async () => {
    // Discovery: 14 days, Negotiation: 21 days (keyed by stage ID).
    await seedSource({ _connector: 'hubspot', stallThresholds: { stage_disc: 14, stage_neg: 5 } });
    stubHubspot();
    const out = await call({ stalled_only: true });

    // Deal 21: 30 days in Discovery (threshold 14) → 16 overdue.
    // Deal 22: 10 days in Negotiation (threshold 5) → 5 overdue.
    // Deal 23: 2 days in Discovery → not stalled.
    expect(out).toMatchObject({ ok: true, stalled_count: 2, thresholds_configured: true });
    expect(out.deals.map((d: { deal_id: string }) => d.deal_id)).toEqual(['21', '22']);
    expect(out.deals[0]).toMatchObject({ days_overdue: 16, threshold_days: 14 });
    expect(out.deals[1]).toMatchObject({ days_overdue: 5, threshold_days: 5 });
  });

  it('stalled_only without configured thresholds explains, never guesses', async () => {
    await seedSource({ _connector: 'hubspot' });
    stubHubspot();
    const out = await call({ stalled_only: true });

    expect(out).toMatchObject({ ok: false, error: 'stall_thresholds_unconfigured' });
    expect(out.message).toContain('unconfigured');
    expect(out.message).toContain('stallThresholds');
  });

  it('surfaces a missing_scope failure as data', async () => {
    await seedSource({ _connector: 'hubspot' });
    vi.stubGlobal('fetch', vi.fn(async () => res(403, {
      errors: [{ context: { requiredGranularScopes: ['crm.objects.deals.read'] } }],
    })));
    const out = await call();

    expect(out).toMatchObject({ ok: false, error: 'missing_scope', scope: 'crm.objects.deals.read' });
  });
});
