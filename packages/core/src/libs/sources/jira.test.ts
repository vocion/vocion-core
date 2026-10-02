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

// The connector persists a rotated Atlassian refresh token through the
// credential service; the tests watch the call, never the database.
vi.mock('@/services/SourceCredentialService', () => ({
  updateCredentialValuesForConnector: vi.fn(async () => true),
  getCredentialsForConnector: vi.fn(async () => undefined),
  resolveApiTokenIdForSource: vi.fn(async () => null),
}));
const { getCredentialsForConnector, updateCredentialValuesForConnector } = await import('@/services/SourceCredentialService');

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.mocked(updateCredentialValuesForConnector).mockClear();
  vi.mocked(getCredentialsForConnector).mockReset().mockResolvedValue(undefined);
});

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

  it('refuses to run without email + apiToken credentials, naming the OAuth alternative', async () => {
    await expect(collect(jiraConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/apiToken/i);
  });
});

describe('jiraConnector with an Atlassian grant', () => {
  const ACME = { id: 'cloud-acme', url: 'https://acme.atlassian.net', name: 'Acme' };
  const NORTHWIND = { id: 'cloud-nw', url: 'https://northwind.atlassian.net', name: 'Northwind' };
  const SEARCH_PAGE = { issues: [issue('1', 'REV-1')], isLast: true };

  function grant(over: Record<string, unknown> = {}) {
    return {
      accessToken: 'at-old',
      refreshToken: 'rt-old',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scope: 'read:jira-work read:jira-user offline_access',
      sites: [ACME, NORTHWIND],
      ...over,
    };
  }

  function grantCtx(over: Partial<SourceContext> = {}): SourceContext {
    vi.stubEnv('ATLASSIAN_CLIENT_ID', 'cid');
    vi.stubEnv('ATLASSIAN_CLIENT_SECRET', 'csecret');
    return ctx({ credentials: grant(), ...over });
  }

  it('calls api.atlassian.com for the site whose URL is the baseUrl, as Bearer, and links documents to the site', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(PROJECT_PAGE)).mockResolvedValueOnce(res(SEARCH_PAGE));
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(jiraConnector.sync(grantCtx()));

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.atlassian.com/ex/jira/cloud-acme/rest/api/3/project/search?startAt=0&maxResults=50');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer at-old' });
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.atlassian.com/ex/jira/cloud-acme/rest/api/3/search/jql');
    expect(docs.find(d => d.externalId === 'jira:1')?.uri).toBe('https://acme.atlassian.net/browse/REV-1');
    expect(updateCredentialValuesForConnector).not.toHaveBeenCalled();
  });

  it('the baseUrl decides the site even when the grant pins a different cloudId', async () => {
    // A single-site consent pins cloudId; a source pointed at another site must
    // not quietly sync the pinned one.
    vi.stubGlobal('fetch', vi.fn());
    const it_ = jiraConnector.sync(grantCtx({ credentials: grant({ cloudId: 'cloud-nw', sites: [NORTHWIND] }) }));

    await expect(collect(it_)).rejects.toThrow(/does not reach https:\/\/acme\.atlassian\.net\. It reaches: https:\/\/northwind\.atlassian\.net/);
  });

  it('uses the pinned cloudId when it is the site the baseUrl names', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(PROJECT_PAGE)).mockResolvedValueOnce(res(SEARCH_PAGE));
    vi.stubGlobal('fetch', fetchMock);

    await collect(jiraConnector.sync(grantCtx({ credentials: grant({ cloudId: 'cloud-nw', sites: [NORTHWIND] }), config: { baseUrl: 'https://northwind.atlassian.net', projectKeys: ['REV'] } })));

    expect(fetchMock.mock.calls[0]![0]).toContain('/ex/jira/cloud-nw/');
  });

  it('fails at sync when the grant reaches no site at all', async () => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(collect(jiraConnector.sync(grantCtx({ credentials: grant({ sites: [] }) })))).rejects.toThrow(/It reaches: none/);
  });

  it('fails naming the reachable sites when none matches the baseUrl', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const it_ = jiraConnector.sync(grantCtx({ config: { baseUrl: 'https://elsewhere.atlassian.net/', projectKeys: ['REV'] } }));

    await expect(collect(it_)).rejects.toThrow(/does not reach https:\/\/elsewhere\.atlassian\.net\. It reaches: https:\/\/acme\.atlassian\.net, https:\/\/northwind\.atlassian\.net/);
  });

  it('refreshes an expiring token before the first request and persists the rotated refresh token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }))
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res(SEARCH_PAGE));
    vi.stubGlobal('fetch', fetchMock);

    await collect(jiraConnector.sync(grantCtx({ credentials: grant({ expiresAt: new Date(Date.now() - 1000).toISOString() }) })));

    expect(fetchMock.mock.calls[0]![0]).toBe('https://auth.atlassian.com/oauth/token');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'cid',
      client_secret: 'csecret',
      refresh_token: 'rt-old',
    });
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer at-new' });
    expect(updateCredentialValuesForConnector).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateCredentialValuesForConnector).mock.calls[0]![0]).toMatchObject({
      orgId: 'org_1',
      connectorSlug: 'jira',
      expectedRefreshToken: 'rt-old',
      raw: expect.objectContaining({ accessToken: 'at-new', refreshToken: 'rt-new', cloudId: 'cloud-acme' }),
    });
  });

  it('retries once after a 401 with a refreshed token, and gives up on a second 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ errorMessages: ['Unauthorized'] }, 401))
      .mockResolvedValueOnce(res({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }))
      .mockResolvedValueOnce(res({ errorMessages: ['Unauthorized'] }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(jiraConnector.sync(grantCtx()))).rejects.toThrow(/rejected the credentials \(401\)\. The Atlassian grant may have been revoked/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(updateCredentialValuesForConnector).toHaveBeenCalledTimes(1);
  });

  it('warns, and keeps syncing, when the rotated token had no row to land in', async () => {
    vi.mocked(updateCredentialValuesForConnector).mockResolvedValueOnce(false);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(res({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }))
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res(SEARCH_PAGE)));
    const onProgress = vi.fn();

    const docs = await collect(jiraConnector.sync(grantCtx({ onProgress, credentials: grant({ expiresAt: new Date().toISOString() }) })));

    expect(docs.length).toBeGreaterThan(0);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: expect.stringContaining('rotated the refresh token') }));
  });

  it('refreshes from the token stored NOW, not the one this run loaded, when another sync rotated it first', async () => {
    vi.mocked(getCredentialsForConnector).mockResolvedValue(grant({ refreshToken: 'rt-rotated-by-other' }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }))
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res(SEARCH_PAGE));
    vi.stubGlobal('fetch', fetchMock);

    await collect(jiraConnector.sync(grantCtx({ credentials: grant({ expiresAt: new Date().toISOString() }) })));

    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).refresh_token).toBe('rt-rotated-by-other');
    expect(vi.mocked(updateCredentialValuesForConnector).mock.calls[0]![0]).toMatchObject({ expectedRefreshToken: 'rt-rotated-by-other' });
  });

  it('adopts the winner when the compare-and-swap loses to a concurrent rotation or a fresh consent', async () => {
    vi.mocked(updateCredentialValuesForConnector).mockResolvedValueOnce(false);
    vi.mocked(getCredentialsForConnector)
      .mockResolvedValueOnce(grant())
      .mockResolvedValueOnce(grant({ accessToken: 'at-winner', refreshToken: 'rt-winner' }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ access_token: 'at-mine', refresh_token: 'rt-mine', expires_in: 3600 }))
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res(SEARCH_PAGE));
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();

    await collect(jiraConnector.sync(grantCtx({ onProgress, credentials: grant({ expiresAt: new Date().toISOString() }) })));

    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer at-winner' });
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });

  it('keeps the old refresh token when a refresh reply carries none', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(res({ access_token: 'at-new', expires_in: 3600 }))
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res(SEARCH_PAGE)));

    await collect(jiraConnector.sync(grantCtx({ credentials: grant({ expiresAt: new Date().toISOString() }) })));

    expect(vi.mocked(updateCredentialValuesForConnector).mock.calls[0]![0]).toMatchObject({ raw: expect.objectContaining({ accessToken: 'at-new', refreshToken: 'rt-old' }) });
  });

  it('refreshes at most once per run: a second 401 after the refresh is final', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }))
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res({ errorMessages: ['Unauthorized'] }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(jiraConnector.sync(grantCtx({ credentials: grant({ expiresAt: new Date().toISOString() }) })))).rejects.toThrow(/rejected the credentials \(401\)/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(updateCredentialValuesForConnector).toHaveBeenCalledTimes(1);
  });

  it('a refresh Atlassian refuses fails the run with the reconnect hint appended', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res({ error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' }, 403)));

    await expect(collect(jiraConnector.sync(grantCtx({ credentials: grant({ expiresAt: new Date().toISOString() }) })))).rejects.toThrow(/Unknown or invalid refresh token\. The Atlassian grant may have been revoked/);
  });

  it('keeps syncing on the fresh token when persisting it throws, and reports it', async () => {
    vi.mocked(updateCredentialValuesForConnector).mockRejectedValueOnce(new Error('vault: DEK and data have diverged'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(res({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }))
      .mockResolvedValueOnce(res(PROJECT_PAGE))
      .mockResolvedValueOnce(res(SEARCH_PAGE)));
    const onProgress = vi.fn();

    const docs = await collect(jiraConnector.sync(grantCtx({ onProgress, credentials: grant({ expiresAt: new Date().toISOString() }) })));

    expect(docs.length).toBeGreaterThan(0);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: expect.stringContaining('rotated the refresh token') }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('diverged');

    warn.mockRestore();
  });

  it('Test connection reports the site and each project key, and never refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(PROJECT_PAGE));
    vi.stubGlobal('fetch', fetchMock);

    const out = await jiraConnector.inspect!({ config: { baseUrl: 'https://acme.atlassian.net', projectKeys: ['REV', 'NOPE'] }, credentials: grant(), options: {} });

    expect(out).toMatchObject({
      reachable: true,
      authorized: true,
      note: 'Site https://acme.atlassian.net.',
      checks: [
        { key: 'project:REV', ok: true, detail: 'Revenue' },
        { key: 'project:NOPE', ok: false },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Test connection with an expired grant says a sync must refresh it, rather than rotating a token it cannot save', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await jiraConnector.inspect!({ config: { baseUrl: 'https://acme.atlassian.net', projectKeys: ['REV'] }, credentials: grant({ expiresAt: new Date(Date.now() - 1000).toISOString() }), options: {} }) as { authorized: boolean; error: string | null };

    expect(out.authorized).toBe(false);
    expect(out.error).toMatch(/Run Sync now/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateCredentialValuesForConnector).not.toHaveBeenCalled();
  });

  it('Test connection with a pasted token still works', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res(PROJECT_PAGE)));

    const out = await jiraConnector.inspect!({ config: { baseUrl: 'https://acme.atlassian.net/', projectKeys: ['REV'] }, credentials: { email: 'a@acme.example', apiToken: 't' }, options: {} }) as { authorized: boolean };

    expect(out.authorized).toBe(true);
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
