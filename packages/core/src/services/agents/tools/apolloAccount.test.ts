/**
 * `apollo_usage` has one job it must never get wrong: say where its number
 * came from. Live per-endpoint quota from a master key and rate-limit headers
 * observed on the last call are different facts, and a remaining credit
 * balance is a fact Apollo does not expose at all — so the tool must never
 * produce one.
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
const { resetObservedRateSnapshots } = await import('@/libs/apollo/client');
const { apolloUsageTool } = await import('./apolloAccount');
const { apolloListLabelsTool } = await import('./apolloLists');

const ORG = 'org_apollo_usage';

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

type Invokable = { invoke: (input: Record<string, unknown>) => Promise<string> };

async function call(tool: unknown, args: Record<string, unknown> = {}) {
  return JSON.parse(await (tool as Invokable).invoke(args));
}

/**
 * One canned response.
 * @param status - HTTP status.
 * @param body - JSON body.
 * @param headers - Response headers.
 */
function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  resetObservedRateSnapshots();
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

describe('apollo_usage', () => {
  it('reports live quota, and names the endpoint as its source, on a master key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { per_minute: { 'people/match': 50 } })));

    const out = await call(apolloUsageTool(ctxFor()));

    expect(out).toMatchObject({ ok: true, reported_from: 'usage_stats_endpoint' });
    expect(out.usage).toEqual({ per_minute: { 'people/match': 50 } });
    expect(out.note).toContain('never state one');
  });

  it('falls back to the observed headers when the key is not a master key, and says so', async () => {
    // A first call stamps the headers the fallback reads.
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { labels: [] }, {
      'x-rate-limit-hourly': '200',
      'x-hourly-requests-left': '183',
    })));
    await call(apolloListLabelsTool(ctxFor()), {});

    vi.stubGlobal('fetch', vi.fn(async () => res(403, { error: 'master key required' })));
    const out = await call(apolloUsageTool(ctxFor()));

    expect(out).toMatchObject({ ok: true, reported_from: 'observed_response_headers' });
    expect(out.hourly).toEqual({ used: 183, limit: 200 });
    expect(out.raw_headers).toMatchObject({ 'x-rate-limit-hourly': '200' });
    expect(out.observed_on_path).toBe('/api/v1/labels');
    expect(out.note).toContain('not a credit balance');
  });

  it('says quota is unknown rather than estimating it when it has seen nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, { error: 'master key required' })));

    const out = await call(apolloUsageTool(ctxFor()));

    expect(out).toMatchObject({ ok: true, reported_from: 'nothing_observed_yet', usage: null });
    expect(out.message).toContain('Say that quota is unknown');
  });

  it('never reports one org\'s observed quota to another', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { labels: [] }, { 'x-rate-limit-hourly': '200' })));
    await call(apolloListLabelsTool(ctxFor()), {});

    vi.stubGlobal('fetch', vi.fn(async () => res(403, { error: 'master key required' })));
    // Another org, whose only Apollo source is this one's — it has no
    // credential of its own, so it never reaches the fallback.
    const out = await call(apolloUsageTool(ctxFor('org_other')));

    expect(out).toMatchObject({ ok: false, error: 'no_apollo_credentials' });
  });

  it('hands a missing credential back as data', async () => {
    vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);

    const out = await call(apolloUsageTool(ctxFor()));

    expect(out).toMatchObject({ ok: false, error: 'no_apollo_credentials' });
  });
});
