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

beforeEach(() => {
  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_SLUG = 'vocion-agents';
  process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from(PEM).toString('base64');
  clearInstallationTokenCache();
});

afterEach(() => {
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_SLUG;
  delete process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
  vi.unstubAllGlobals();
});

function githubApi(handlers: Record<string, () => Response>) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const handler = handlers[path];
    return handler ? handler() : new Response('{"message":"Not Found"}', { status: 404 });
  });
}

describe('githubProvider', () => {
  it('serves the github connector and is configured only with the three env vars', () => {
    expect(githubProvider.connectorSlugs).toEqual(['github']);
    expect(githubProvider.configured()).toBe(true);

    delete process.env.GITHUB_APP_PRIVATE_KEY_BASE64;

    expect(githubProvider.configured()).toBe(false);
  });

  it('sends the person to the app install page carrying the state', () => {
    expect(githubProvider.authorizeUrl({ state: 'st.ate', redirectUri: 'https://x/cb' }))
      .toBe('https://github.com/apps/vocion-agents/installations/new?state=st.ate');
  });

  it('turns an installation into the credential bag with the account and the granted repositories', async () => {
    vi.stubGlobal('fetch', githubApi({
      '/app/installations/777': () => new Response(JSON.stringify({ id: 777, account: { login: 'The-NocoCompany', type: 'Organization' }, repository_selection: 'selected', permissions: { pull_requests: 'read' } })),
      '/app/installations/777/access_tokens': () => new Response(JSON.stringify({ token: 'ghs_t', expires_at: '2099-01-01T00:00:00Z' }), { status: 201 }),
      '/installation/repositories': () => new Response(JSON.stringify({ repositories: [{ full_name: 'The-NocoCompany/warranty-app' }, { full_name: 'The-NocoCompany/noco-sales' }] })),
    }));

    const result = await githubProvider.exchange({ query: { installation_id: '777', setup_action: 'install', state: 's' }, redirectUri: 'https://x/cb' });

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
  });

  it('refuses a request, a cancel, a missing id and an installation the app cannot read', async () => {
    vi.stubGlobal('fetch', githubApi({}));

    expect(await githubProvider.exchange({ query: { setup_action: 'request' }, redirectUri: '' })).toEqual({ ok: false, reason: 'installation_requested' });
    expect(await githubProvider.exchange({ query: { setup_action: 'cancel', installation_id: '1' }, redirectUri: '' })).toEqual({ ok: false, reason: 'cancelled' });
    expect(await githubProvider.exchange({ query: { setup_action: 'install' }, redirectUri: '' })).toEqual({ ok: false, reason: 'missing_installation' });
    expect(await githubProvider.exchange({ query: { installation_id: '999' }, redirectUri: '' })).toEqual({ ok: false, reason: 'installation_not_found' });
  });
});
