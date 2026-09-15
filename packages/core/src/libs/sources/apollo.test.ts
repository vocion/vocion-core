/**
 * The Apollo connector is a capability carrier and an entitlement probe.
 *
 * The probe is the reason this whole ticket could be built without an Apollo
 * key: it is what establishes, from a browser and for one credit, the three
 * facts documentation cannot settle — is company search open on this plan, is
 * this a master key, and what are the rate-limit header names really called.
 * A closed plan tier must fail only the check it closes and leave the rest
 * reporting truthfully, which is what most of these tests are about.
 */
import type { SourceContext } from '@/libs/sources/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apolloConnector, inspectApolloKey } from '@/libs/sources/apollo';
import { InspectInputError } from '@/libs/sources/inspect';

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

const RATE_HEADERS = { 'x-rate-limit-minute': '50', 'x-rate-limit-hourly': '200', 'x-rate-limit-daily': '600' };

/**
 * A fetch double answering each probe endpoint with the status given.
 * @param statuses - Status per endpoint.
 * @param statuses.people - Status for the people-search call.
 * @param statuses.companies - Status for the company-search call.
 * @param statuses.usage - Status for the usage-stats call.
 * @param headers - Rate-limit headers to stamp on every response.
 */
function probeFetch(
  statuses: { people: number; companies: number; usage: number },
  headers: Record<string, string> = RATE_HEADERS,
) {
  return vi.fn(async (url: string) => {
    const target = String(url);
    if (target.includes('mixed_people/api_search')) {
      return res(statuses.people, statuses.people === 200 ? { pagination: { total_entries: 4210 } } : { error: 'no' }, headers);
    }
    if (target.includes('mixed_companies/search')) {
      return res(statuses.companies, { error: 'no' }, headers);
    }
    return res(statuses.usage, { error: 'no' }, headers);
  });
}

/**
 * One check off an inspection, by key.
 * @param inspection - What the probe returned.
 * @param key - The check to find.
 */
function checkFor(inspection: Awaited<ReturnType<typeof inspectApolloKey>>, key: string) {
  return inspection.checks.find(entry => entry.key === key);
}

afterEach(() => vi.unstubAllGlobals());

describe('apolloConnector', () => {
  it('registers as a sync-less apikey connector, so its row offers Test connection', () => {
    expect(apolloConnector.slug).toBe('apollo');
    expect(apolloConnector.authKind).toBe('apikey');
    expect(apolloConnector.syncless).toBe(true);
    expect(apolloConnector.inspect).toBeTypeOf('function');
  });

  it('ingests nothing: Apollo is read live, never mirrored', async () => {
    const docs = [];
    for await (const doc of apolloConnector.sync({ sourceId: 1, orgId: 'o1', config: {} } as SourceContext)) {
      docs.push(doc);
    }

    expect(docs).toEqual([]);
  });

  it('asks for the key rather than probing without one', async () => {
    await expect(apolloConnector.inspect!({ config: {}, credentials: {}, options: {} }))
      .rejects
      .toThrow(InspectInputError);
  });

  it('probes with the key as typed, against the configured host', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return res(200, { pagination: { total_entries: 1 } }, RATE_HEADERS);
    }));

    await apolloConnector.inspect!({
      config: { baseUrl: 'https://apollo.test' },
      credentials: { token: 'key-1' },
      options: {},
    });

    expect(urls.every(url => url.startsWith('https://apollo.test'))).toBe(true);
  });
});

describe('the entitlement probe', () => {
  it('reports every check passing on a paid master key', async () => {
    vi.stubGlobal('fetch', probeFetch({ people: 200, companies: 200, usage: 200 }));

    const inspection = await inspectApolloKey({ apiKey: 'k' });

    expect(inspection).toMatchObject({ reachable: true, authorized: true });
    expect(inspection.checks.map(c => c.key)).toEqual([
      'auth',
      'people_search',
      'company_search',
      'usage_stats',
      'rate_limit_headers',
    ]);
    expect(inspection.checks.every(c => c.ok)).toBe(true);
    expect(checkFor(inspection, 'people_search')?.detail).toContain('4210');
  });

  it('spends exactly one credit: three calls, one of them billable', async () => {
    const fetchMock = probeFetch({ people: 200, companies: 200, usage: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await inspectApolloKey({ apiKey: 'k' });

    const paths = fetchMock.mock.calls.map(call => String(call[0]));

    expect(paths).toHaveLength(3);
    expect(paths.filter(p => p.includes('mixed_companies/search'))).toHaveLength(1);
    // Enrichment is deliberately not probed: it spends a credit to reveal a
    // real person, and proves nothing the auth check has not already proven.
    expect(paths.some(p => p.includes('people/match'))).toBe(false);
  });

  it('fails the auth check with Apollo\'s own message on a bad key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { error: 'Invalid API key.' }, {})));

    const inspection = await inspectApolloKey({ apiKey: 'nope' });

    expect(inspection.authorized).toBe(false);
    expect(checkFor(inspection, 'auth')?.ok).toBe(false);
    expect(checkFor(inspection, 'auth')?.detail).toContain('Invalid API key.');
  });

  it('fails only the check a closed plan tier closes', async () => {
    vi.stubGlobal('fetch', probeFetch({ people: 200, companies: 403, usage: 403 }));

    const inspection = await inspectApolloKey({ apiKey: 'k' });

    expect(inspection.authorized).toBe(true);
    expect(checkFor(inspection, 'auth')?.ok).toBe(true);
    expect(checkFor(inspection, 'people_search')?.ok).toBe(true);
    expect(checkFor(inspection, 'company_search')?.ok).toBe(false);
    expect(checkFor(inspection, 'usage_stats')?.ok).toBe(false);
    expect(checkFor(inspection, 'rate_limit_headers')?.ok).toBe(true);
  });

  it('says what apollo_usage will do instead when the key is not a master key', async () => {
    vi.stubGlobal('fetch', probeFetch({ people: 200, companies: 200, usage: 403 }));

    const inspection = await inspectApolloKey({ apiKey: 'k' });

    expect(checkFor(inspection, 'usage_stats')?.detail).toContain('MASTER');
    expect(checkFor(inspection, 'usage_stats')?.detail).toContain('rate-limit headers observed');
  });

  it('echoes the rate-limit header names verbatim, so the client\'s guess is confirmed or corrected', async () => {
    vi.stubGlobal('fetch', probeFetch(
      { people: 200, companies: 200, usage: 200 },
      { 'x-24-hour-requests-left': '480', 'x-rate-limit-minute': '50' },
    ));

    const inspection = await inspectApolloKey({ apiKey: 'k' });

    expect(checkFor(inspection, 'rate_limit_headers')?.detail).toContain('x-rate-limit-minute');
  });

  it('reports honestly when no rate-limit header came back at all', async () => {
    vi.stubGlobal('fetch', probeFetch({ people: 200, companies: 200, usage: 200 }, {}));

    const inspection = await inspectApolloKey({ apiKey: 'k' });

    expect(checkFor(inspection, 'rate_limit_headers')?.ok).toBe(false);
    expect(checkFor(inspection, 'rate_limit_headers')?.detail).toContain('No rate-limit headers');
  });

  it('reports an unreachable Apollo as unreachable, not as a bad key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.apollo.io');
    }));

    const inspection = await inspectApolloKey({ apiKey: 'k' });

    expect(inspection).toMatchObject({ reachable: false, authorized: false });
    expect(inspection.error).toContain('ENOTFOUND');
  });

  it('says outright that nothing was saved', async () => {
    vi.stubGlobal('fetch', probeFetch({ people: 200, companies: 200, usage: 200 }));

    const inspection = await inspectApolloKey({ apiKey: 'k' });

    expect(inspection.note).toContain('no source row, no credential, no vault write');
  });
});
