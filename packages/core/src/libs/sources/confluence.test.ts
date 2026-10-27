/**
 * Confluence connector against recorded answers: pages of the listed spaces
 * become documents through CQL, an incremental run asks by relative minutes,
 * the cursor is carried across pages, a pasted token goes to the site and an
 * Atlassian login to api.atlassian.com for the site the source names; the
 * docs provider keeps every read inside the configured spaces. Invented
 * sites and pages.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Env', () => ({ Env: {} }));
vi.mock('@/services/connectors/sourceCredentials', () => ({ credentialsForSource: vi.fn(async () => ({ email: 'ops@northwind.example', apiToken: 'cf_tok' })) }));

const { buildConfluenceCql, confluenceConnector, cursorOf, resolveConfluenceAuth } = await import('./confluence');
const { confluenceDocsProvider, confluencePageId } = await import('@/services/docs/providers/confluence');

const PAGE = {
  id: '4242',
  title: 'Incident runbook',
  space: { key: 'ENG', name: 'Engineering' },
  version: { number: 7, when: '2026-10-01T00:00:00Z', by: { displayName: 'Jamie Smith' } },
  body: { storage: { value: '<h2>Paging</h2><p>Page the on-call <b>first</b>.</p>' } },
  ancestors: [{ title: 'Operations' }],
  _links: { webui: '/spaces/ENG/pages/4242/Incident+runbook' },
};

function vendor(route: (url: string) => unknown) {
  const calls: Array<{ url: string; auth: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).authorization ?? '' });
    return new Response(JSON.stringify(route(url)), { status: 200 });
  }));
  return calls;
}

async function collect(docs: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of docs) {
    out.push(d);
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('confluence sync', () => {
  it('yields the spaces\' pages as text with where they sit, following the cursor, as Basic auth on the site', async () => {
    const calls = vendor(url => (url.includes('cursor=next1') ? { results: [] } : { results: [PAGE], _links: { next: '/rest/api/content/search?cql=x&cursor=next1' } }));
    const ctx: SourceContext = { sourceId: 7, orgId: 'org_1', config: { baseUrl: 'https://northwind.atlassian.example/wiki', spaceKeys: ['ENG'] }, credentials: { email: 'ops@northwind.example', apiToken: 'cf_tok' } };

    const docs = await collect(confluenceConnector.sync(ctx));

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ externalId: 'confluence:4242', title: 'Incident runbook', uri: 'https://northwind.atlassian.example/wiki/spaces/ENG/pages/4242/Incident+runbook', metadata: { spaceKey: 'ENG', version: 7, ancestors: ['Operations'] } });
    expect(docs[0]!.content).toContain('Space: Engineering · In: Operations');
    expect(docs[0]!.content).toContain('Page the on-call first.');
    expect(calls[0]!.url.startsWith('https://northwind.atlassian.example/wiki/rest/api/content/search?cql=')).toBe(true);
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from('ops@northwind.example:cf_tok').toString('base64')}`);
    expect(calls[1]!.url).toContain('cursor=next1');
  });

  it('asks an incremental run by relative minutes, so the site\'s timezone never skews it', () => {
    const now = new Date('2026-10-08T12:00:00Z');

    expect(buildConfluenceCql({ spaceKeys: ['ENG', 'OPS'], since: new Date('2026-10-08T11:00:00Z'), now })).toBe('space in ("ENG", "OPS") and type = page and lastmodified >= now("-65m") order by lastmodified asc');
    expect(buildConfluenceCql({ spaceKeys: ['ENG'] })).toBe('space in ("ENG") and type = page order by lastmodified asc');
    expect(cursorOf('/rest/api/content/search?limit=50&cursor=abc%3D')).toBe('abc=');
    expect(cursorOf(undefined)).toBeNull();
  });

  it('sends an Atlassian login to api.atlassian.com for the site the source names, and refuses a site it does not reach', async () => {
    const grant = { accessToken: 'at', refreshToken: 'rt', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scope: '', sites: [{ id: 'cloud-1', url: 'https://northwind.atlassian.example', name: 'Northwind' }] };

    await expect(resolveConfluenceAuth({ baseUrl: 'https://northwind.atlassian.example/', credentials: grant, persistence: { kind: 'never' } })).resolves.toEqual({ apiBase: 'https://api.atlassian.com/ex/confluence/cloud-1/wiki/rest/api', siteUrl: 'https://northwind.atlassian.example', headers: { authorization: 'Bearer at' } });
    await expect(resolveConfluenceAuth({ baseUrl: 'https://acme.atlassian.example', credentials: grant, persistence: { kind: 'never' } })).rejects.toThrow(/does not reach https:\/\/acme\.atlassian\.example/);
    await expect(resolveConfluenceAuth({ baseUrl: 'https://northwind.atlassian.example', credentials: { ...grant, expiresAt: '2020-01-01T00:00:00Z' }, persistence: { kind: 'never' } })).rejects.toThrow(/only a saved connector can renew it/);
  });

  it('Test connection checks every space key', async () => {
    vendor(() => ({ results: [{ key: 'ENG', name: 'Engineering' }] }));

    const out = await confluenceConnector.inspect!({ config: { baseUrl: 'https://northwind.atlassian.example', spaceKeys: ['ENG', 'HR'] }, credentials: { email: 'ops@northwind.example', apiToken: 'cf_tok' }, options: {} }) as { checks: Array<{ key: string; ok: boolean }> };

    expect(out.checks.map(c => [c.key, c.ok])).toEqual([['site', true], ['space:ENG', true], ['space:HR', false]]);
  });
});

describe('the Confluence docs provider', () => {
  const source = { id: 7, slug: 'confluence', kind: 'confluence', config: { baseUrl: 'https://northwind.atlassian.example', spaceKeys: ['ENG'] }, apiTokenId: null };

  it('searches text inside the configured spaces, and reads a page by URL', async () => {
    const calls = vendor(url => (url.includes('/content/search') ? { results: [PAGE] } : PAGE));
    const provider = await confluenceDocsProvider('org_1', source);

    await expect(provider.searchPages('on-call', 5)).resolves.toEqual([{ id: '4242', title: 'Incident runbook', space: 'ENG', url: 'https://northwind.atlassian.example/wiki/spaces/ENG/pages/4242/Incident+runbook', updated: '2026-10-01T00:00:00Z', updatedBy: 'Jamie Smith' }]);
    expect(new URL(calls[0]!.url).searchParams.get('cql')).toBe('space in ("ENG") and type = page and text ~ "on-call" order by lastmodified desc');

    const page = await provider.readPage('https://northwind.atlassian.example/wiki/spaces/ENG/pages/4242/Incident+runbook');

    expect(page).toMatchObject({ id: '4242', version: 7, ancestors: ['Operations'], text: 'Paging\nPage the on-call first.' });
  });

  it('refuses a page in a space the source does not list', async () => {
    vendor(() => ({ ...PAGE, space: { key: 'HR', name: 'People' } }));
    const provider = await confluenceDocsProvider('org_1', source);

    await expect(provider.readPage('4242')).rejects.toThrow(/space HR, which the confluence source is not configured for/);
    expect(confluencePageId('https://x.example/wiki/pages/viewpage.action?pageId=99')).toBe('99');
    expect(confluencePageId('not a page')).toBeNull();
  });
});
