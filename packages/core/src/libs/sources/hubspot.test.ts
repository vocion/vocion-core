import type { SourceContext } from '@/libs/sources/types';
/**
 * HubSpot connector against a mocked `fetch` — verifies it yields IngestDocs,
 * paginates the `after` cursor, switches to the Search API for incremental
 * (`since`), and refuses to run without a token.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hubspotConnector } from '@/libs/sources/hubspot';

function res(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => '' } as unknown as Response;
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return {
    sourceId: 1,
    orgId: 'org_1',
    config: { objectType: 'contacts' },
    credentials: { token: 'pat-123' },
    ...over,
  };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('hubspotConnector', () => {
  it('yields one IngestDoc per record with serialized properties', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({
      results: [
        { id: '1', properties: { firstname: 'Mara', lastname: 'Okafor', email: 'mara@acme.com' }, updatedAt: '2026-06-01T00:00:00Z' },
      ],
    })));
    const docs = await collect(hubspotConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('contacts:1');
    expect(docs[0]!.title).toBe('Mara Okafor');
    expect(docs[0]!.content).toContain('email: mara@acme.com');
  });

  it('follows the after cursor across pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ results: [{ id: '1', properties: { email: 'a@x.com' } }], paging: { next: { after: 'p2' } } }))
      .mockResolvedValueOnce(res({ results: [{ id: '2', properties: { email: 'b@x.com' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(hubspotConnector.sync(ctx()));

    expect(docs.map(d => d.externalId)).toEqual(['contacts:1', 'contacts:2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the Search API with a hs_lastmodifieddate filter when incremental', async () => {
    const fetchMock = vi.fn(async () => res({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const since = new Date('2026-06-01T00:00:00.000Z');
    await collect(hubspotConnector.sync(ctx({ since })));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(String(url)).toContain('/crm/v3/objects/contacts/search');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain(String(since.getTime()));
  });

  it('refuses to run without a token', async () => {
    await expect(collect(hubspotConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/token/i);
  });
});
