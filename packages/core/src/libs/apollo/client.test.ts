/**
 * The Apollo client's whole job beyond `fetch`: name the failures a plan can
 * cause, honour the wait a 429 asks for, and keep the rate-limit headers the
 * usage guardrail falls back on. None of it needs an Apollo key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApolloClient,
  keyFromCredentials,
  noApolloCredentials,
  observedRateSnapshot,
  rateSnapshotFrom,
  resetObservedRateSnapshots,
} from './client';

/**
 * A response with headers, the way the client reads them.
 * @param status - HTTP status.
 * @param body - JSON body.
 * @param headers - Header name to value.
 */
function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const bag = new Headers(headers);
  return {
    ok: status < 300,
    status,
    headers: bag,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  resetObservedRateSnapshots();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('credentials', () => {
  it('reads the key under any of the field names the vault may hold it as', () => {
    expect(keyFromCredentials({ token: ' k1 ' })).toBe('k1');
    expect(keyFromCredentials({ apiKey: 'k2' })).toBe('k2');
    expect(keyFromCredentials({ api_key: 'k3' })).toBe('k3');
    expect(keyFromCredentials({ token: '' })).toBeUndefined();
    expect(keyFromCredentials(undefined)).toBeUndefined();
  });

  it('names the Sources-page fix when there is no key', () => {
    const failure = noApolloCredentials();

    expect(failure).toMatchObject({ ok: false, error: 'no_apollo_credentials' });
    expect(failure.message).toContain('Sources page');
  });
});

describe('failure shaping', () => {
  it('names a rejected key rather than a generic error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { error: 'Invalid API key' })));
    const out = await createApolloClient({ apiKey: 'bad' }).post('/api/v1/mixed_people/api_search', {});

    expect(out).toMatchObject({ ok: false, error: 'apollo_unauthorized', status: 401 });
    expect((out as { message: string }).message).toContain('Invalid API key');
  });

  it('names a closed plan tier on company search, not a bug', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, { error: 'forbidden' })));
    const out = await createApolloClient({ apiKey: 'k' }).post('/api/v1/mixed_companies/search', {});

    expect(out).toMatchObject({ ok: false, error: 'plan_tier_unavailable', endpoint: 'company_search' });
  });

  it('names the master-key requirement on usage stats', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, { error: 'forbidden' })));
    const out = await createApolloClient({ apiKey: 'k' }).get('/api/v1/usage_stats/api_usage_stats');

    expect(out).toMatchObject({ ok: false, error: 'plan_tier_unavailable', endpoint: 'usage_stats' });
    expect((out as { message: string }).message).toContain('MASTER');
  });

  it('reports a 403 on a plan-independent endpoint as an authorization failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, { error: 'nope' })));
    const out = await createApolloClient({ apiKey: 'k' }).post('/api/v1/people/match', {});

    expect(out).toMatchObject({ ok: false, error: 'apollo_unauthorized', status: 403 });
  });

  it('surfaces an exhausted rate limit as retry-after data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, { error: 'slow down' }, { 'retry-after': '30' })));
    const call = createApolloClient({ apiKey: 'k' }).post('/api/v1/people/match', {});
    await vi.runAllTimersAsync();

    expect(await call).toMatchObject({ ok: false, error: 'apollo_rate_limited', retry_after_seconds: 30 });
  });

  it('returns a transport failure as data, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.apollo.io');
    }));
    const out = await createApolloClient({ apiKey: 'k' }).get('/api/v1/labels');

    expect(out).toMatchObject({ ok: false, error: 'apollo_error', status: 0 });
  });
});

describe('Retry-After', () => {
  it('waits exactly as long as Apollo asked, then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(res(200, { people: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const call = createApolloClient({ apiKey: 'k' }).post('/api/v1/mixed_people/api_search', {});
    await vi.advanceTimersByTimeAsync(2000);

    await expect(call).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget rather than retrying forever', async () => {
    const fetchMock = vi.fn(async () => res(429, {}, { 'retry-after': '1' }));
    vi.stubGlobal('fetch', fetchMock);

    const call = createApolloClient({ apiKey: 'k' }).post('/api/v1/people/match', {});
    await vi.runAllTimersAsync();

    await expect(call).resolves.toMatchObject({ ok: false, error: 'apollo_rate_limited' });
    // Five retries plus the first attempt.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe('rate-limit header capture', () => {
  it('keeps every rate-limit header verbatim and reads the counts it recognises', () => {
    const snapshot = rateSnapshotFrom(
      res(200, {}, {
        'x-rate-limit-minute': '50',
        'x-minute-requests-left': '48',
        'x-rate-limit-hourly': '200',
        'x-rate-limit-daily': '600',
        'content-type': 'application/json',
      }),
      '/api/v1/labels',
    );

    expect(snapshot?.headers).toEqual({
      'x-rate-limit-minute': '50',
      'x-minute-requests-left': '48',
      'x-rate-limit-hourly': '200',
      'x-rate-limit-daily': '600',
    });
    expect(snapshot?.minute).toEqual({ used: 48, limit: 50 });
    expect(snapshot?.daily).toEqual({ used: null, limit: 600 });
    expect(snapshot?.path).toBe('/api/v1/labels');
  });

  it('reports nothing rather than zeroes when a response carries no such header', () => {
    expect(rateSnapshotFrom(res(200, {}, { 'content-type': 'application/json' }), '/x')).toBeNull();
  });

  it('records the latest snapshot per org for the usage fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { labels: [] }, { 'x-rate-limit-hourly': '200', 'x-hourly-requests-left': '199' })));
    await createApolloClient({ apiKey: 'k', orgId: 'org_a' }).get('/api/v1/labels');

    expect(observedRateSnapshot('org_a')).toMatchObject({ hourly: { used: 199, limit: 200 } });
    expect(observedRateSnapshot('org_b')).toBeNull();
  });
});
