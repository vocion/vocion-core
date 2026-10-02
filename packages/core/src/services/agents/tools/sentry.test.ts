import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const access = vi.fn();
vi.mock('@/services/sentry/access', () => ({ sentryFor: (...a: unknown[]) => access(...a) }));

const { sentryTools } = await import('./sentry');

function ctx(grantTools: string[]): RuntimeContext {
  return { orgId: 'org_1', harnessConfig: { grantTools } } as unknown as RuntimeContext;
}

const C = { token: 'sntrys_fixture_token_0001', org: 'northwind', host: 'https://us.sentry.io' };

/**
 * Answer fetches from a table keyed by path.
 * @param table - Path → body.
 * @param seen - URLs asked for.
 */
function stubFetch(table: Record<string, unknown>, seen: string[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    seen.push(url);
    const body = table[new URL(url).pathname.replace(/^\/api\/0/, '')];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body, text: async () => '', headers: { get: () => null } };
  }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  access.mockResolvedValue({ ok: true, credentials: C });
});

describe('the Sentry tools', () => {
  it('are granted by name, and absent otherwise', () => {
    expect(sentryTools(ctx([])).map(t => t.name)).toEqual([]);
    expect(sentryTools(ctx(['sentry_issues', 'sentry_issue'])).map(t => t.name)).toEqual(['sentry_issues', 'sentry_issue']);
  });

  it('count a window around the time a person named, in one project and environment', async () => {
    const seen: string[] = [];
    stubFetch({ '/organizations/northwind/events/': { data: [{ 'issue.id': 77, 'issue': 'NW-API-3', 'count()': 41 }] } }, seen);
    const [issues] = sentryTools(ctx(['sentry_issues']));
    const out = JSON.parse(await issues!.invoke({ project: 'northwind-api', environment: 'production', around: '2026-10-01T15:05:00Z', window_minutes: 10 }) as string);

    expect(out).toMatchObject({ ok: true, project: 'northwind-api', environment: 'production', window: { start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T15:10:00.000Z' } });
    expect(out.issues[0]).toMatchObject({ shortId: 'NW-API-3', events: 41, url: 'https://northwind.sentry.io/issues/77/' });
    expect(new URL(seen[0]!).searchParams.get('environment')).toBe('production');
  });

  it('say plainly when Sentry is not connected', async () => {
    access.mockResolvedValue({ ok: false, error: 'no_sentry_credentials', message: 'No Sentry token is stored for this workspace.' });
    const [issues] = sentryTools(ctx(['sentry_issues']));
    const out = JSON.parse(await issues!.invoke({ project: 'northwind-api' }) as string);

    expect(out).toEqual({ ok: false, error: 'no_sentry_credentials', message: 'No Sentry token is stored for this workspace.' });
  });

  it('give one issue with its app frames, request and release', async () => {
    stubFetch({
      '/organizations/northwind/issues/NW-API-3/': { id: '77', shortId: 'NW-API-3', title: 'EngineInitError: ', project: { slug: 'northwind-api' }, count: '184', firstSeen: '2026-10-01T14:43:54Z', firstRelease: { version: 'aaaaaaa1' } },
      '/organizations/northwind/issues/77/events/latest/': {
        eventID: 'e1',
        tags: [{ key: 'environment', value: 'production' }, { key: 'status_code', value: '500' }],
        entries: [
          { type: 'exception', data: { values: [{ type: 'EngineInitError', value: 'engine not found', stacktrace: { frames: [{ filename: '/app/packages/core/dist/auth/plugin.js', lineNo: 210, function: 'Object.?', inApp: true }] } }] } },
          { type: 'request', data: { method: 'GET', url: 'https://api.northwind.example/v1/orgs' } },
        ],
      },
    });
    const [, issue] = sentryTools(ctx(['sentry_issues', 'sentry_issue']));
    const out = JSON.parse(await issue!.invoke({ id: 'NW-API-3' }) as string);

    expect(out.issue).toMatchObject({ shortId: 'NW-API-3', events: 184, firstRelease: 'aaaaaaa1' });
    expect(out.latestEvent.appFrames).toEqual(['/app/packages/core/dist/auth/plugin.js:210 in Object.?']);
    expect(out.latestEvent.request).toEqual({ method: 'GET', url: 'https://api.northwind.example/v1/orgs', status: 500 });
  });

  it('say first whether the issue is still happening, with the releases since its last event', async () => {
    stubFetch({
      '/organizations/northwind/issues/NW-API-3/': { id: '77', shortId: 'NW-API-3', title: 'EngineInitError: ', project: { slug: 'northwind-api' }, count: '184', status: 'unresolved', firstSeen: '2026-01-10T14:43:54Z', lastSeen: '2026-01-10T15:47:00Z' },
      '/organizations/northwind/issues/77/events/latest/': { eventID: 'e1', tags: [], entries: [] },
      '/projects/northwind/northwind-api/releases/': [{ version: 'bbb222bbb222ff', dateCreated: '2026-01-10T16:14:00Z' }, { version: 'aaa111aaa111ff', dateCreated: '2026-01-10T14:39:00Z' }],
    });
    vi.useFakeTimers({ now: new Date('2026-01-10T19:30:00Z'), toFake: ['Date'] });
    const [, issue] = sentryTools(ctx(['sentry_issues', 'sentry_issue']));
    const out = JSON.parse(await issue!.invoke({ id: 'NW-API-3' }) as string);
    vi.useRealTimers();

    expect(out.stillHappening).toMatchObject({ state: 'stopped', quietMinutes: 223, releasesSince: [{ version: 'bbb222bbb222ff' }] });
    expect(out.note).toMatch(/^Not happening now: the last event was 3h 43m ago\. 1 release went out since \(bbb222bbb222\)\./);
  });
});
