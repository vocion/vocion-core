/**
 * What makes the callback answerable.
 *
 * The callback is a GET anybody can hand a signed-in browser, so every case
 * here is about the same thing: nothing the query string says may decide which
 * org, which connector, or whose grant. The state row decides, or the request
 * is refused.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The graph cache is process-local and irrelevant here; the tool surface
// changing on connect has its own coverage.
vi.mock('@/services/agents/harness', () => ({ invalidateAgentGraphs: vi.fn() }));

const { db } = await import('@/libs/DB');
const {
  apiTokenSchema,
  oauthStateSchema,
  projectSchema,
  sourceCredentialSchema,
  sourceDekSchema,
  sourceInstallSchema,
  tenantAccountSchema,
} = await import('@/models/Schema');
const { beginOAuth, completeOAuth, OAuthSetupError, safeReturnPath } = await import('@/services/OAuthService');
const { storePlatformKey } = await import('@/services/ApiTokenService');

const ORG = 'org_oauth_test';
const JAMIE = 'user_jamie';
const ORIGIN = 'https://app.example.com';

/** The workspace's own OAuth client — the BYO half. */
async function storeGoogleClient() {
  await storePlatformKey({
    orgId: ORG,
    name: 'Google OAuth client',
    platform: 'google',
    values: { clientId: 'client-abc.apps.googleusercontent.example', clientSecret: 'shh', refreshToken: 'seed' },
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.delete(oauthStateSchema);
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: ORG, name: 'OAuth Test', slug: 'oauth-test' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ORG, slug: 'oauth-test', name: 'OAuth Test' });
});

afterAll(async () => {
  await db.delete(oauthStateSchema);
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('beginOAuth', () => {
  it('names the setup step instead of walking into a vendor error', async () => {
    // Without this the person meets Google's own `invalid_client` page, which
    // tells them nothing about what to do.
    await expect(beginOAuth({
      orgId: ORG,
      userId: JAMIE,
      connectorSlug: 'google-calendar',
      scopes: [],
      origin: ORIGIN,
    })).rejects.toBeInstanceOf(OAuthSetupError);
  });

  it('asks for what the tool needed, with the parameters a refresh token requires', async () => {
    await storeGoogleClient();

    const { url } = await beginOAuth({
      orgId: ORG,
      userId: JAMIE,
      connectorSlug: 'google-calendar',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      origin: ORIGIN,
      returnTo: '/dashboard/chat',
    });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(parsed.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/oauth/google/callback`);
    // Both are load-bearing: without them Google returns no refresh token and
    // the connection dies within the hour with nothing saying why.
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');

    const [row] = await db.select().from(oauthStateSchema);

    expect(row).toMatchObject({ orgId: ORG, userId: JAMIE, connectorSlug: 'google-calendar', redirectTo: '/dashboard/chat' });
    // The verifier stays here and never travels; the challenge is what went out.
    expect(row!.codeVerifier).toBeTruthy();
    expect(url).not.toContain(row!.codeVerifier!);
  });

  it('falls back to the connector\'s own default scopes', async () => {
    await storeGoogleClient();

    const { url } = await beginOAuth({ orgId: ORG, userId: JAMIE, connectorSlug: 'gmail', scopes: [], origin: ORIGIN });

    expect(new URL(url).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
  });
});

describe('completeOAuth', () => {
  /**
   * Stand in for the vendor's token endpoint.
   * @param payload
   * @param ok
   */
  function vendorReturns(payload: Record<string, unknown>, ok = true) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok,
      status: ok ? 200 : 400,
      json: async () => payload,
    } as unknown as Response);
  }

  async function startedState(connectorSlug = 'google-calendar') {
    await storeGoogleClient();
    const { url } = await beginOAuth({ orgId: ORG, userId: JAMIE, connectorSlug, scopes: [], origin: ORIGIN, returnTo: '/dashboard/chat' });
    return new URL(url).searchParams.get('state')!;
  }

  it('refuses a state it never minted', async () => {
    // The whole point: a crafted link cannot name an org, a connector or a user.
    await expect(completeOAuth({ state: 'forged', code: 'x', origin: ORIGIN }))
      .rejects
      .toBeInstanceOf(OAuthSetupError);
  });

  it('stores a personal grant against the person who consented', async () => {
    const state = await startedState('google-calendar');
    vendorReturns({ refresh_token: 'rt-jamie', scope: 'https://www.googleapis.com/auth/calendar.readonly' });

    const result = await completeOAuth({ state, code: 'auth-code', origin: ORIGIN });

    expect(result).toMatchObject({ connectorSlug: 'google-calendar', scope: 'user', returnTo: '/dashboard/chat' });

    const [credential] = await db.select().from(sourceCredentialSchema);

    // The owner comes from the STATE ROW, never from the callback.
    expect(credential!.userId).toBe(JAMIE);
  });

  it('is single-use, so a replayed callback cannot store a second grant', async () => {
    const state = await startedState();
    vendorReturns({ refresh_token: 'rt-1' });
    await completeOAuth({ state, code: 'auth-code', origin: ORIGIN });

    await expect(completeOAuth({ state, code: 'auth-code', origin: ORIGIN }))
      .rejects
      .toBeInstanceOf(OAuthSetupError);
    expect(await db.select().from(sourceCredentialSchema)).toHaveLength(1);
  });

  it('refuses a consent that returned no refresh token', async () => {
    const state = await startedState();
    // What it looks like when `access_type=offline` or `prompt=consent` is
    // missing: an access token that dies in an hour.
    vendorReturns({ access_token: 'at-only' });

    await expect(completeOAuth({ state, code: 'auth-code', origin: ORIGIN }))
      .rejects
      .toThrow(/refresh token/i);
    expect(await db.select().from(sourceCredentialSchema)).toEqual([]);
  });

  it('shows the vendor\'s refusal as something actionable, not its body', async () => {
    const state = await startedState();
    // A token-exchange body echoes the request — client secret included.
    vendorReturns({ error: 'invalid_grant', client_secret: 'shh' }, false);

    await expect(completeOAuth({ state, code: 'auth-code', origin: ORIGIN }))
      .rejects
      .toThrow(/redirect URI/);
    await expect(completeOAuth({ state, code: 'auth-code', origin: ORIGIN }))
      .rejects
      .not
      .toThrow(/shh/);
  });
});

describe('safeReturnPath', () => {
  it('keeps a same-site path and drops everything that could leave', () => {
    expect(safeReturnPath('/dashboard/chat?x=1')).toBe('/dashboard/chat?x=1');
    // `//evil.example` is protocol-relative: the browser follows it off-site.
    expect(safeReturnPath('//evil.example/steal')).toBeNull();
    expect(safeReturnPath('https://evil.example/steal')).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});
