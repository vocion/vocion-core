/**
 * The GA4 read behind a `verified · web-analytics` measure, against a mocked
 * transport.
 *
 * No network and no real Google credential: the service account is an RSA key
 * generated in-process for this file, and both HTTP calls — the token mint and
 * `runReport` — are a `fetch` stub that records what was asked for.
 *
 * What these tests are really guarding is the failure side. Every path that
 * cannot produce a measured number throws, because the one thing a team report
 * must never show is a zero standing in for a question nobody asked.
 */
import type { WebAnalyticsCredentials } from './credentials';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayRange, dimensionFilterFor, reportRequest, resetWebAnalyticsTokenCache, runWebAnalyticsReport } from './ga4';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function credentials(overrides: Partial<WebAnalyticsCredentials> = {}): WebAnalyticsCredentials {
  return {
    source: 'org',
    propertyId: '100000001',
    serviceAccount: { clientEmail: 'reader@example-org.iam.gserviceaccount.com', privateKey },
    ...overrides,
  };
}

const NOW = new Date('2026-09-15T12:00:00Z');
const WEEK = { since: new Date('2026-09-08T12:00:00Z'), until: NOW };

type Call = { url: string; body: string };
let calls: Call[] = [];

/**
 * A transport that mints a token, then answers `runReport` with `report`.
 * @param report - What GA4 should answer runReport with.
 * @param report.status - HTTP status; 200 when omitted.
 * @param report.body - The JSON body.
 */
function transport(report: { status?: number; body?: unknown }) {
  return vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ?? '' });
    if (url.includes('oauth2.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'stub-token', expires_in: 3600 }) };
    }
    const status = report.status ?? 200;
    return { ok: status < 400, status, json: async () => report.body ?? {}, text: async () => '' };
  });
}

const rows = (value: string) => ({ rows: [{ metricValues: [{ value }] }] });

beforeEach(() => {
  calls = [];
  resetWebAnalyticsTokenCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the request GA4 is asked', () => {
  it('reports over the whole days the window covers, with the exclusive end stepped back', () => {
    // Without the step back, a window ending at midnight would pull in a
    // whole extra day of traffic and inflate the reading.
    expect(dayRange({ since: new Date('2026-09-08T00:00:00Z'), until: new Date('2026-09-15T00:00:00Z') }))
      .toEqual({ startDate: '2026-09-08', endDate: '2026-09-14' });
  });

  it('keeps a sub-day window inside one day rather than ending before it starts', () => {
    expect(dayRange({ since: new Date('2026-09-15T06:00:00Z'), until: new Date('2026-09-15T07:00:00Z') }))
      .toEqual({ startDate: '2026-09-15', endDate: '2026-09-15' });
  });

  it('sends no dimensionFilter when the measure declares no filter', () => {
    expect(dimensionFilterFor({})).toBeUndefined();
    expect(reportRequest({ metric: 'sessions', filter: {} }, WEEK)).not.toHaveProperty('dimensionFilter');
  });

  it('ANDs every predicate the measure named — "that traffic, from that channel", never either', () => {
    const filter = dimensionFilterFor({ pathPrefix: '/docs', channel: 'Organic Search' });

    expect(filter?.andGroup.expressions.map(e => e.filter.fieldName))
      .toEqual(['landingPagePlusQueryString', 'sessionDefaultChannelGroup']);
    expect(filter?.andGroup.expressions[0]?.filter.stringFilter).toEqual({ matchType: 'BEGINS_WITH', value: '/docs' });
    expect(filter?.andGroup.expressions[1]?.filter.stringFilter).toEqual({ matchType: 'EXACT', value: 'Organic Search' });
  });

  it('asks for one metric and no dimensions, so the answer cannot be a truncated partial sum', () => {
    const body = reportRequest({ metric: 'sessions', filter: {} }, WEEK);

    expect(body).toMatchObject({ metrics: [{ name: 'sessions' }], limit: 1 });
    expect(body).not.toHaveProperty('dimensions');
  });

  it.each([
    ['sessions', 'sessions'],
    ['users', 'totalUsers'],
    ['conversions', 'keyEvents'],
    ['signups', 'eventCount'],
  ] as const)('maps the %s measure onto the GA4 metric %s', (metric, ga4) => {
    expect(reportRequest({ metric, filter: {} }, WEEK)).toMatchObject({ metrics: [{ name: ga4 }] });
  });
});

describe('runWebAnalyticsReport', () => {
  it('mints a token for the service account, then reads the property', async () => {
    vi.stubGlobal('fetch', transport({ body: rows('412') }));

    await expect(runWebAnalyticsReport(credentials(), { metric: 'sessions', filter: {} }, WEEK, NOW)).resolves.toBe(412);

    expect(calls[0]?.url).toContain('oauth2.googleapis.com');
    expect(calls[0]?.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(calls[1]?.url).toContain('/properties/100000001:runReport');
  });

  it('counts one named event for a signups measure', async () => {
    vi.stubGlobal('fetch', transport({ body: rows('9') }));

    await expect(runWebAnalyticsReport(credentials(), { metric: 'signups', filter: { event: 'sign_up' } }, WEEK, NOW)).resolves.toBe(9);

    expect(JSON.parse(calls[1]!.body)).toMatchObject({
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: { andGroup: { expressions: [{ filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'sign_up' } } }] } },
    });
  });

  it('returns a MEASURED zero when GA4 ran the query and nothing matched', async () => {
    // The one honest zero: Google was asked and answered "none". Every other
    // no-number path throws instead.
    vi.stubGlobal('fetch', transport({ body: { rows: [] } }));

    await expect(runWebAnalyticsReport(credentials(), { metric: 'sessions', filter: {} }, WEEK, NOW)).resolves.toBe(0);
  });

  it('throws rather than returning 0 when the property refuses the service account', async () => {
    vi.stubGlobal('fetch', transport({ status: 403 }));

    await expect(runWebAnalyticsReport(credentials(), { metric: 'sessions', filter: {} }, WEEK, NOW))
      .rejects
      .toThrow(/Viewer role on the property/);
  });

  it('names the property id as the thing to check on a 404, without echoing Google\'s body', async () => {
    vi.stubGlobal('fetch', transport({ status: 404, body: { error: { message: 'properties/100000001 not found' } } }));

    await expect(runWebAnalyticsReport(credentials(), { metric: 'users', filter: {} }, WEEK, NOW))
      .rejects
      .toThrow('Google Analytics has no property with the stored property ID.');
  });

  it('throws rather than returning 0 when the figure cannot be read as a number', async () => {
    vi.stubGlobal('fetch', transport({ body: { rows: [{ metricValues: [{ value: 'n/a' }] }] } }));

    await expect(runWebAnalyticsReport(credentials(), { metric: 'sessions', filter: {} }, WEEK, NOW))
      .rejects
      .toThrow(/could not read/);
  });

  it('throws before any request when the stored private key cannot sign', async () => {
    const fetchMock = transport({ body: rows('1') });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runWebAnalyticsReport(
      credentials({ serviceAccount: { clientEmail: 'reader@example-org.iam.gserviceaccount.com', privateKey: 'not a key' } }),
      { metric: 'sessions', filter: {} },
      WEEK,
      NOW,
    )).rejects.toThrow(/Re-paste the private_key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses a token for the same credential and mints a fresh one for a different credential', async () => {
    // The cache is keyed on the credential, never on the org: that is what
    // stops one workspace's token answering another workspace's read, and
    // what makes a rotated key take effect on the next call.
    vi.stubGlobal('fetch', transport({ body: rows('5') }));
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;

    await runWebAnalyticsReport(credentials(), { metric: 'sessions', filter: {} }, WEEK, NOW);
    await runWebAnalyticsReport(credentials(), { metric: 'users', filter: {} }, WEEK, NOW);
    await runWebAnalyticsReport(
      credentials({ propertyId: '300000003', serviceAccount: { clientEmail: 'other@example-b.iam.gserviceaccount.com', privateKey: other } }),
      { metric: 'sessions', filter: {} },
      WEEK,
      NOW,
    );

    const mints = calls.filter(c => c.url.includes('oauth2.googleapis.com'));

    expect(mints).toHaveLength(2);
    expect(calls.filter(c => c.url.includes('runReport'))).toHaveLength(3);
  });
});
