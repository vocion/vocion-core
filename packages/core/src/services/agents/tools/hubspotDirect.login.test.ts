/**
 * The live HubSpot tools and actions on a "Connect with HubSpot" login. A
 * HubSpot access token lasts 30 minutes, so past that the tools must refresh
 * from the stored refresh token and save the new grant to the same row,
 * instead of sending a stale token. Database-backed like
 * `libs/sources/hubspot.login.test.ts`; HubSpot is a stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = { HUBSPOT_CLIENT_ID: 'hs_client', HUBSPOT_CLIENT_SECRET: 'hs_app_value' };
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { hubspotClientForOrg, hubspotTokenForActionSlug } = await import('./hubspotDirect');

const EXPIRED = '2000-01-01T00:00:00.000Z';
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';

let orgCounter = 0;

/**
 * A HubSpot source on stored values, in its own workspace.
 * @param values - The values the stored row holds.
 * @param slug - The source's slug.
 */
async function seedSource(values: Record<string, unknown>, slug: string) {
  orgCounter += 1;
  const orgId = `org_hs_tool_${orgCounter}`;
  const stored = await storeLoginCredential({ orgId, platform: 'hubspot', name: 'HubSpot - Acme', account: 'acme.com', values, createdBy: 'user_admin' });
  await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug,
    kind: 'plugin',
    configJson: { _connector: 'hubspot' },
    apiTokenId: stored.id,
    apiTokenExclusive: false,
  });
  return { orgId, tokenId: stored.id };
}

/**
 * Stub `fetch`: the token endpoint hands out `at-new`/`rt-new`; the CRM answers
 * an empty list. Records each call's URL and bearer.
 */
function stubHubspot() {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), authorization: headers.authorization ?? null });
    const body = String(url) === TOKEN_URL
      ? { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 1800 }
      : { results: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  return calls;
}

/**
 * Resolve the tool client for a workspace and make one CRM call with it.
 * @param orgId - The workspace.
 */
async function callThroughToolClient(orgId: string) {
  const resolved = await hubspotClientForOrg(orgId);
  if (resolved.ok) {
    await resolved.client.get('/crm/v3/objects/contacts', { limit: '1' });
  }
  return resolved;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubspot live tools on a login', () => {
  it('an expired login is refreshed from the stored refresh token, used, and saved to the same row', async () => {
    const { orgId, tokenId } = await seedSource({ accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED, hubId: 4242 }, 'hubspot-login');
    const calls = stubHubspot();

    await callThroughToolClient(orgId);

    const crmCall = calls.find(call => call.url !== TOKEN_URL);

    expect(crmCall?.authorization).toBe('Bearer at-new');
    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'hubspot', apiTokenId: tokenId }))
      .toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new', hubId: 4242 });
  });

  it('a login that is still good is sent as is, with no refresh call', async () => {
    const { orgId } = await seedSource({ accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE }, 'hubspot-login');
    const calls = stubHubspot();

    await callThroughToolClient(orgId);

    expect(calls.filter(call => call.url === TOKEN_URL)).toEqual([]);
    expect(calls[0]!.authorization).toBe('Bearer at-good');
  });

  it('a refused refresh comes back as data telling the person to log in again, not a throw', async () => {
    const { orgId } = await seedSource({ accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED }, 'hubspot-login');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));

    const resolved = await hubspotClientForOrg(orgId);

    expect(resolved).toMatchObject({ ok: false, error: 'no_hubspot_credentials' });
    expect((resolved as { message: string }).message).toMatch(/Log in with HubSpot again/);
  });

  it('a pasted private-app token is used as stored, with no refresh attempt', async () => {
    const { orgId } = await seedSource({ token: 'pat-na1-pasted' }, 'hubspot-login');
    const calls = stubHubspot();

    await callThroughToolClient(orgId);

    expect(calls.filter(call => call.url === TOKEN_URL)).toEqual([]);
    expect(calls[0]!.authorization).toBe('Bearer pat-na1-pasted');
  });
});

describe('hubspot actions on a login', () => {
  it('an expired login handed to an action is refreshed and saved to the hubspot source\'s row', async () => {
    const grant = { accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED };
    const { orgId, tokenId } = await seedSource(grant, 'hubspot');
    stubHubspot();

    const token = await hubspotTokenForActionSlug(orgId, 'hubspot', grant);

    expect(token).toBe('at-new');
    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'hubspot', apiTokenId: tokenId }))
      .toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new' });
  });

  it('with no stored token it returns undefined so the action can say what to connect', async () => {
    expect(await hubspotTokenForActionSlug('org_none', 'hubspot', undefined)).toBeUndefined();
  });
});
