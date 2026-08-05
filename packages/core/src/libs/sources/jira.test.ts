import type { SourceContext } from '@/libs/sources/types';
/**
 * Jira connector against a mocked `fetch` — verifies it yields project +
 * issue IngestDocs, paginates `nextPageToken`, builds incremental vs full
 * JQL, keys documents by the immutable numeric id, honors Retry-After on
 * 429, and fails actionably on bad credentials.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adfToText, buildJql, jiraConnector } from '@/libs/sources/jira';

function res(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const PROJECT_PAGE = {
  values: [
    { id: '10000', key: 'REV', name: 'Revenue', description: 'Revenue work' },
    { id: '10001', key: 'SKUNK', name: 'Skunkworks' },
  ],
  isLast: true,
  startAt: 0,
  maxResults: 50,
};

function issue(id: string, key: string, over: Record<string, unknown> = {}) {
  return {
    id,
    key,
    fields: {
      summary: `Fix thing ${id}`,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Bug' },
      assignee: { displayName: 'Mara Okafor', emailAddress: 'mara@acme.com' },
      created: '2026-07-01T10:00:00.000+0000',
      updated: '2026-07-30T10:00:00.000+0000',
      ...over,
    },
  };
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return {
    sourceId: 1,
    orgId: 'org_1',
    config: { baseUrl: 'https://acme.atlassian.net', projectKeys: ['REV'] },
    credentials: { email: 'admin@acme.com', apiToken: 'tok-123' },
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

describe('jiraConnector', () => {
  it('yields configured projects then issues, keyed by immutable numeric id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res({ issues: [issue('10432', 'REV-123')], isLast: true }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(jiraConnector.sync(ctx()));

    // SKUNK is not in projectKeys — opt-in means it never appears.
    expect(docs.map(d => d.externalId)).toEqual(['jira-project:10000', 'jira:10432']);
    expect(docs[1]!.title).toBe('[REV-123] Fix thing 10432');
    expect(docs[1]!.content).toContain('REV-123 — Fix thing 10432');
    expect(docs[1]!.content).toContain('Status: In Progress');
    expect(docs[1]!.uri).toBe('https://acme.atlassian.net/browse/REV-123');
    expect(docs[1]!.metadata).toMatchObject({
      key: 'REV-123',
      projectKey: 'REV',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      completed: false,
      assignee: 'mara@acme.com',
    });
  });

  it('marks done-category issues completed, unless the status is listed in notDoneStatuses', async () => {
    const done = { name: 'Shipped', statusCategory: { key: 'done' } };
    const wontDo = { name: `Won't Do`, statusCategory: { key: 'done' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res({
        issues: [issue('1', 'REV-1', { status: done }), issue('2', 'REV-2', { status: wontDo })],
        isLast: true,
      }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(jiraConnector.sync(ctx({
      config: { baseUrl: 'https://acme.atlassian.net', projectKeys: ['REV'], notDoneStatuses: [`Won't Do`] },
    })));

    expect(docs[1]!.metadata!.completed).toBe(true);
    expect(docs[2]!.metadata!.completed).toBe(false);
  });

  it('follows nextPageToken across search pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res({ issues: [issue('1', 'REV-1')], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(res({ issues: [issue('2', 'REV-2')], isLast: true }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(jiraConnector.sync(ctx()));

    expect(docs.filter(d => (d.metadata as { type?: string }).type === 'issue')).toHaveLength(2);
    const secondSearch = JSON.parse(String((fetchMock.mock.calls[2] as [string, RequestInit])[1].body));
    expect(secondSearch.nextPageToken).toBe('p2');
  });

  it('searches via POST /rest/api/3/search/jql with an explicit field list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res({ issues: [], isLast: true }));
    vi.stubGlobal('fetch', fetchMock);
    await collect(jiraConnector.sync(ctx()));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(String(url)).toContain('/rest/api/3/search/jql');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.fields).toContain('summary');
    expect(body.fields).toContain('status');
    expect(body.fields).toContain('description');
  });

  it('honors Retry-After on 429 and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({}, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res({ issues: [], isLast: true }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(jiraConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails with a reconnect message on 401 instead of retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({}, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(jiraConnector.sync(ctx()))).rejects.toThrow(/reconnect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to run without email + apiToken credentials', async () => {
    await expect(collect(jiraConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/apiToken/i);
  });
});

describe('buildJql', () => {
  it('incremental: relative-minutes window with overlap (timezone-proof)', () => {
    const now = new Date('2026-07-31T12:00:00.000Z');
    const since = new Date('2026-07-31T11:00:00.000Z');
    const jql = buildJql({ projectKeys: ['REV', 'OPS'], since, doneWindowDays: 90, notDoneStatuses: [], now });

    // 60 elapsed minutes + 5 overlap.
    expect(jql).toBe('project in ("REV", "OPS") AND updated >= "-65m" ORDER BY updated ASC');
  });

  it('full: non-done plus done-within-window', () => {
    const jql = buildJql({ projectKeys: ['REV'], since: null, doneWindowDays: 90, notDoneStatuses: [] });

    expect(jql).toBe('project in ("REV") AND (statusCategory != Done OR updated >= "-90d") ORDER BY updated ASC');
  });

  it('full: notDoneStatuses stay in scope regardless of age', () => {
    const jql = buildJql({ projectKeys: ['REV'], since: null, doneWindowDays: 30, notDoneStatuses: [`Won't Do`] });

    expect(jql).toContain(`OR status in ("Won't Do")`);
  });

  it('escapes quotes in project keys', () => {
    const jql = buildJql({ projectKeys: ['A"B'], since: null, doneWindowDays: 90, notDoneStatuses: [] });

    expect(jql).toContain(String.raw`"A\"B"`);
  });
});

describe('adfToText', () => {
  it('flattens paragraphs and marks to plain text', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Login fails ' }, { type: 'text', text: 'intermittently.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Steps: click login.' }] },
      ],
    };

    expect(adfToText(adf)).toBe('Login fails intermittently.\nSteps: click login.');
  });

  it('returns empty string for null / missing descriptions', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText(undefined)).toBe('');
  });
});
