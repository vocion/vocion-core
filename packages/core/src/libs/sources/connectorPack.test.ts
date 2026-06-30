import type { SourceContext } from '@/libs/sources/types';
/**
 * Connector pack against mocked `fetch` — for each connector: yields IngestDocs,
 * switches to incremental when `since` is set, and refuses without a token.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ga4Connector } from '@/libs/sources/ga4';
import { gmailConnector } from '@/libs/sources/gmail';
import { googleAdsConnector } from '@/libs/sources/googleAds';
import { slackConnector } from '@/libs/sources/slack';

function res(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => '' } as unknown as Response;
}
async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}
function baseCtx(config: Record<string, unknown>, credentials: Record<string, unknown>, since?: Date): SourceContext {
  return { sourceId: 1, orgId: 'o1', config, credentials, since };
}

afterEach(() => vi.unstubAllGlobals());

describe('googleAdsConnector', () => {
  const cfg = { customerId: '123' };
  const creds = { token: 't', developerToken: 'dev' };

  it('yields a campaign/day doc; refuses without tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ results: [{ campaign: { id: '7', name: 'Brand' }, metrics: { clicks: '10' }, segments: { date: '2026-06-01' } }] })));
    const docs = await collect(googleAdsConnector.sync(baseCtx(cfg, creds)));

    expect(docs[0]!.externalId).toBe('campaign:7:2026-06-01');
    expect(docs[0]!.content).toContain('clicks: 10');
    await expect(collect(googleAdsConnector.sync(baseCtx(cfg, { token: 't' })))).rejects.toThrow(/developerToken/);
  });

  it('filters by date when incremental', async () => {
    const f = vi.fn(async () => res({ results: [] }));
    vi.stubGlobal('fetch', f);
    await collect(googleAdsConnector.sync(baseCtx(cfg, creds, new Date('2026-06-01T00:00:00Z'))));

    expect(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).toContain('segments.date >=');
  });
});

describe('ga4Connector', () => {
  const cfg = { propertyId: 'p1' };

  it('yields a report row; respects since as startDate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ rows: [{ dimensionValues: [{ value: '2026-06-01' }, { value: '/lp' }], metricValues: [{ value: '42' }] }] })));
    const docs = await collect(ga4Connector.sync(baseCtx(cfg, { token: 't' })));

    expect(docs[0]!.content).toContain('sessions: 42');

    const f = vi.fn(async () => res({ rows: [] }));
    vi.stubGlobal('fetch', f);
    await collect(ga4Connector.sync(baseCtx(cfg, { token: 't' }, new Date('2026-06-01T00:00:00Z'))));

    expect(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).toContain('2026-06-01');
  });
});

describe('gmailConnector', () => {
  it('lists then fetches each message; refuses without token', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res({ messages: [{ id: 'm1' }] }))
      .mockResolvedValueOnce(res({ id: 'm1', snippet: 'hi', internalDate: '1717200000000', payload: { headers: [{ name: 'Subject', value: 'Hello' }, { name: 'From', value: 'a@x.com' }] } }));
    vi.stubGlobal('fetch', f);
    const docs = await collect(gmailConnector.sync(baseCtx({}, { token: 't' })));

    expect(docs[0]!.title).toBe('Hello');
    expect(docs[0]!.content).toContain('From: a@x.com');
    await expect(collect(gmailConnector.sync(baseCtx({}, {})))).rejects.toThrow(/token/i);
  });
});

describe('slackConnector', () => {
  const cfg = { channel: 'C1' };

  it('yields messages; errors on ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: true, messages: [{ ts: '1717200000.000', text: 'hello' }] })));
    const docs = await collect(slackConnector.sync(baseCtx(cfg, { token: 't' })));

    expect(docs[0]!.externalId).toBe('slack:C1:1717200000.000');
    expect(docs[0]!.content).toBe('hello');

    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, error: 'not_in_channel' })));

    await expect(collect(slackConnector.sync(baseCtx(cfg, { token: 't' })))).rejects.toThrow(/not_in_channel/);
  });
});
