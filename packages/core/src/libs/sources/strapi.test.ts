/**
 * Strapi connector against a mocked `fetch` — verifies it yields IngestDocs from
 * both the v4 (nested `attributes`) and v5 (flat) response shapes, walks every
 * page, filters by `updatedAt` when incremental, resumes from a cursor, and
 * fails loudly on a missing token or an upstream error.
 */

import type { SourceContext } from '@/libs/sources/types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectStrapiInstance, strapiConnector } from '@/libs/sources/strapi';

function res(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => 'upstream said no',
  } as unknown as Response;
}

function page(data: unknown[], pageCount = 1, pageNumber = 1): unknown {
  return { data, meta: { pagination: { page: pageNumber, pageCount, total: data.length } } };
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return {
    sourceId: 1,
    orgId: 'org_1',
    config: { baseUrl: 'https://cms.partner.org', collections: ['events'] },
    credentials: { token: 'strapi-token' },
    ...over,
  };
}

async function collect(iterable: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const doc of iterable) {
    out.push(doc);
  }
  return out;
}

/**
 * Query string of the nth `fetch` call, parsed for assertions.
 * @param fetchMock - The stubbed global `fetch`.
 * @param callIndex - Which call to inspect, defaulting to the first.
 */
function queryOf(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): URLSearchParams {
  const url = String((fetchMock.mock.calls[callIndex] as unknown as [string])[0]);
  return new URLSearchParams(url.split('?')[1] ?? '');
}

afterEach(() => vi.unstubAllGlobals());

describe('strapiConnector', () => {
  it('yields one IngestDoc per entry from the v5 flat shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([
      {
        id: 7,
        documentId: 'abc123',
        title: 'Night Market',
        venue: 'Pier 9',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ]))));

    const docs = await collect(strapiConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('events:abc123');
    expect(docs[0]!.title).toBe('Night Market');
    expect(docs[0]!.content).toContain('venue: Pier 9');
    expect(docs[0]!.uri).toBe('https://cms.partner.org/api/events/abc123');
    expect(docs[0]!.lastModifiedAt).toEqual(new Date('2026-06-01T00:00:00.000Z'));
    expect(docs[0]!.metadata).toMatchObject({ collection: 'events', strapiId: 'abc123' });
  });

  it('yields from the v4 nested attributes shape, keyed on the numeric id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([
      { id: 7, attributes: { title: 'Night Market', venue: 'Pier 9', locale: 'en' } },
    ]))));

    const docs = await collect(strapiConnector.sync(ctx()));

    expect(docs[0]!.externalId).toBe('events:7');
    expect(docs[0]!.content).toContain('venue: Pier 9');
    expect(docs[0]!.metadata).toMatchObject({ locale: 'en' });
    // Strapi-managed fields stay out of the body text.
    expect(docs[0]!.content).not.toContain('locale:');
    expect(docs[0]!.lastModifiedAt).toBeNull();
  });

  it('walks every page reported by meta.pagination.pageCount', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(page([{ id: 1, title: 'One' }], 2, 1)))
      .mockResolvedValueOnce(res(page([{ id: 2, title: 'Two' }], 2, 2)));
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(strapiConnector.sync(ctx()));

    expect(docs.map(doc => doc.externalId)).toEqual(['events:1', 'events:2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queryOf(fetchMock, 0).get('pagination[page]')).toBe('1');
    expect(queryOf(fetchMock, 1).get('pagination[page]')).toBe('2');
  });

  it('stops after one page when the response carries no pagination meta', async () => {
    const fetchMock = vi.fn(async () => res({ data: [{ id: 1, title: 'One' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(strapiConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('yields nothing for an empty collection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([]))));

    await expect(collect(strapiConnector.sync(ctx()))).resolves.toEqual([]);
  });

  it('filters on updatedAt when a since watermark is set', async () => {
    const fetchMock = vi.fn(async () => res(page([])));
    vi.stubGlobal('fetch', fetchMock);
    const since = new Date('2026-06-01T00:00:00.000Z');

    await collect(strapiConnector.sync(ctx({ since })));

    expect(queryOf(fetchMock).get('filters[updatedAt][$gt]')).toBe(since.toISOString());
    expect(queryOf(fetchMock).get('sort[0]')).toBe('updatedAt:asc');
  });

  it('omits the updatedAt filter on a full walk', async () => {
    const fetchMock = vi.fn(async () => res(page([])));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx()));

    expect(queryOf(fetchMock).get('filters[updatedAt][$gt]')).toBeNull();
    expect(queryOf(fetchMock).get('pagination[pageSize]')).toBe('100');
    expect(queryOf(fetchMock).get('populate')).toBe('*');
  });

  it('resumes from the page number in ctx.cursor', async () => {
    const fetchMock = vi.fn(async () => res(page([], 3, 3)));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx({ cursor: '0:3' })));

    expect(queryOf(fetchMock).get('pagination[page]')).toBe('3');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('starts at page 1 when the cursor is not a usable page number', async () => {
    const fetchMock = vi.fn(async () => res(page([])));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx({ cursor: 'not-a-number' })));

    expect(queryOf(fetchMock).get('pagination[page]')).toBe('1');
  });

  it('flattens rich-text blocks and relation labels into the body text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([
      {
        id: 1,
        title: 'Night Market',
        body: [{ children: [{ text: 'Food stalls ' }, { text: 'and live music.' }] }],
        venue: { id: 4, name: 'Pier 9' },
        tags: ['food', 'music'],
        sponsor: { id: 9 },
        cancelled: false,
      },
    ]))));

    const docs = await collect(strapiConnector.sync(ctx()));
    const { content } = docs[0]!;

    expect(content).toContain('body: Food stalls and live music.');
    expect(content).toContain('venue: Pier 9');
    expect(content).toContain('tags: food, music');
    expect(content).toContain('cancelled: false');
    // A relation with no readable label contributes nothing.
    expect(content).not.toContain('sponsor:');
  });

  it('falls back to a generated title and body when the entry has neither', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([{ id: 5, notes: '' }]))));

    const docs = await collect(strapiConnector.sync(ctx()));

    expect(docs[0]!.title).toBe('events 5');
    expect(docs[0]!.content).toBe('events 5');
  });

  it('accepts an apiToken credential as well as token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([]))));

    await expect(
      collect(strapiConnector.sync(ctx({ credentials: { apiToken: 'strapi-token' } }))),
    ).resolves.toEqual([]);
  });

  it('refuses to run without an API token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([]))));

    await expect(collect(strapiConnector.sync(ctx({ credentials: {} }))))
      .rejects
      .toThrow(/requires an API token/);
  });

  it('reports an upstream failure instead of throwing, so other collections still run', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(null, false, 401)));
    const onProgress = vi.fn();

    await expect(collect(strapiConnector.sync(ctx({ onProgress })))).resolves.toEqual([]);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      uri: 'https://cms.partner.org/api/events',
      message: expect.stringMatching(/Strapi events fetch failed: 401/),
    }));
  });

  it('rejects an instance URL that is not a URL, wherever it came from', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([]))));

    await expect(collect(strapiConnector.sync(ctx({ config: { baseUrl: 'not-a-url', collections: ['events'] } }))))
      .rejects
      .toThrow(/instance URL/);
  });

  it('takes the instance URL from the credential, where the token lives', async () => {
    // A Strapi token only works against the instance that issued it, so the
    // URL travels with the token rather than sitting in the install config.
    const fetchMock = vi.fn(async () => res(page([{ id: 1, title: 'One' }])));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx({
      config: { collections: ['events'] },
      credentials: { token: 'strapi-token', baseUrl: 'https://cms.credential.example' },
    })));

    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('https://cms.credential.example/api/events');
  });

  it('prefers the credential\'s instance URL over a leftover config one', async () => {
    // Both present means a half-migrated install. The credential is the value
    // that rotates with the token, so it wins.
    const fetchMock = vi.fn(async () => res(page([])));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx({
      config: { baseUrl: 'https://cms.stale.example', collections: ['events'] },
      credentials: { token: 'strapi-token', baseUrl: 'https://cms.credential.example' },
    })));

    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('https://cms.credential.example/api/events');
  });

  it('keeps syncing an install created before the URL moved into the credential', async () => {
    // The backfill has not run yet: the URL is still in `config`, the token is
    // still the only thing in `credentials`, and ingestion must not stop.
    const fetchMock = vi.fn(async () => res(page([{ id: 1, title: 'One' }])));
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(strapiConnector.sync(ctx({
      config: { baseUrl: 'https://cms.partner.org', collections: ['events'] },
      credentials: { token: 'strapi-token' },
    })));

    expect(docs).toHaveLength(1);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('https://cms.partner.org/api/events');
  });

  it('refuses when no instance URL was supplied at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([]))));

    await expect(collect(strapiConnector.sync(ctx({
      config: { collections: ['events'] },
      credentials: { token: 'strapi-token' },
    }))))
      .rejects
      .toThrow(/instance URL/);
  });

  it('tolerates a base URL with a trailing slash', async () => {
    const fetchMock = vi.fn(async () => res(page([{ id: 1, title: 'One' }])));
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(strapiConnector.sync(
      ctx({ config: { baseUrl: 'https://cms.partner.org/', collections: ['events'] } }),
    ));

    expect(docs[0]!.uri).toBe('https://cms.partner.org/api/events/1');
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0]))
      .toMatch(/^https:\/\/cms\.partner\.org\/api\/events\?/);
  });

  it('still yields an entry that carries no identifier at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([{ title: 'Orphan' }]))));

    const docs = await collect(strapiConnector.sync(ctx()));

    expect(docs[0]!.externalId).toBe('events:');
    expect(docs[0]!.title).toBe('Orphan');
  });

  it('flattens a rich-text block that is not wrapped in an array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([
      { id: 1, summary: { children: [{ text: 'One night only.' }, {}] } },
    ]))));

    const docs = await collect(strapiConnector.sync(ctx()));

    expect(docs[0]!.content).toContain('summary: One night only.');
  });

  it('omits the populate param when populate is set to an empty string', async () => {
    const fetchMock = vi.fn(async () => res(page([])));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx({
      config: { baseUrl: 'https://cms.partner.org', collections: ['events'], populate: '', pageSize: 25 },
    })));

    expect(queryOf(fetchMock).get('populate')).toBeNull();
    expect(queryOf(fetchMock).get('pagination[pageSize]')).toBe('25');
  });

  it('treats a response with no data array as an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ meta: { pagination: { pageCount: 1 } } })));

    await expect(collect(strapiConnector.sync(ctx()))).resolves.toEqual([]);
  });

  it('walks every configured collection in order', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(page([{ id: 1, title: 'Night Market' }])))
      .mockResolvedValueOnce(res(page([{ id: 4, name: 'Pier 9' }])));
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(strapiConnector.sync(ctx({
      config: { baseUrl: 'https://cms.partner.org', collections: ['events', 'venues'] },
    })));

    // externalId is namespaced per collection, so ids cannot collide across them.
    expect(docs.map(doc => doc.externalId)).toEqual(['events:1', 'venues:4']);
    expect(docs.map(doc => doc.metadata?.collection)).toEqual(['events', 'venues']);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('/api/events?');
    expect(String((fetchMock.mock.calls[1] as unknown as [string])[0])).toContain('/api/venues?');
  });

  it('keeps going when one collection fails, and reports which one', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(page([{ id: 1, title: 'Night Market' }])))
      .mockResolvedValueOnce(res(null, false, 500))
      .mockResolvedValueOnce(res(page([{ id: 9, title: 'Beach Cleanup' }])));
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();

    const docs = await collect(strapiConnector.sync(ctx({
      config: { baseUrl: 'https://cms.partner.org', collections: ['events', 'venues', 'workshops'] },
      onProgress,
    })));

    // The healthy collections still deliver; only the broken one is lost.
    expect(docs.map(doc => doc.externalId)).toEqual(['events:1', 'workshops:9']);
    expect(onProgress).toHaveBeenCalledWith({
      kind: 'error',
      uri: 'https://cms.partner.org/api/venues',
      message: expect.stringMatching(/Strapi venues fetch failed: 500/),
    });

    // One error reported, not one per remaining collection.
    const errorEvents = onProgress.mock.calls.filter(([event]) => event.kind === 'error');

    expect(errorEvents).toHaveLength(1);
  });

  it('keeps the documents a collection yielded before it failed mid-walk', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(page([{ id: 1, title: 'One' }], 2, 1)))
      .mockResolvedValueOnce(res(null, false, 503));
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();

    const docs = await collect(strapiConnector.sync(ctx({ onProgress })));

    expect(docs.map(doc => doc.externalId)).toEqual(['events:1']);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });

  it('resumes into the right collection and page from a two-part cursor', async () => {
    const fetchMock = vi.fn(async () => res(page([])));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx({
      config: { baseUrl: 'https://cms.partner.org', collections: ['events', 'venues', 'workshops'] },
      cursor: '1:4',
    })));

    // Starts at venues page 4, then workshops from page 1. events is skipped.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('/api/venues?');
    expect(queryOf(fetchMock, 0).get('pagination[page]')).toBe('4');
    expect(String((fetchMock.mock.calls[1] as unknown as [string])[0])).toContain('/api/workshops?');
    expect(queryOf(fetchMock, 1).get('pagination[page]')).toBe('1');
  });

  it('restarts from the first collection when the cursor points past the list', async () => {
    const fetchMock = vi.fn(async () => res(page([])));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx({ cursor: '7:2' })));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queryOf(fetchMock).get('pagination[page]')).toBe('1');
  });

  it('keeps the collection but restarts its pages when the cursor page is unusable', async () => {
    const fetchMock = vi.fn(async () => res(page([])));
    vi.stubGlobal('fetch', fetchMock);

    await collect(strapiConnector.sync(ctx({
      config: { baseUrl: 'https://cms.partner.org', collections: ['events', 'venues'] },
      cursor: '1:zero',
    })));

    // Resumes into venues as asked, but from page 1 rather than nowhere.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('/api/venues?');
    expect(queryOf(fetchMock).get('pagination[page]')).toBe('1');
  });

  it('reports a non-Error rejection as text rather than losing it', async () => {
    // fetch itself can reject with something that is not an Error — a DNS
    // failure surfaced by a polyfill, a string thrown by a test double.
    vi.stubGlobal('fetch', vi.fn(async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'connection reset';
    }));
    const onProgress = vi.fn();

    await expect(collect(strapiConnector.sync(ctx({ onProgress })))).resolves.toEqual([]);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: 'connection reset',
    }));
  });

  it('rejects a config with an empty collections list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([]))));

    await expect(collect(strapiConnector.sync(ctx({
      config: { baseUrl: 'https://cms.partner.org', collections: [] },
    })))).rejects.toThrow();
  });

  it('reports progress for each entry it yields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(page([{ id: 1, title: 'One' }]))));
    const onProgress = vi.fn();

    await collect(strapiConnector.sync(ctx({ onProgress })));

    expect(onProgress).toHaveBeenCalledWith({
      kind: 'fetched',
      uri: 'https://cms.partner.org/api/events/1',
    });
  });
});

/**
 * `inspectStrapiInstance` powers the Add-source dialog: it runs before any
 * source row or credential exists, so it must report what it found rather than
 * throwing, and must degrade cleanly on instances that keep their content-type
 * list behind the admin API — which is most of them.
 */
describe('inspectStrapiInstance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A private instance: the content-type list is admin-only and content needs
   * the bearer, so the anonymous probe inspect makes is refused. This is the
   * shape that proves a token actually works.
   * @param body - Payload for an authenticated content request.
   */
  function privateInstance(body: unknown) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const hasToken = Boolean((init?.headers as Record<string, string> | undefined)?.authorization);
      if (String(url).includes('content-type-builder')) {
        return res({ error: 'Forbidden' }, false, 403);
      }
      if (!hasToken) {
        return res({ error: 'Unauthorized' }, false, 401);
      }
      return res(body);
    });
  }

  it('lists collection types when the instance lets an API token enumerate them', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('content-type-builder')) {
        return res({
          data: [
            { uid: 'api::venue.venue', schema: { kind: 'collectionType', pluralName: 'venues' } },
            { uid: 'api::event.event', schema: { kind: 'collectionType', pluralName: 'events' } },
            { uid: 'api::home.home', schema: { kind: 'singleType', pluralName: 'homes' } },
            { uid: 'plugin::users-permissions.user', schema: { kind: 'collectionType', pluralName: 'users' } },
          ],
        });
      }
      return res(page([{ id: 1, documentId: 'doc-1', name: 'Night market' }]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const inspection = await inspectStrapiInstance({ baseUrl: 'https://cms.partner.org', token: 'tok' });

    // Alphabetical, api:: collection types only — single types and plugin types
    // are not content collections a source can walk.
    expect(inspection.collections).toEqual(['events', 'venues']);
    expect(inspection.reachable).toBe(true);
    expect(inspection.authorized).toBe(true);
    expect(inspection.enumerationNote).toBeNull();
  });

  it('reports the admin-only content-type list as a note rather than an error', async () => {
    vi.stubGlobal('fetch', privateInstance(page([{ id: 1, documentId: 'doc-1', name: 'Night market' }])));

    const inspection = await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org',
      token: 'tok',
      collections: ['events'],
    });

    expect(inspection.collections).toBeNull();
    expect(inspection.enumerationNote).toContain('admin API');
    // The note must not read as a token problem: a read-only token is the right
    // credential here, and a full-access one would hit the same 403.
    expect(inspection.enumerationNote).toContain('Nothing wrong with your token');
    expect(inspection.error).toBeNull();
    expect(inspection.reachable).toBe(true);
    expect(inspection.authorized).toBe(true);
  });

  it('counts entries and detects v5 from a flat entry', async () => {
    vi.stubGlobal('fetch', privateInstance({
      data: [{ id: 1, documentId: 'doc-1', name: 'Night market' }],
      meta: { pagination: { total: 855 } },
    }));

    const inspection = await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org',
      token: 'tok',
      collections: ['events'],
    });

    expect(inspection.detectedVersion).toBe(5);
    expect(inspection.checks).toEqual([
      { collection: 'events', status: 'ok', entryCount: 855, message: null, publiclyReadable: false },
    ]);
  });

  it('detects v4 from a nested entry', async () => {
    vi.stubGlobal('fetch', privateInstance({
      data: [{ id: 1, attributes: { name: 'Night market' } }],
      meta: { pagination: { total: 2 } },
    }));

    const inspection = await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org',
      token: 'tok',
      collections: ['events'],
    });

    expect(inspection.detectedVersion).toBe(4);
  });

  it('separates a missing collection from one the token cannot read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const hasToken = Boolean((init?.headers as Record<string, string> | undefined)?.authorization);
      if (target.includes('content-type-builder')) {
        return res({ error: 'Forbidden' }, false, 403);
      }
      if (target.includes('/api/ghosts')) {
        return res({ error: 'Not Found' }, false, 404);
      }
      if (target.includes('/api/secrets')) {
        return res({ error: 'Forbidden' }, false, 403);
      }
      if (!hasToken) {
        return res({ error: 'Unauthorized' }, false, 401);
      }
      return res(page([{ id: 1, documentId: 'doc-1' }]));
    }));

    const inspection = await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org',
      token: 'tok',
      collections: ['events', 'ghosts', 'secrets'],
    });

    expect(inspection.checks.map(check => [check.collection, check.status])).toEqual([
      ['events', 'ok'],
      ['ghosts', 'not-found'],
      ['secrets', 'forbidden'],
    ]);
    // One readable collection is enough to call the token good.
    expect(inspection.authorized).toBe(true);
  });

  it('calls out a rejected token instead of blaming the collection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: 'Unauthorized' }, false, 401)));

    const inspection = await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org',
      token: 'stale-token',
      collections: ['events'],
    });

    expect(inspection.reachable).toBe(true);
    expect(inspection.authorized).toBe(false);
    expect(inspection.checks[0]!.status).toBe('unauthorized');
    expect(inspection.error).toContain('rejected');
  });

  it('still flags a rejected token when the collection is publicly readable', async () => {
    // A public Strapi collection answers 200 with no credential at all, so a
    // 200 here must not be read as proof the token works.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      String(url).includes('content-type-builder')
        ? res({ error: 'Unauthorized' }, false, 401)
        : res(page([{ id: 1, documentId: 'doc-1' }]))
    )));

    const inspection = await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org',
      token: 'stale-token',
      collections: ['events'],
    });

    expect(inspection.authorized).toBe(false);
    expect(inspection.enumerationNote).toContain('rejected the token');
  });

  it('reports an unreachable host without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND cms.partner.org');
    }));

    const inspection = await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org',
      token: 'tok',
      collections: ['events'],
    });

    expect(inspection.reachable).toBe(false);
    expect(inspection.authorized).toBe(false);
    expect(inspection.error).toContain('ENOTFOUND');
  });

  it('trims a trailing slash off the base URL before calling the instance', async () => {
    const fetchMock = privateInstance(page([{ id: 1, documentId: 'doc-1' }]));
    vi.stubGlobal('fetch', fetchMock);

    await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org/',
      token: 'tok',
      collections: ['events'],
    });

    expect(fetchMock.mock.calls.every(call => !String(call[0]).includes('.org//'))).toBe(true);
  });

  it('sends the token as a bearer header on every request but the public probe', async () => {
    const fetchMock = privateInstance(page([{ id: 1, documentId: 'doc-1' }]));
    vi.stubGlobal('fetch', fetchMock);

    await inspectStrapiInstance({ baseUrl: 'https://cms.partner.org', token: 'tok-abc', collections: ['events'] });

    const authenticated = fetchMock.mock.calls.filter(call => call[1] !== undefined);
    const anonymous = fetchMock.mock.calls.filter(call => call[1] === undefined);

    expect(authenticated).toHaveLength(2);

    for (const call of authenticated) {
      expect((call[1] as RequestInit).headers).toEqual({ authorization: 'Bearer tok-abc' });
    }

    // Exactly one deliberate credential-free probe, to tell public from private.
    expect(anonymous).toHaveLength(1);
  });

  it('says the token could not be confirmed when the collection is public', async () => {
    // Everything answers 200, with or without a credential — the shape of a
    // Strapi whose public role can read the collection.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      String(url).includes('content-type-builder')
        ? res({ error: 'Forbidden' }, false, 403)
        : res(page([{ id: 1, documentId: 'doc-1' }]))
    )));

    const inspection = await inspectStrapiInstance({
      baseUrl: 'https://cms.partner.org',
      token: 'tok',
      collections: ['events'],
    });

    expect(inspection.checks[0]!.status).toBe('ok');
    expect(inspection.checks[0]!.publiclyReadable).toBe(true);
    expect(inspection.authorized).toBe(false);
    expect(inspection.error).toContain('could not be confirmed');
  });
});
