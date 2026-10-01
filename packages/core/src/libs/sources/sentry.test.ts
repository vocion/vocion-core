import type { SentryFetch } from '@/libs/sentry/client';
import { describe, expect, it } from 'vitest';
import { getConnector } from './registry';
import { inspectSentry, sentryConnector } from './sentry';

const CREDS = { host: 'https://us.sentry.io', org: 'northwind', token: 'sntrys_fixture_token_0001' };

function fake(table: Record<string, unknown>): SentryFetch {
  return async (url) => {
    const path = new URL(url).pathname.replace(/^\/api\/0/, '');
    const hit = table[path];
    if (typeof hit === 'number') {
      return { ok: false, status: hit, json: async () => ({}), text: async () => '{"detail":"Invalid token"}' };
    }
    return { ok: true, status: 200, json: async () => hit, text: async () => '' };
  };
}

describe('the sentry connector', () => {
  it('is registered, live and sync-less, so its row offers Test connection', () => {
    expect(getConnector('sentry')).toBe(sentryConnector);
    expect(sentryConnector.syncless).toBe(true);
    expect(sentryConnector.authKind).toBe('apikey');
  });

  it('reads the organization, its projects and one page of issues, and confirms the projects asked for', async () => {
    const r = await inspectSentry({ config: { projects: ['northwind-api', 'northwind-mobile'] }, credentials: CREDS }, fake({
      '/organizations/northwind/': { slug: 'northwind', name: 'Northwind' },
      '/organizations/northwind/projects/': [{ slug: 'northwind-api', id: '1' }, { slug: 'northwind-web', id: '2' }],
      '/organizations/northwind/issues/': [{ id: '1', shortId: 'NW-API-3', count: '4' }],
    }));

    expect(r.authorized).toBe(true);
    expect(r.checks.map(c => [c.key, c.ok])).toEqual([['organization', true], ['projects', true], ['project:northwind-api', true], ['project:northwind-mobile', false], ['issues', true]]);
    expect(r.error).toMatch(/northwind-api, northwind-web/);
  });

  it('says the token was refused, in words a person acts on', async () => {
    const r = await inspectSentry({ config: {}, credentials: CREDS }, fake({ '/organizations/northwind/': 401 }));

    expect(r).toMatchObject({ reachable: true, authorized: false });
    expect(r.error).toMatch(/refused the token for northwind.*event:read/);
  });

  it('refuses to inspect without a token', async () => {
    await expect(inspectSentry({ config: {}, credentials: { org: 'northwind' } })).rejects.toThrow(/No Sentry token/);
  });
});
