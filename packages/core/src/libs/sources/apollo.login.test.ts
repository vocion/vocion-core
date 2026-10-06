/**
 * The Apollo source on a "Connect with Apollo" login: a Bearer token instead
 * of `x-api-key`, no master-key probe, and a refresh (that rotates the refresh
 * token) in a sync. Database-backed like `libs/connect/loginGrant.test.ts`;
 * Apollo is a stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = { APOLLO_CLIENT_ID: 'ap_client', APOLLO_CLIENT_SECRET: 'ap_app_value' };
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { apolloConnector } = await import('./apollo');
const { InspectInputError } = await import('./inspect');

const EXPIRED = '2000-01-01T00:00:00.000Z';
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const TOKEN_URL = 'https://app.apollo.io/api/v1/oauth/token';

let orgCounter = 0;

/**
 * An Apollo source on a stored login, in its own workspace.
 * @param grant - The values the login row holds.
 */
async function seedSourceOnLogin(grant: Record<string, unknown>) {
  orgCounter += 1;
  const orgId = `org_ap_login_${orgCounter}`;
  const stored = await storeLoginCredential({ orgId, platform: 'apollo', name: 'Apollo - Mara', account: 'mara@acme.com', values: grant, createdBy: 'user_admin' });
  const [source] = await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug: `apollo-login-${orgCounter}`,
    kind: 'plugin',
    configJson: { _connector: 'apollo' },
    apiTokenId: stored.id,
    apiTokenExclusive: false,
  }).returning({ id: knowledgeSourceSchema.id });
  return { orgId, tokenId: stored.id, sourceId: source!.id };
}

/**
 * Stub `fetch`: the token endpoint rotates to `at-new`/`rt-new`; every other
 * call answers 200 with an empty object. Records each call's URL and auth headers.
 */
function stubApollo() {
  const calls: Array<{ url: string; authorization: string | null; apiKey: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), authorization: headers.authorization ?? null, apiKey: headers['x-api-key'] ?? null });
    const body = String(url) === TOKEN_URL
      ? { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 2_592_000 }
      : {};
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apollo source Test connection on a login', () => {
  it('calls Apollo with the Bearer token, never x-api-key, and skips the master-key check that only an API key can answer', async () => {
    const calls = stubApollo();

    const inspection = await apolloConnector.inspect!({
      config: {},
      credentials: { accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE },
      options: {},
    }) as { checks: Array<{ key: string; label: string }> };

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(call => call.authorization === 'Bearer at-good' && call.apiKey === null)).toBe(true);
    expect(calls.some(call => call.url.includes('usage_stats'))).toBe(false);
    expect(inspection.checks.map(entry => entry.key)).not.toContain('usage_stats');
    expect(inspection.checks.find(entry => entry.key === 'auth')?.label).toBe('Login accepted');
  });

  it('refuses to refresh an expired login, because a rotated token it could not save would strand the stored one', async () => {
    const calls = stubApollo();

    await expect(apolloConnector.inspect!({
      config: {},
      credentials: { accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED },
      options: {},
    })).rejects.toBeInstanceOf(InspectInputError);
    expect(calls).toEqual([]);
  });

  it('re-testing a connected source renews an expired login and saves the rotated token, since an Apollo row has no Sync now to do it', async () => {
    const grant = { accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED, account: 'mara@acme.com' };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    const calls = stubApollo();

    const inspection = await apolloConnector.inspect!({ config: {}, credentials: grant, options: {}, savedSource: { orgId, sourceId } }) as { note: string | null };

    expect(calls.filter(call => call.url !== TOKEN_URL).every(call => call.authorization === 'Bearer at-new')).toBe(true);
    // A test that saved the renewed login must not say nothing was saved.
    expect(inspection.note).toBe('This test renewed the expired Apollo login and saved it to this connector. Nothing else was saved.');
    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'apollo', apiTokenId: tokenId }))
      .toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new', account: 'mara@acme.com' });
  });

  it('a pasted API key still goes as x-api-key and still gets the master-key check', async () => {
    const calls = stubApollo();

    const inspection = await apolloConnector.inspect!({ config: {}, credentials: { token: 'pasted-key' }, options: {} }) as { checks: Array<{ key: string }> };

    expect(calls.every(call => call.apiKey === 'pasted-key' && call.authorization === null)).toBe(true);
    expect(inspection.checks.map(entry => entry.key)).toContain('usage_stats');
  });
});

describe('apollo source sync on a login', () => {
  it('refreshes an expired login and saves the ROTATED refresh token, since Apollo revokes the old pair', async () => {
    const grant = { accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED, account: 'mara@acme.com' };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    stubApollo();

    for await (const _doc of apolloConnector.sync({ orgId, sourceId, config: {}, credentials: grant })) {
      // The Apollo source mirrors nothing.
    }

    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'apollo', apiTokenId: tokenId }))
      .toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new', account: 'mara@acme.com' });
  });

  it('leaves a pasted key alone: no token request at all', async () => {
    const calls = stubApollo();

    for await (const _doc of apolloConnector.sync({ orgId: 'org_pasted', sourceId: 1, config: {}, credentials: { token: 'pasted-key' } })) {
      // Nothing to mirror.
    }

    expect(calls).toEqual([]);
  });
});
