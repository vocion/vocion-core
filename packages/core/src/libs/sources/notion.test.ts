import type { SourceContext } from '@/libs/sources/types';
/**
 * Notion connector against a mocked `fetch` — verifies it yields page +
 * database IngestDocs, renders properties and block text, paginates
 * `next_cursor`, stops at the incremental watermark, skips archived objects,
 * honors Retry-After on 429, and fails actionably without a token. No network
 * and no credentials: every request is stubbed.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockToText, notionConnector, pageTitle, propertyToText, richTextToPlain } from '@/libs/sources/notion';
import { getConnector, listConnectors } from '@/libs/sources/registry';

function res(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function rt(text: string) {
  return [{ plain_text: text }];
}

function page(id: string, over: Record<string, unknown> = {}) {
  return {
    object: 'page',
    id,
    url: `https://www.notion.so/${id}`,
    created_time: '2026-07-01T10:00:00.000Z',
    last_edited_time: '2026-07-30T10:00:00.000Z',
    parent: { type: 'database_id', database_id: 'db-1' },
    properties: {
      Name: { type: 'title', title: rt(`Onboarding checklist ${id}`) },
      Owner: { type: 'select', select: { name: 'Support' } },
      Done: { type: 'checkbox', checkbox: false },
    },
    ...over,
  };
}

const DATABASE = {
  object: 'database',
  id: 'db-1',
  url: 'https://www.notion.so/db-1',
  last_edited_time: '2026-07-29T10:00:00.000Z',
  title: rt('Runbooks'),
  description: rt('Operational runbooks for the support team'),
};

/** An empty block-children page — pages fetch their body after search. */
const NO_BLOCKS = { results: [], has_more: false, next_cursor: null };

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return {
    sourceId: 1,
    orgId: 'org_1',
    config: {},
    credentials: { token: 'secret_tok' },
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

describe('notionConnector', () => {
  it('is registered in the connector registry under the `notion` slug', () => {
    expect(getConnector('notion')).toBe(notionConnector);
    expect(listConnectors().map(c => c.slug)).toContain('notion');
    expect(notionConnector.authKind).toBe('apikey');
  });

  it('yields a page doc with title, properties and block text', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ results: [page('p1')], has_more: false, next_cursor: null }))
      .mockResolvedValueOnce(res({
        results: [
          { id: 'b1', type: 'heading_2', heading_2: { rich_text: rt('Day one') } },
          { id: 'b2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('Read the runbook') } },
          { id: 'b3', type: 'to_do', to_do: { rich_text: rt('Grant inbox access'), checked: true } },
        ],
        has_more: false,
        next_cursor: null,
      }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(notionConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('notion:p1');
    expect(docs[0]!.title).toBe('Onboarding checklist p1');
    expect(docs[0]!.uri).toBe('https://www.notion.so/p1');
    expect(docs[0]!.content).toContain('Owner: Support');
    expect(docs[0]!.content).toContain('Done: no');
    expect(docs[0]!.content).toContain('## Day one');
    expect(docs[0]!.content).toContain('- Read the runbook');
    expect(docs[0]!.content).toContain('[x] Grant inbox access');
    expect(docs[0]!.metadata).toMatchObject({
      type: 'page',
      notionId: 'p1',
      parentType: 'database_id',
      parentId: 'db-1',
      contentTruncated: false,
    });
    expect(docs[0]!.lastModifiedAt).toEqual(new Date('2026-07-30T10:00:00.000Z'));
  });

  it('yields a database doc from its title + description, and skips its rows', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res({ results: [DATABASE], has_more: false, next_cursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(notionConnector.sync(ctx()));

    expect(docs[0]!.externalId).toBe('notion-database:db-1');
    expect(docs[0]!.title).toBe('Runbooks');
    expect(docs[0]!.content).toContain('Operational runbooks for the support team');
    // A database is one request: no block children are read for it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts the post-2025-09-03 `data_source` object as a database', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      res({ results: [{ ...DATABASE, object: 'data_source', id: 'ds-1' }], has_more: false, next_cursor: null })));
    const docs = await collect(notionConnector.sync(ctx()));

    expect(docs[0]!.externalId).toBe('notion-database:ds-1');
    expect(docs[0]!.metadata).toMatchObject({ notionObject: 'data_source' });
  });

  it('sends no object filter and pins the configured Notion-Version', async () => {
    const fetchMock = vi.fn(async () => res({ results: [], has_more: false, next_cursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    await collect(notionConnector.sync(ctx({ config: { notionVersion: '2025-09-03', query: 'runbook' } })));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(String(url)).toBe('https://api.notion.com/v1/search');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['notion-version']).toBe('2025-09-03');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret_tok');

    const body = JSON.parse(String(init.body));

    expect(body.filter).toBeUndefined();
    expect(body.query).toBe('runbook');
    expect(body.sort).toEqual({ timestamp: 'last_edited_time', direction: 'ascending' });
  });

  it('follows next_cursor across search pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ results: [DATABASE], has_more: true, next_cursor: 'cur-2' }))
      .mockResolvedValueOnce(res({ results: [{ ...DATABASE, id: 'db-2' }], has_more: false, next_cursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(notionConnector.sync(ctx()));

    expect(docs.map(d => d.externalId)).toEqual(['notion-database:db-1', 'notion-database:db-2']);

    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));

    expect(secondBody.start_cursor).toBe('cur-2');
  });

  it('sorts newest-first and stops at the watermark when incremental', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res({
      results: [
        { ...DATABASE, id: 'fresh', last_edited_time: '2026-08-02T00:00:00.000Z' },
        { ...DATABASE, id: 'stale', last_edited_time: '2026-07-01T00:00:00.000Z' },
        { ...DATABASE, id: 'staler', last_edited_time: '2026-06-01T00:00:00.000Z' },
      ],
      has_more: true,
      next_cursor: 'cur-2',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(notionConnector.sync(ctx({ since: new Date('2026-08-01T00:00:00.000Z') })));

    expect(docs.map(d => d.externalId)).toEqual(['notion-database:fresh']);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));

    expect(body.sort.direction).toBe('descending');
    // Stopped at the watermark, so `has_more` was not followed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips archived and trashed objects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({
      results: [
        { ...DATABASE, id: 'gone', archived: true },
        { ...DATABASE, id: 'trashed', in_trash: true },
      ],
      has_more: false,
      next_cursor: null,
    })));
    const docs = await collect(notionConnector.sync(ctx()));

    expect(docs).toEqual([]);
  });

  it('honors includePages / includeDatabases', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/search')
        ? res({ results: [page('p1'), DATABASE], has_more: false, next_cursor: null })
        : res(NO_BLOCKS)));
    const pagesOnly = await collect(notionConnector.sync(ctx({ config: { includeDatabases: false } })));

    expect(pagesOnly.map(d => d.externalId)).toEqual(['notion:p1']);

    const dbsOnly = await collect(notionConnector.sync(ctx({ config: { includePages: false } })));

    expect(dbsOnly.map(d => d.externalId)).toEqual(['notion-database:db-1']);
  });

  it('recurses nested blocks and paginates block children', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ results: [page('p1')], has_more: false, next_cursor: null }))
      .mockResolvedValueOnce(res({
        results: [{ id: 'toggle', type: 'toggle', toggle: { rich_text: rt('Escalation') }, has_children: true }],
        has_more: true,
        next_cursor: 'blk-2',
      }))
      .mockResolvedValueOnce(res({
        results: [{ id: 'nested', type: 'paragraph', paragraph: { rich_text: rt('Page the on-call') } }],
        has_more: false,
        next_cursor: null,
      }))
      .mockResolvedValueOnce(res({
        results: [{ id: 'b2', type: 'paragraph', paragraph: { rich_text: rt('Second block page') } }],
        has_more: false,
        next_cursor: null,
      }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(notionConnector.sync(ctx({ config: { includeProperties: false } })));

    expect(docs[0]!.content).toContain('Escalation');
    expect(docs[0]!.content).toContain('Page the on-call');
    expect(docs[0]!.content).toContain('Second block page');
    // Properties suppressed, so only the title and block text are present.
    expect(docs[0]!.content).not.toContain('Owner: Support');
    // Call order: search, the page's first block page, the toggle's children
    // (recursed inline), then the page's second block page.

    const blockUrls = fetchMock.mock.calls.slice(1).map(c => String((c as unknown as [string])[0]));

    expect(blockUrls[0]).toContain('/blocks/p1/children');
    expect(blockUrls[1]).toContain('/blocks/toggle/children');
    expect(blockUrls[2]).toContain('start_cursor=blk-2');
  });

  it('honors Retry-After on 429 and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ message: 'rate limited' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(res({ results: [DATABASE], has_more: false, next_cursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(notionConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails actionably on a missing token, a revoked token, and an unshared page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, 200)));

    await expect(collect(notionConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/credentials\.token/);

    vi.stubGlobal('fetch', vi.fn(async () => res({ message: 'unauthorized' }, 401)));

    await expect(collect(notionConnector.sync(ctx()))).rejects.toThrow(/revoked/);

    vi.stubGlobal('fetch', vi.fn(async () => res({ message: 'restricted' }, 403)));

    await expect(collect(notionConnector.sync(ctx()))).rejects.toThrow(/share the pages/);

    vi.stubGlobal('fetch', vi.fn(async () => res({ message: 'boom' }, 500)));

    await expect(collect(notionConnector.sync(ctx()))).rejects.toThrow(/Notion request failed: 500/);
  });

  it('accepts credentials.apiToken as an alias for credentials.token', async () => {
    const fetchMock = vi.fn(async () => res({ results: [], has_more: false, next_cursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    await collect(notionConnector.sync(ctx({ credentials: { apiToken: 'alias' } })));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect((init.headers as Record<string, string>).authorization).toBe('Bearer alias');
  });
});

describe('notion helpers', () => {
  it('richTextToPlain concatenates and trims', () => {
    expect(richTextToPlain([{ plain_text: ' Hello ' }, { plain_text: 'world ' }])).toBe('Hello world');
    expect(richTextToPlain(undefined)).toBe('');
  });

  it('pageTitle reads whichever property has type title, whatever it is named', () => {
    expect(pageTitle({ object: 'page', id: 'x', properties: { Company: { type: 'title', title: rt('Acme') } } })).toBe('Acme');
    expect(pageTitle({ object: 'page', id: 'x', properties: {} })).toBe('Untitled');
  });

  it('propertyToText renders the simple property types and drops the rest', () => {
    expect(propertyToText({ type: 'multi_select', multi_select: [{ name: 'a' }, { name: 'b' }] })).toBe('a, b');
    expect(propertyToText({ type: 'number', number: 0 })).toBe('0');
    expect(propertyToText({ type: 'date', date: { start: '2026-07-01', end: '2026-07-02' } })).toBe('2026-07-01 → 2026-07-02');
    expect(propertyToText({ type: 'people', people: [{ name: 'Mara Okafor' }] })).toBe('Mara Okafor');
    // Rollups and formulas are deliberately unrendered rather than stringified.
    expect(propertyToText({ type: 'rollup' })).toBe('');
    expect(propertyToText(undefined)).toBe('');
  });

  it('blockToText shapes code, child pages and unknown rich-text blocks', () => {
    expect(blockToText({ id: 'c', type: 'code', code: { rich_text: rt('npm test'), language: 'bash' } }))
      .toBe('```bash\nnpm test\n```');
    expect(blockToText({ id: 'p', type: 'child_page', child_page: { title: 'Sub page' } })).toBe('Sub page');
    expect(blockToText({ id: 'q', type: 'quote', quote: { rich_text: rt('Ship it') } })).toBe('Ship it');
    expect(blockToText({ id: 'd', type: 'divider', divider: {} })).toBe('');
    expect(blockToText({ id: 'u', type: 'unsupported' })).toBe('');
  });
});
