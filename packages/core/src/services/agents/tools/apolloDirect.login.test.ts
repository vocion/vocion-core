/**
 * The live Apollo tools on a "Connect with Apollo" login. Apollo is syncless,
 * so these tools are the only live path a login has: the login must be sent as
 * a Bearer token, and a pasted key must keep working as `x-api-key`.
 * Database-backed like `libs/sources/apollo.login.test.ts`; Apollo is a stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = { APOLLO_CLIENT_ID: 'ap_client', APOLLO_CLIENT_SECRET: 'ap_app_value' };
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { apolloClientForCtx } = await import('./apolloDirect');

const EXPIRED = '2000-01-01T00:00:00.000Z';
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const TOKEN_URL = 'https://app.apollo.io/api/v1/oauth/token';

let orgCounter = 0;

/**
 * An Apollo source on a stored login or key, in its own workspace.
 * @param values - The values the stored row holds.
 * @param slug - The source's slug.
 */
async function seedSource(values: Record<string, unknown>, slug: string) {
  orgCounter += 1;
  const orgId = `org_ap_tool_${orgCounter}`;
  const stored = await storeLoginCredential({ orgId, platform: 'apollo', name: 'Apollo - Mara', account: 'mara@acme.com', values, createdBy: 'user_admin' });
  await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug,
    kind: 'plugin',
    configJson: { _connector: 'apollo' },
    apiTokenId: stored.id,
    apiTokenExclusive: false,
  });
  return { orgId, tokenId: stored.id };
}

/**
 * Stub `fetch`: the token endpoint rotates to `at-new`/`rt-new`; every other
 * call answers 200. Records each call's URL and auth headers.
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

/**
 * Resolve the tool client for a workspace and make one Apollo call with it.
 * @param orgId - The workspace.
 */
async function callThroughToolClient(orgId: string) {
  const resolved = await apolloClientForCtx({ orgId } as never);
  if (resolved.ok) {
    await resolved.client.post('/api/v1/mixed_people/api_search', { page: 1, per_page: 1 });
  }
  return resolved;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apollo live tools on a login', () => {
  it('sends the login as a Bearer token, not as x-api-key', async () => {
    const { orgId } = await seedSource({ accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE }, 'apollo-login');
    const calls = stubApollo();

    const resolved = await callThroughToolClient(orgId);

    expect(resolved.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ authorization: 'Bearer at-good', apiKey: null });
  });

  it('refreshes an expired login first and saves the rotated grant to the same row', async () => {
    const { orgId, tokenId } = await seedSource({ accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED, account: 'mara@acme.com' }, 'apollo-login');
    const calls = stubApollo();

    await callThroughToolClient(orgId);

    const apolloCall = calls.find(call => call.url !== TOKEN_URL);

    expect(apolloCall?.authorization).toBe('Bearer at-new');
    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'apollo', apiTokenId: tokenId }))
      .toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new', account: 'mara@acme.com' });
  });

  it('a refused refresh comes back as data telling the person to log in again, not a throw', async () => {
    const { orgId } = await seedSource({ accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED }, 'apollo-login');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));

    const resolved = await apolloClientForCtx({ orgId } as never);

    expect(resolved).toMatchObject({ ok: false, error: 'no_apollo_credentials' });
    expect((resolved as { message: string }).message).toMatch(/An admin needs to log in with Apollo again/);
  });

  it('a pasted API key still goes out as x-api-key', async () => {
    const { orgId } = await seedSource({ apiKey: 'pasted-key' }, 'apollo');
    const calls = stubApollo();

    await callThroughToolClient(orgId);

    expect(calls[0]).toMatchObject({ apiKey: 'pasted-key', authorization: null });
  });
});
