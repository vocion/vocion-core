import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_SITE_ID, FIXTURE_WEBFLOW_TOKEN, FIXTURE_WORKSPACE_ID, webflowFetch } from '@/libs/fixtures/webflow';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const { webflowProvider, WEBFLOW_LOGIN_SCOPES } = await import('./webflow');

const REDIRECT = 'https://v.example/api/connect/webflow/callback';

/**
 * Webflow's token endpoint, then the fixture API for the calls after it.
 * @param token - What the token endpoint answers.
 * @param token.status - Its status.
 * @param token.body - Its body.
 */
function stubWebflow(token: { status: number; body: unknown }) {
  const api = webflowFetch();
  const calls: Array<{ url: string; body: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.webflow.com/oauth/access_token') {
      calls.push({ url, body: String(init?.body) });
      return new Response(JSON.stringify(token.body), { status: token.status });
    }
    return api.fetch(input, init);
  }));
  return calls;
}

describe('webflow connect provider', () => {
  beforeEach(() => {
    env.WEBFLOW_CLIENT_ID = 'wf_client';
    env.WEBFLOW_CLIENT_SECRET = 'wf_secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is configured only when both env vars are set', () => {
    expect(webflowProvider.configured()).toBe(true);

    env.WEBFLOW_CLIENT_SECRET = undefined;

    expect(webflowProvider.configured()).toBe(false);
  });

  it('sends the person to Webflow asking for the sites and their CMS, read and write, and nothing that publishes a whole site', () => {
    const url = new URL(webflowProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'webflow' }));

    expect(url.origin + url.pathname).toBe('https://webflow.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', client_id: 'wf_client', redirect_uri: REDIRECT, scope: 'sites:read cms:read cms:write', state: 'st.ate' });
    expect(WEBFLOW_LOGIN_SCOPES).not.toContain('sites:write');
  });

  it('stores the token with the sites it reaches, by name and address, and names them on the card', async () => {
    const calls = stubWebflow({ status: 200, body: { access_token: FIXTURE_WEBFLOW_TOKEN, token_type: 'bearer', scope: 'sites:read cms:read cms:write' } });

    const result = await webflowProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });

    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({ client_id: 'wf_client', client_secret: 'wf_secret', code: 'c0de', grant_type: 'authorization_code', redirect_uri: REDIRECT });
    expect(result).toEqual({
      ok: true,
      displayName: 'Webflow — Northwind Outfitters',
      credentials: {
        token: FIXTURE_WEBFLOW_TOKEN,
        scope: 'sites:read cms:read cms:write',
        sites: [{ id: FIXTURE_SITE_ID, name: 'Northwind Outfitters', url: 'https://www.northwind-outfitters.example' }],
        siteIds: [FIXTURE_SITE_ID],
        workspaceIds: [FIXTURE_WORKSPACE_ID],
      },
    });
    expect(result.ok && webflowProvider.summarize(result.credentials)).toEqual({
      account: 'Northwind Outfitters (Webflow site)',
      granted: { label: 'Sites', items: ['Northwind Outfitters · www.northwind-outfitters.example'], note: expect.stringContaining('Log in again') },
    });
  });

  it('refuses with a short code, and without calling Webflow when the person declined', async () => {
    stubWebflow({ status: 400, body: { error: 'invalid_grant', error_description: 'echo of the code' } });

    await expect(webflowProvider.exchange({ query: { code: 'stale' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'invalid_grant' });
    await expect(webflowProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'access_denied' });
    await expect(webflowProvider.exchange({ query: {}, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'missing_code' });
  });

  it('shows no account for a pasted site token', () => {
    expect(webflowProvider.summarize({ token: 'pasted-site-token' })).toBeNull();
  });
});
