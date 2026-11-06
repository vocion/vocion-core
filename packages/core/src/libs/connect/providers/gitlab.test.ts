/**
 * "Connect with GitLab": the start sends the person to the instance's
 * authorize page with the signed state and an S256 challenge; the callback
 * trades the code (with the matching verifier) for the grant the vault keeps;
 * a refresh rotates both tokens; and every use refreshes an expiring grant
 * before the call goes out. GitLab is stubbed at `fetch`; the instance is
 * invented.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

// The refresh-and-save, so the test sees what would reach the vault without a database:
// an expiring grant on a source is refreshed and the rotated pair returned (and, for real, saved).
const usableLoginGrant = vi.fn();
let realUsable: (typeof import('@/libs/connect/loginGrant'))['usableLoginGrant'];
let grantIsExpiring: (typeof import('@/libs/connect/loginGrant'))['grantIsExpiring'];
vi.mock('@/libs/connect/loginGrant', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/libs/connect/loginGrant')>();
  realUsable = real.usableLoginGrant;
  grantIsExpiring = real.grantIsExpiring;
  return { ...real, usableLoginGrant: (input: unknown) => usableLoginGrant(input) };
});

const { gitlabProvider, GITLAB_LOGIN_SCOPES, refreshGitlabGrant } = await import('./gitlab');
const { pkceChallengeFor, pkceVerifierFor } = await import('@/libs/connect/state');
const { resolveGitlabAccess } = await import('@/libs/gitlab/token');

const REDIRECT = 'https://agents.example/api/connect/gitlab/callback';

type Call = { url: string; body: string; headers: Record<string, string> };

function stubFetch(answers: Record<string, { status?: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? ''), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
    const key = Object.keys(answers).find(prefix => String(url).startsWith(prefix));
    const answer = key ? answers[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }));
  return calls;
}

beforeEach(() => {
  env.AUTH_SECRET = 'test-secret-for-state-signing-0123456789';
  env.NEXT_PUBLIC_APP_URL = 'https://agents.example';
  env.GITLAB_OAUTH_CLIENT_ID = 'gl_app';
  env.GITLAB_OAUTH_CLIENT_SECRET = 'gl_secret';
  env.GITLAB_OAUTH_BASE_URL = undefined;
  usableLoginGrant.mockReset();
  usableLoginGrant.mockImplementation(async (input: Parameters<typeof realUsable>[0]) => {
    if (input.persistence.kind === 'persist' && grantIsExpiring(input.grant.expiresAt)) {
      return { ...input.grant, ...(await input.refresh(input.grant.refreshToken)) };
    }
    return realUsable(input);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gitlab connect provider', () => {
  it('is offered only when the application is registered; token paste stays the fallback', () => {
    expect(gitlabProvider.configured()).toBe(true);
    expect(gitlabProvider.pkce).toBe(true);

    env.GITLAB_OAUTH_CLIENT_SECRET = undefined;

    expect(gitlabProvider.configured()).toBe(false);
    expect(() => gitlabProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'gitlab' })).toThrow(/GITLAB_OAUTH_CLIENT_ID and GITLAB_OAUTH_CLIENT_SECRET/);
  });

  it('start: the instance\'s authorize URL with the state, the scopes and an S256 challenge of the state\'s verifier', () => {
    const state = 'signed.state.value';
    const challenge = pkceChallengeFor(pkceVerifierFor(state));
    const url = new URL(gitlabProvider.authorizeUrl({ state, redirectUri: REDIRECT, connector: 'gitlab', codeChallenge: challenge }));

    expect(url.origin + url.pathname).toBe('https://gitlab.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'gl_app',
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: GITLAB_LOGIN_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    // The challenge is base64url(SHA-256(verifier)), the verifier never leaves the server.
    expect(challenge).toBe(createHash('sha256').update(pkceVerifierFor(state)).digest('base64url'));
    expect(url.toString()).not.toContain(pkceVerifierFor(state));
  });

  it('start: a self-managed instance is the one GITLAB_OAUTH_BASE_URL names', () => {
    env.GITLAB_OAUTH_BASE_URL = 'https://gitlab.northwind.example/';

    expect(gitlabProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'gitlab' })).toMatch(/^https:\/\/gitlab\.northwind\.example\/oauth\/authorize\?/);
  });

  it('callback: trades the code and the verifier for the grant the vault keeps, with whose account it is', async () => {
    const calls = stubFetch({
      'https://gitlab.com/oauth/token': { body: { access_token: 'gl_at_1', refresh_token: 'gl_rt_1', expires_in: 7200, scope: 'api read_user', token_type: 'Bearer' } },
      'https://gitlab.com/api/v4/user': { body: { username: 'dana.northwind' } },
    });
    const verifier = pkceVerifierFor('signed.state.value');
    const out = await gitlabProvider.exchange({ query: { code: 'c0de', state: 'signed.state.value' }, redirectUri: REDIRECT, codeVerifier: verifier });

    expect(out.ok).toBe(true);

    const sent = new URLSearchParams(calls[0]!.body);

    expect(Object.fromEntries(sent)).toEqual({ grant_type: 'authorization_code', client_id: 'gl_app', client_secret: 'gl_secret', code: 'c0de', redirect_uri: REDIRECT, code_verifier: verifier });
    expect(calls[1]!.headers.authorization).toBe('Bearer gl_at_1');
    expect(out).toMatchObject({
      ok: true,
      credentials: { accessToken: 'gl_at_1', refreshToken: 'gl_rt_1', scope: 'api read_user', baseUrl: 'https://gitlab.com', account: 'dana.northwind' },
      displayName: 'GitLab — dana.northwind',
    });

    const expiresAt = Date.parse(String((out as { credentials: Record<string, unknown> }).credentials.expiresAt));

    expect(expiresAt - Date.now()).toBeGreaterThan(6000 * 1000);
    expect(gitlabProvider.summarize((out as { credentials: Record<string, unknown> }).credentials)).toEqual({ account: 'dana.northwind on gitlab.com' });
  });

  it('callback: a refusal or a missing code stores nothing', async () => {
    await expect(gitlabProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'access_denied' });
    await expect(gitlabProvider.exchange({ query: { error: '<script>' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'authorization_refused' });
    await expect(gitlabProvider.exchange({ query: {}, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'missing_code' });
  });

  it('refresh: rotates both tokens on the grant\'s own instance', async () => {
    const calls = stubFetch({ 'https://gitlab.northwind.example/oauth/token': { body: { access_token: 'gl_at_2', refresh_token: 'gl_rt_2', expires_in: 7200 } } });
    const out = await refreshGitlabGrant('gl_rt_1', undefined, 'https://gitlab.northwind.example');

    expect(out).toMatchObject({ accessToken: 'gl_at_2', refreshToken: 'gl_rt_2' });
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({ grant_type: 'refresh_token', client_id: 'gl_app', client_secret: 'gl_secret', refresh_token: 'gl_rt_1', redirect_uri: REDIRECT });
  });
});

describe('the token a GitLab call goes out with', () => {
  const persist = { kind: 'persist' as const, orgId: 'org_1', sourceId: 7, warn: vi.fn() };

  it('a pasted access token is used as stored, on the source\'s instance', async () => {
    await expect(resolveGitlabAccess({ token: ' glpat-abc ' }, persist, 'https://gitlab.northwind.example/api/v4')).resolves.toEqual({ token: 'glpat-abc', baseUrl: 'https://gitlab.northwind.example' });
    await expect(resolveGitlabAccess({}, persist)).resolves.toBeNull();
  });

  it('a login with time left is used without a refresh', async () => {
    const grant = { accessToken: 'gl_at_1', refreshToken: 'gl_rt_1', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), baseUrl: 'https://gitlab.com' };

    const calls = stubFetch({});

    await expect(resolveGitlabAccess(grant, persist)).resolves.toEqual({ token: 'gl_at_1', baseUrl: 'https://gitlab.com' });
    expect(calls).toHaveLength(0);
  });

  it('an expiring login is refreshed and saved to its source BEFORE the call, and the refresh runs on the grant\'s instance', async () => {
    const grant = { accessToken: 'gl_at_1', refreshToken: 'gl_rt_1', expiresAt: new Date(Date.now() - 1000).toISOString(), baseUrl: 'https://gitlab.northwind.example' };
    const calls = stubFetch({ 'https://gitlab.northwind.example/oauth/token': { body: { access_token: 'gl_at_2', refresh_token: 'gl_rt_2', expires_in: 7200 } } });

    await expect(resolveGitlabAccess(grant, persist)).resolves.toEqual({ token: 'gl_at_2', baseUrl: 'https://gitlab.northwind.example' });
    expect(usableLoginGrant).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'GitLab', provider: 'gitlab', connectorSlug: 'gitlab', persistence: persist }));
    expect(calls).toHaveLength(1);
  });

  it('a form\'s Test connection cannot refresh, and says so', async () => {
    const grant = { accessToken: 'gl_at_1', refreshToken: 'gl_rt_1', expiresAt: new Date(Date.now() - 1000).toISOString(), baseUrl: 'https://gitlab.com' };

    await expect(resolveGitlabAccess(grant, { kind: 'never' })).rejects.toThrow(/GitLab access token has expired/);
  });
});
