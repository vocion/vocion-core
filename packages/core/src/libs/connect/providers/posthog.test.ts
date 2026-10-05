import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { pkceChallengeFor, pkceVerifierFor } = await import('../state');
const { posthogProvider, POSTHOG_LOGIN_SCOPES, withFreshPosthogGrant } = await import('./posthog');
const { GET: clientMetadataRoute } = await import('@/app/api/connect-client/posthog/route');
const { createPosthogClient, credentialsFrom } = await import('@/libs/posthog/client');

const ORIGIN = 'https://v.example';
const CALLBACK = `${ORIGIN}/api/connect/posthog/callback`;
const CLIENT_ID = `${ORIGIN}/api/connect-client/posthog`;
const NOW_ISO = new Date(Date.now() + 3_600_000).toISOString();

/**
 * A PostHog JSON response.
 * @param body - The JSON body.
 * @param status - The HTTP status.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('posthog connect provider', () => {
  beforeEach(() => {
    env.NEXT_PUBLIC_APP_URL = ORIGIN;
    env.AUTH_SECRET = 'test-secret-for-pkce-derivation-0001';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is offered only on a public https origin, because PostHog must fetch our client document from the internet', () => {
    expect(posthogProvider.configured()).toBe(true);

    env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    expect(posthogProvider.configured()).toBe(false);

    env.NEXT_PUBLIC_APP_URL = undefined;

    expect(posthogProvider.configured()).toBe(false);
  });

  it('sends the person to PostHog with the S256 challenge, our client URL, the state and the read scopes', () => {
    const challenge = pkceChallengeFor(pkceVerifierFor('st.ate'));
    const url = new URL(posthogProvider.authorizeUrl({ state: 'st.ate', redirectUri: CALLBACK, connector: 'posthog', codeChallenge: challenge }));

    expect(url.origin + url.pathname).toBe('https://oauth.posthog.com/oauth/authorize/');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st.ate');
    expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(url.searchParams.get('scope')).toBe(POSTHOG_LOGIN_SCOPES.join(' '));
    expect(posthogProvider.pkce).toBe(true);
  });

  it('refuses to build a login URL without a challenge, so PostHog never sees a login it will reject', () => {
    expect(() => posthogProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: 'posthog' })).toThrow(/PKCE/);
  });

  it('exchanges the code with the verifier and no secret, and stores the region and the single scoped project', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'pha_fixture_token_1', refresh_token: 'phr_fixture_token_1', expires_in: 36000, scope: 'query:read', scoped_teams: [4242] }))
      .mockResolvedValueOnce(jsonResponse({ detail: 'wrong region' }, 401))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 4242, name: 'Acme prod' }, { id: 7, name: 'Other' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await posthogProvider.exchange({ query: { code: 'c0de' }, redirectUri: CALLBACK, codeVerifier: 'verifier_1' });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'PostHog — Acme prod (eu.posthog.com)',
      credentials: { accessToken: 'pha_fixture_token_1', refreshToken: 'phr_fixture_token_1', host: 'https://eu.posthog.com', projectId: '4242', account: 'Acme prod (eu.posthog.com)' },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    const sent = new URLSearchParams(String(init?.body));

    expect(url).toBe('https://oauth.posthog.com/oauth/token/');
    expect(sent.get('code_verifier')).toBe('verifier_1');
    expect(sent.get('client_id')).toBe(CLIENT_ID);
    expect(sent.has('client_secret')).toBe(false);
    expect(init?.headers).not.toHaveProperty('authorization');
  });

  it('leaves the project to a setting when the login covers several projects', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'pha_fixture_token_1', refresh_token: 'phr_fixture_token_1', scoped_teams: [4242, 7] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 4242, name: 'A' }, { id: 7, name: 'B' }] })));

    const result = await posthogProvider.exchange({ query: { code: 'c0de' }, redirectUri: CALLBACK, codeVerifier: 'verifier_1' });

    expect(result.ok && 'projectId' in result.credentials).toBe(false);
    expect(result.ok && result.credentials.host).toBe('https://us.posthog.com');
  });

  it('a login for all projects, when the account has only one, stores that project so nothing is left to pick', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'pha_fixture_token_1', refresh_token: 'phr_fixture_token_1', scoped_teams: [] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 4242, name: 'Acme prod' }] })));

    const result = await posthogProvider.exchange({ query: { code: 'c0de' }, redirectUri: CALLBACK, codeVerifier: 'verifier_1' });

    expect(result.ok && result.credentials.projectId).toBe('4242');
  });

  it('refuses with the sanitized error PostHog returned, or missing_code when there is no code', async () => {
    expect(await posthogProvider.exchange({ query: { error: 'access_denied' }, redirectUri: CALLBACK, codeVerifier: 'v' })).toEqual({ ok: false, reason: 'access_denied' });
    expect(await posthogProvider.exchange({ query: { error: 'bad <script>alert(1)</script>' }, redirectUri: CALLBACK, codeVerifier: 'v' })).toEqual({ ok: false, reason: 'login_refused' });
    expect(await posthogProvider.exchange({ query: {}, redirectUri: CALLBACK, codeVerifier: 'v' })).toEqual({ ok: false, reason: 'missing_code' });
  });
});

describe('the PostHog client metadata document', () => {
  beforeEach(() => {
    env.NEXT_PUBLIC_APP_URL = ORIGIN;
  });

  it('names its own URL as client_id and lists exactly the callback the login sends', async () => {
    const response = clientMetadataRoute();
    const body = await response.json();

    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.redirect_uris).toEqual([CALLBACK]);
    expect(body.token_endpoint_auth_method).toBe('none');
  });

  it('answers 404 when the deployment has no public origin to name', () => {
    env.NEXT_PUBLIC_APP_URL = undefined;

    expect(clientMetadataRoute().status).toBe(404);
  });
});

describe('the PostHog client on a login grant', () => {
  const grant = { accessToken: 'pha_fixture_token_1', refreshToken: 'phr_fixture_token_1', expiresAt: NOW_ISO, host: 'https://eu.posthog.com', projectId: '4242' };

  it('accepts the login grant\'s pha_ token as the Bearer', () => {
    const resolved = credentialsFrom(grant);

    expect(resolved).toEqual({ ok: true, credentials: { apiKey: 'pha_fixture_token_1', host: 'https://eu.posthog.com', projectId: '4242' } });
    expect(createPosthogClient(resolved.ok ? resolved.credentials : (undefined as never)).credentials.apiKey).toBe('pha_fixture_token_1');
  });

  it('still refuses a pasted project token and a pasted pha_ key (pha_ is for login grants only)', () => {
    expect(credentialsFrom({ apiKey: 'phc_fixture_public_token', host: 'https://us.posthog.com', projectId: '1' }).ok).toBe(false);
    expect(credentialsFrom({ apiKey: 'pha_fixture_token_1', host: 'https://us.posthog.com', projectId: '1' }).ok).toBe(false);
  });

  it('asks the person to pick a project when a login covers several', () => {
    const { projectId: _omitted, ...withoutProject } = grant;
    const resolved = credentialsFrom(withoutProject);

    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.message).toMatch(/several projects/);
  });
});

describe('a sync on an expiring PostHog login', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes from the stored token, saves the rotated pair beside host and project, and Test connection refuses to refresh', async () => {
    env.NEXT_PUBLIC_APP_URL = ORIGIN;
    const expired = { accessToken: 'pha_old_token_00001', refreshToken: 'phr_old_token_00001', expiresAt: '2020-01-01T00:00:00.000Z', host: 'https://eu.posthog.com', projectId: '4242' };
    const orgId = 'org_posthog_refresh';
    const stored = await storeLoginCredential({ orgId, platform: 'posthog', name: 'PostHog - Acme', account: 'Acme', values: expired, createdBy: 'user_admin' });
    const [source] = await db.insert(knowledgeSourceSchema).values({
      orgId,
      slug: 'posthog-1',
      kind: 'plugin',
      configJson: { _connector: 'posthog' },
      apiTokenId: stored.id,
      apiTokenExclusive: false,
    }).returning({ id: knowledgeSourceSchema.id });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'pha_new_token_00002', refresh_token: 'phr_new_token_00002', expires_in: 36000 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(withFreshPosthogGrant(expired, { kind: 'never' })).rejects.toThrow(/Test connection does not refresh/);
    expect(fetchMock).not.toHaveBeenCalled();

    const fresh = await withFreshPosthogGrant(expired, { kind: 'persist', orgId, sourceId: source!.id, warn: () => {} });

    expect(fresh).toMatchObject({ accessToken: 'pha_new_token_00002', refreshToken: 'phr_new_token_00002', host: 'https://eu.posthog.com', projectId: '4242' });
    expect(new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body)).get('refresh_token')).toBe('phr_old_token_00001');
    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'posthog', apiTokenId: stored.id })).toMatchObject({ refreshToken: 'phr_new_token_00002', projectId: '4242' });
  });

  it('leaves a pasted key untouched', async () => {
    const pasted = { apiKey: 'phx_fixture_key_0001', host: 'https://us.posthog.com', projectId: '1' };

    expect(await withFreshPosthogGrant(pasted, { kind: 'never' })).toBe(pasted);
  });
});
