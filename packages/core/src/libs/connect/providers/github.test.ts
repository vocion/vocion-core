/**
 * The GitHub provider: where a person is sent (the app's install page with
 * the state), and what the Setup URL's query becomes — an installation
 * verified through the app, or a refusal that says why.
 */

import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearInstallationTokenCache } from '@/libs/github/app';
import { githubProvider } from './github';

const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

const ENV = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_BASE64', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'] as const;

beforeEach(() => {
  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_SLUG = 'vocion-agents';
  process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from(PEM).toString('base64');
  process.env.GITHUB_APP_CLIENT_ID = 'Iv1.client';
  process.env.GITHUB_APP_CLIENT_SECRET = 'client-secret';
  clearInstallationTokenCache();
});

afterEach(() => {
  for (const name of ENV) {
    delete process.env[name];
  }
  vi.unstubAllGlobals();
});

/** Every request the fake GitHub answered, as `host+path` with the bearer it carried. */
type Seen = { url: string; auth: string | null; body: string | null };

function githubApi(handlers: Record<string, (seen: Seen) => Response>) {
  const seen: Seen[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = `${u.host}${u.pathname}`;
    const entry: Seen = { url: key, auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null, body: typeof init?.body === 'string' ? init.body : null };
    seen.push(entry);
    const handler = handlers[key];
    return handler ? handler(entry) : new Response('{"message":"Not Found"}', { status: 404 });
  });
  return { fetchMock, seen };
}

/**
 * The vendor side of a happy installation: code → user token, the user sees 777, 777 exists.
 * @param over
 */
function happyHandlers(over: Record<string, (seen: Seen) => Response> = {}) {
  return {
    'github.com/login/oauth/access_token': () => new Response(JSON.stringify({ access_token: 'ghu_user', token_type: 'bearer' })),
    'api.github.com/user/installations': () => new Response(JSON.stringify({ installations: [{ id: 42 }, { id: 777 }] })),
    'api.github.com/app/installations/777': () => new Response(JSON.stringify({ id: 777, account: { login: 'The-NocoCompany', type: 'Organization' }, repository_selection: 'selected', permissions: { pull_requests: 'read' } })),
    'api.github.com/app/installations/777/access_tokens': () => new Response(JSON.stringify({ token: 'ghs_t', expires_at: '2099-01-01T00:00:00Z' }), { status: 201 }),
    'api.github.com/installation/repositories': () => new Response(JSON.stringify({ repositories: [{ full_name: 'The-NocoCompany/warranty-app' }, { full_name: 'The-NocoCompany/noco-sales' }] })),
    ...over,
  };
}

const CALLBACK = { installation_id: '777', setup_action: 'install', code: 'tmp-code', state: 's' };
const REDIRECT = 'https://agents.example/api/connect/github/callback';

describe('githubProvider', () => {
  it('serves the github connector and is configured only with all five env vars', () => {
    expect(githubProvider.connectorSlugs).toEqual(['github']);
    expect(githubProvider.requiredEnv).toEqual(ENV);
    expect(githubProvider.configured()).toBe(true);

    delete process.env.GITHUB_APP_CLIENT_SECRET;

    expect(githubProvider.configured()).toBe(false);
  });

  it('sends the person to the app install page carrying the state', () => {
    expect(githubProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'github' }))
      .toBe('https://github.com/apps/vocion-agents/installations/new?state=st.ate');
  });

  it('proves the person can see the installation, then stores it with the account and granted repositories', async () => {
    const { fetchMock, seen } = githubApi(happyHandlers());
    vi.stubGlobal('fetch', fetchMock);

    const result = await githubProvider.exchange({ query: CALLBACK, redirectUri: REDIRECT });

    expect(result).toEqual({
      ok: true,
      displayName: 'GitHub — The-NocoCompany',
      credentials: {
        installationId: '777',
        account: 'The-NocoCompany',
        accountType: 'Organization',
        repositorySelection: 'selected',
        repositories: ['The-NocoCompany/warranty-app', 'The-NocoCompany/noco-sales'],
        permissions: { pull_requests: 'read' },
      },
    });

    // The code went to GitHub with the client pair and the redirect it was issued for …
    const exchange = seen.find(s => s.url === 'github.com/login/oauth/access_token')!;

    expect(JSON.parse(exchange.body!)).toEqual({ client_id: 'Iv1.client', client_secret: 'client-secret', code: 'tmp-code', redirect_uri: REDIRECT });
    // … the user's installations were read with the user token, the app's with the JWT …
    expect(seen.find(s => s.url === 'api.github.com/user/installations')!.auth).toBe('Bearer ghu_user');
    expect(seen.find(s => s.url === 'api.github.com/app/installations/777')!.auth).toMatch(/^Bearer ey/);
    // … and the user token is nowhere in what is stored.
    expect(JSON.stringify(result)).not.toContain('ghu_user');
  });

  it('refuses an installation the person cannot see, before the app reads anything', async () => {
    const { fetchMock, seen } = githubApi(happyHandlers({
      'api.github.com/user/installations': () => new Response(JSON.stringify({ installations: [{ id: 42 }] })),
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await githubProvider.exchange({ query: CALLBACK, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'installation_not_yours' });
    expect(seen.map(s => s.url)).not.toContain('api.github.com/app/installations/777');
  });

  it('tells a GitHub outage apart from an installation the person cannot see', async () => {
    vi.stubGlobal('fetch', githubApi(happyHandlers({
      'api.github.com/user/installations': () => new Response('{"message":"upstream"}', { status: 502 }),
    })).fetchMock);

    expect(await githubProvider.exchange({ query: CALLBACK, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'github_unavailable' });

    vi.stubGlobal('fetch', githubApi(happyHandlers({
      'api.github.com/user/installations': () => new Response('{"message":"Forbidden"}', { status: 403 }),
    })).fetchMock);

    expect(await githubProvider.exchange({ query: CALLBACK, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'installation_not_yours' });
  });

  it('refuses without a code, a refused code, and a suspended installation', async () => {
    expect(await githubProvider.exchange({ query: { installation_id: '777', setup_action: 'install' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'missing_code' });

    vi.stubGlobal('fetch', githubApi(happyHandlers({
      'github.com/login/oauth/access_token': () => new Response(JSON.stringify({ error: 'bad_verification_code' })),
    })).fetchMock);

    expect(await githubProvider.exchange({ query: CALLBACK, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'code_refused' });

    vi.stubGlobal('fetch', githubApi(happyHandlers({
      'api.github.com/app/installations/777': () => new Response(JSON.stringify({ id: 777, account: { login: 'x' }, suspended_at: '2026-09-01T00:00:00Z' })),
    })).fetchMock);

    expect(await githubProvider.exchange({ query: CALLBACK, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'installation_suspended' });
  });

  it('refuses a request, a cancel, a missing id and an installation the app cannot read', async () => {
    vi.stubGlobal('fetch', githubApi(happyHandlers({
      'api.github.com/user/installations': () => new Response(JSON.stringify({ installations: [{ id: 999 }] })),
      'api.github.com/app/installations/999': () => new Response('{"message":"Not Found"}', { status: 404 }),
    })).fetchMock);

    expect(await githubProvider.exchange({ query: { setup_action: 'request' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'installation_requested' });
    expect(await githubProvider.exchange({ query: { setup_action: 'cancel', installation_id: '1' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'cancelled' });
    expect(await githubProvider.exchange({ query: { setup_action: 'install', code: 'c' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'missing_installation' });
    expect(await githubProvider.exchange({ query: { ...CALLBACK, installation_id: '999' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'installation_not_found' });
  });

  it('summarizes a stored installation as its account and repositories, and nothing for a pasted token', () => {
    expect(githubProvider.summarize({
      installationId: '777',
      account: 'The-NocoCompany',
      accountType: 'Organization',
      repositorySelection: 'selected',
      repositories: ['The-NocoCompany/warranty-app', 'The-NocoCompany/noco-sales'],
      permissions: { pull_requests: 'read' },
    })).toEqual({
      account: 'The-NocoCompany (organization)',
      granted: { label: 'Repositories', items: ['The-NocoCompany/warranty-app', 'The-NocoCompany/noco-sales'], note: undefined },
    });

    // An installation over every repository says so: the stored list is a snapshot.
    expect(githubProvider.summarize({ installationId: '1', account: 'acme', accountType: 'User', repositorySelection: 'all', repositories: [] })?.granted?.note)
      .toMatch(/every repository/);

    // A fine-grained token recorded no account, so there is nothing to show.
    expect(githubProvider.summarize({ token: 'github_pat_x' })).toBeNull();
  });
});
