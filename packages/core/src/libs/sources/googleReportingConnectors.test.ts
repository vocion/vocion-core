/**
 * GA4 and Google Ads authenticate the way every other Google connector does
 * (vocion-core#129).
 *
 * Both read `credentials.token` directly. The Google credential the Sources
 * screen saves is `{ clientId, clientSecret, refreshToken, developerToken? }`
 * with no `token` at all, so every sync threw, and a pasted access token
 * stopped working within the hour. They now go through
 * `resolveGoogleAccessToken`, which exchanges the refresh token.
 *
 * `fetch` is stubbed: the token endpoint mints `minted-for-<refresh token>`,
 * and the report endpoints return one row each. No request leaves the test.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ga4Connector } from './ga4';
import { googleAdsConnector } from './googleAds';

type Call = { url: string; authorization: string | null; developerToken: string | null };

let calls: Call[] = [];

/**
 * Stand-in for Google: mints an access token from a refresh token, and
 * answers the GA4 and Ads report calls with one row each.
 * @param input - The request URL.
 * @param init - The request options.
 */
async function fakeGoogle(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);
  calls.push({ url, authorization: headers.get('authorization'), developerToken: headers.get('developer-token') });
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(String(init?.body));
    return Response.json({ access_token: `minted-for-${form.get('refresh_token')}`, expires_in: 3600 });
  }
  if (url.endsWith(':runReport')) {
    return Response.json({ rows: [{ dimensionValues: [{ value: '20260901' }, { value: '/pricing' }], metricValues: [{ value: '42' }] }] });
  }
  if (url.endsWith('/googleAds:search')) {
    return Response.json({ results: [{ campaign: { id: '7', name: 'Brand' }, metrics: { clicks: 3 }, segments: { date: '2026-09-01' } }] });
  }
  return new Response('not found', { status: 404 });
}

function context(config: Record<string, unknown>, credentials: Record<string, unknown>): SourceContext {
  return { sourceId: 1, orgId: 'org_google_reporting', config, credentials };
}

async function collect(docs: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const doc of docs) {
    out.push(doc);
  }
  return out;
}

/** The report calls, without the token exchange. */
function reportCalls(): Call[] {
  return calls.filter(c => !c.url.startsWith('https://oauth2.googleapis.com'));
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(fakeGoogle));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GA4 connector auth', () => {
  it('syncs with the saved Google credential by exchanging its refresh token', async () => {
    const credentials = { clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'refresh-ga4' };

    const docs = await collect(ga4Connector.sync(context({ propertyId: '123' }, credentials)));

    expect(docs).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(reportCalls()[0]!.authorization).toBe('Bearer minted-for-refresh-ga4');
  });

  it('still accepts a pasted access token', async () => {
    await collect(ga4Connector.sync(context({ propertyId: '123' }, { token: 'pasted-token' })));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.authorization).toBe('Bearer pasted-token');
  });

  it('refuses to sync with no usable Google credential, before calling the report', async () => {
    await expect(collect(ga4Connector.sync(context({ propertyId: '123' }, {})))).rejects.toThrow('Google credentials missing');
    expect(calls).toHaveLength(0);
  });
});

describe('Google Ads connector auth', () => {
  it('syncs with the saved Google credential, sending the minted token and the developer token', async () => {
    const credentials = { clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'refresh-ads', developerToken: 'dev-1' };

    const docs = await collect(googleAdsConnector.sync(context({ customerId: '1234567890' }, credentials)));

    expect(docs).toHaveLength(1);
    expect(reportCalls()[0]!.authorization).toBe('Bearer minted-for-refresh-ads');
    expect(reportCalls()[0]!.developerToken).toBe('dev-1');
  });

  it('asks for the developer token without spending a token exchange', async () => {
    const credentials = { clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'refresh-no-dev' };

    await expect(collect(googleAdsConnector.sync(context({ customerId: '1234567890' }, credentials)))).rejects.toThrow('developer token');
    expect(calls).toHaveLength(0);
  });
});
