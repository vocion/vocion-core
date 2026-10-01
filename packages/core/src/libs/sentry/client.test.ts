import type { SentryFetch } from './client';
import { describe, expect, it } from 'vitest';
import { countErrors, eventOf, latestEvent, listIssues, normalizeSentryHost, projectIssuesUrl, readIssue, sentryCredentialsFrom } from './client';

const C = { token: 'sntrys_fixture_token_0001', org: 'northwind', host: 'https://us.sentry.io' };

/**
 * A fetch that answers from a table keyed by path, and records each URL.
 * @param table - Path → body (or a status).
 * @param seen - The URLs asked for.
 */
function fake(table: Record<string, unknown>, seen: string[] = []): SentryFetch {
  return async (url) => {
    seen.push(url);
    const path = new URL(url).pathname.replace(/^\/api\/0/, '');
    const hit = table[path];
    if (typeof hit === 'number') {
      return { ok: false, status: hit, json: async () => ({}), text: async () => JSON.stringify({ detail: 'refused' }) };
    }
    return { ok: hit !== undefined, status: hit === undefined ? 404 : 200, json: async () => hit, text: async () => '', headers: { get: (n: string) => (n === 'x-hits' ? '7' : null) } };
  };
}

// Shaped like the real thing (2026-10-01), fictional names.
const ISSUE = {
  id: '7700000001',
  shortId: 'NW-API-3',
  title: 'EngineInitError: ',
  culprit: 'GET /v1/orgs',
  permalink: 'https://northwind.sentry.io/issues/7700000001/',
  level: 'error',
  status: 'unresolved',
  project: { slug: 'northwind-api' },
  count: '184',
  userCount: 0,
  firstSeen: '2026-10-01T14:43:54Z',
  lastSeen: '2026-10-01T15:47:15Z',
};
const EVENT = {
  eventID: 'e0000000000000000000000000000001',
  dateCreated: '2026-10-01T15:47:15.772000Z',
  release: { version: 'aaaaaaa1111111111111111111111111111111aa' },
  tags: [
    { key: 'environment', value: 'production' },
    { key: 'release', value: 'aaaaaaa1111111111111111111111111111111aa' },
    { key: 'status_code', value: '500' },
    { key: 'url', value: 'https://api.northwind.example/v1/documents' },
  ],
  entries: [
    { type: 'exception', data: { values: [{ type: 'EngineInitError', value: '\nInvalid `db.user.find()` invocation:\nthe query engine for runtime "linux-arm64" was not found', stacktrace: { frames: [
      { filename: '/app/node_modules/orm/runtime/library.js', lineNo: 121, colNo: 7568, function: 'handleRequestError', inApp: false },
      { filename: '/app/packages/core/dist/auth/plugin.js', lineNo: 210, colNo: 4, function: 'Object.?', inApp: true },
    ] } }] } },
    { type: 'breadcrumbs', data: { values: [{ timestamp: '2026-10-01T15:47:15.770Z', category: 'console', level: 'info', message: 'orm:error engine not found' }] } },
    { type: 'request', data: { method: 'GET', url: 'https://api.northwind.example/v1/documents' } },
  ],
};

describe('the Sentry credential', () => {
  it('needs a token and an organization slug, and defaults the host to the US region', () => {
    expect(sentryCredentialsFrom({ token: 'sntrys_x', org: 'northwind' })).toEqual({ ok: true, credentials: { token: 'sntrys_x', org: 'northwind', host: 'https://us.sentry.io' } });
    expect(sentryCredentialsFrom({ org: 'northwind' }).ok).toBe(false);
    expect(sentryCredentialsFrom({ token: 'x', org: 'north wind' }).ok).toBe(false);
    expect(normalizeSentryHost('https://de.sentry.io/api/0/')).toBe('https://de.sentry.io');
    expect(normalizeSentryHost('de.sentry.io')).toBeNull();
  });
});

describe('reading issues', () => {
  it('ranks by events in the period, scoped by project, release and environment, with the short id and link', async () => {
    const seen: string[] = [];
    const res = await listIssues(C, { project: 'northwind-api', environment: 'production', release: 'abc1234', statsPeriod: '1h', limit: 5 }, fake({ '/organizations/northwind/issues/': [ISSUE] }, seen));

    expect(res).toMatchObject({ ok: true, hits: 7, data: [{ shortId: 'NW-API-3', events: 184, url: ISSUE.permalink, culprit: 'GET /v1/orgs', project: 'northwind-api' }] });

    const u = new URL(seen[0]!);

    expect(u.searchParams.get('query')).toBe('is:unresolved project:northwind-api release:abc1234');
    expect(u.searchParams.get('environment')).toBe('production');
    expect(u.searchParams.get('statsPeriod')).toBe('1h');
    expect(u.searchParams.get('sort')).toBe('freq');
  });

  it('asks for what a release introduced with firstRelease', async () => {
    const seen: string[] = [];
    await listIssues(C, { firstRelease: 'abc1234' }, fake({ '/organizations/northwind/issues/': [] }, seen));

    expect(new URL(seen[0]!).searchParams.get('query')).toBe('is:unresolved firstRelease:abc1234');
  });

  it('reads one issue by its short id, with the release it first appeared in', async () => {
    const res = await readIssue(C, 'NW-API-3', fake({ '/organizations/northwind/issues/NW-API-3/': { ...ISSUE, firstRelease: { version: 'aaaaaaa1', dateCreated: '2026-10-01T14:39:14Z' }, lastRelease: { version: 'bbbbbbb2' } } }));

    expect(res).toMatchObject({ ok: true, data: { firstRelease: 'aaaaaaa1', firstReleaseAt: '2026-10-01T14:39:14Z', lastRelease: 'bbbbbbb2' } });
  });

  it('says what to do when the token is refused, and never throws', async () => {
    const res = await listIssues(C, {}, fake({ '/organizations/northwind/issues/': 403 }));

    expect(res).toMatchObject({ ok: false, error: 'sentry_unauthorized', status: 403 });
    expect((res as { message: string }).message).toMatch(/event:read/);

    const down = await listIssues(C, {}, async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });

    expect(down).toMatchObject({ ok: false, error: 'sentry_error', status: null });
  });
});

describe('the latest event', () => {
  it('gives the exception, the frames with file and line, the request with its status, breadcrumbs and release', async () => {
    const e = eventOf(EVENT);

    expect(e.release).toBe('aaaaaaa1111111111111111111111111111111aa');
    expect(e.environment).toBe('production');
    expect(e.request).toEqual({ method: 'GET', url: 'https://api.northwind.example/v1/documents', status: 500 });
    expect(e.exceptions[0]!.type).toBe('EngineInitError');
    expect(e.exceptions[0]!.frames.find(f => f.inApp)).toEqual({ file: '/app/packages/core/dist/auth/plugin.js', line: 210, column: 4, function: 'Object.?', module: null, inApp: true });
    expect(e.breadcrumbs[0]!.message).toBe('orm:error engine not found');

    const seen: string[] = [];
    await latestEvent(C, '7700000001', 'production', fake({ '/organizations/northwind/issues/7700000001/events/latest/': EVENT }, seen));

    expect(new URL(seen[0]!).searchParams.get('environment')).toBe('production');
  });
});

describe('counting a window', () => {
  it('counts error events per issue between two instants', async () => {
    const seen: string[] = [];
    const res = await countErrors(C, { project: 'northwind-api', environment: 'production', start: new Date('2026-10-01T15:00:00Z'), end: new Date('2026-10-01T15:10:00Z'), byRelease: true }, fake({ '/organizations/northwind/events/': { data: [{ 'issue.id': 7700000001, 'issue': 'NW-API-3', 'title': 'EngineInitError: ', 'count()': 41, 'min(timestamp)': '2026-10-01T15:00:35+00:00', 'max(timestamp)': '2026-10-01T15:09:57+00:00', 'release': 'aaaaaaa1' }] } }, seen));

    expect(res).toEqual({ ok: true, data: [{ issueId: '7700000001', shortId: 'NW-API-3', title: 'EngineInitError:', events: 41, firstAt: '2026-10-01T15:00:35+00:00', lastAt: '2026-10-01T15:09:57+00:00', release: 'aaaaaaa1' }] });

    const u = new URL(seen[0]!);

    expect(u.searchParams.getAll('field')).toContain('release');
    expect(u.searchParams.get('query')).toBe('event.type:error project:northwind-api');
    expect(u.searchParams.get('start')).toBe('2026-10-01T15:00:00');
  });

  it('links a project\'s open issues on the organization\'s own address', () => {
    expect(projectIssuesUrl({ org: 'northwind', project: 'northwind-api', environment: 'production' })).toBe('https://northwind.sentry.io/issues/?query=is%3Aunresolved+project%3Anorthwind-api&statsPeriod=24h&environment=production');
  });
});
