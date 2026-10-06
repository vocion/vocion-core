/**
 * The HubSpot source on a "Connect with HubSpot" login: it sends the login's
 * access token, and refreshes an expiring one before a sync and saves it.
 * Database-backed like `libs/connect/loginGrant.test.ts`; HubSpot is a stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = { HUBSPOT_CLIENT_ID: 'hs_client', HUBSPOT_CLIENT_SECRET: 'hs_app_value' };
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { hubspotConnector, resolveHubspotToken } = await import('./hubspot');

const EXPIRED = '2000-01-01T00:00:00.000Z';
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';

let orgCounter = 0;

/**
 * A HubSpot source on a stored login, in its own workspace.
 * @param grant - The values the login row holds.
 */
async function seedSourceOnLogin(grant: Record<string, unknown>) {
  orgCounter += 1;
  const orgId = `org_hs_login_${orgCounter}`;
  const stored = await storeLoginCredential({ orgId, platform: 'hubspot', name: 'HubSpot - Acme', account: 'acme.com', values: grant, createdBy: 'user_admin' });
  const [source] = await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug: `hubspot-login-${orgCounter}`,
    kind: 'plugin',
    configJson: { _connector: 'hubspot' },
    apiTokenId: stored.id,
    apiTokenExclusive: false,
  }).returning({ id: knowledgeSourceSchema.id });
  return { orgId, tokenId: stored.id, sourceId: source!.id };
}

/**
 * Stub `fetch`: the token endpoint hands out `at-new`/`rt-new`; the CRM list
 * answers empty. Records each call's URL and bearer.
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
 * Drain a sync of the HubSpot source.
 * @param context - Sync context fields.
 * @param context.orgId - The workspace.
 * @param context.sourceId - The source row.
 * @param context.credentials - The bag the sync loaded.
 */
async function runSync(context: { orgId: string; sourceId: number; credentials: Record<string, unknown> }) {
  for await (const _doc of hubspotConnector.sync({ ...context, config: { objectType: 'contacts' } })) {
    // No records in the stub; only the calls matter.
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubspot source on a login', () => {
  it('sends the login\'s access token as the bearer, with no refresh while it is good', async () => {
    const grant = { accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE };
    const { orgId, sourceId } = await seedSourceOnLogin(grant);
    const calls = stubHubspot();

    await runSync({ orgId, sourceId, credentials: grant });

    expect(calls.filter(call => call.url === TOKEN_URL)).toEqual([]);
    expect(calls[0]!.authorization).toBe('Bearer at-good');
  });

  it('refreshes an expired login before reading, reads with the NEW token, and saves the rotated grant beside what it kept', async () => {
    const grant = { accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED, hubId: 4242, account: 'mara@acme.com' };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    const calls = stubHubspot();

    await runSync({ orgId, sourceId, credentials: grant });

    const crmCalls = calls.filter(call => call.url !== TOKEN_URL);

    expect(crmCalls.length).toBeGreaterThan(0);
    expect(crmCalls.every(call => call.authorization === 'Bearer at-new')).toBe(true);
    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'hubspot', apiTokenId: tokenId }))
      .toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new', hubId: 4242, account: 'mara@acme.com' });
  });

  it('a refused refresh fails the sync with a message that says to log in with HubSpot again', async () => {
    const grant = { accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED };
    const { orgId, sourceId } = await seedSourceOnLogin(grant);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));

    await expect(runSync({ orgId, sourceId, credentials: grant })).rejects.toThrow(/log in with HubSpot again/);
  });

  it('resolution without persistence never refreshes: an expired login says to run a sync', async () => {
    const calls = stubHubspot();

    await expect(resolveHubspotToken({ accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED }, { kind: 'never' }))
      .rejects
      .toThrow(/Run Sync now/);
    expect(calls).toEqual([]);
  });

  it('a pasted private-app token is used as is, with no refresh attempt', async () => {
    const calls = stubHubspot();

    await runSync({ orgId: 'org_pasted', sourceId: 1, credentials: { token: 'pat-na1-pasted' } });

    expect(calls.filter(call => call.url === TOKEN_URL)).toEqual([]);
    expect(calls[0]!.authorization).toBe('Bearer pat-na1-pasted');
  });

  it('with neither a login nor a token it says what to connect, without naming only the private-app token', async () => {
    await expect(runSync({ orgId: 'org_none', sourceId: 1, credentials: {} })).rejects.toThrow(/Connect with HubSpot/);
  });
});
