/**
 * A refreshed Atlassian grant is written back to the row it was read from
 * (#1080). A Jira source linked to a login `api_token` row reads its grant
 * from that row, so the rotated refresh token has to land there: Atlassian
 * retires the old one, and a write to `source_credential` instead would leave
 * the workspace's Jira holding a dead token on the next sync.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, knowledgeSourceSchema, sourceCredentialSchema, sourceDekSchema } = await import('@/models/Schema');
const { storeLoginCredential, storePlatformKey, updateLoginCredentialValues } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { platformForConnectorSlug } = await import('@/libs/platforms/registry');
const { jiraFetch, resolveJiraAuth } = await import('./jira');

const ORG = 'org_refresh';
const BASE_URL = 'https://northwind.atlassian.net';
const SITE_ID = 'site-northwind';

const expiredGrant = {
  accessToken: 'a1',
  refreshToken: 'r1',
  expiresAt: '2020-01-01T00:00:00.000Z',
  scope: 'read:jira-work offline_access',
  sites: [{ id: SITE_ID, url: BASE_URL, name: 'Northwind' }],
};

async function seedLoginLinkedJiraSource(grant: Record<string, unknown> = expiredGrant): Promise<string> {
  const stored = await storeLoginCredential({
    orgId: ORG,
    platform: platformForConnectorSlug('jira')!.id,
    name: 'Atlassian - Northwind',
    account: 'Northwind',
    values: grant,
    createdBy: 'user_admin',
  });
  await db.insert(knowledgeSourceSchema).values({
    orgId: ORG,
    slug: 'jira-northwind',
    kind: 'plugin',
    configJson: { _connector: 'jira', baseUrl: BASE_URL },
    apiTokenId: stored.id,
    apiTokenExclusive: false,
  });
  return stored.id;
}

/**
 * Save the workspace's own Atlassian login app, as an admin does on the Developers page.
 * @param clientId - The app's client ID; its secret is derived from it.
 */
async function saveWorkspaceAtlassianApp(clientId: string): Promise<void> {
  await storePlatformKey({ orgId: ORG, name: 'Our Atlassian app', platform: 'atlassian-login-app', values: { clientId, clientSecret: `${clientId}_secret` } });
}

/**
 * The client ID and secret each refresh sent to Atlassian's token endpoint.
 * @param fetchStub - The stubbed network.
 */
function clientsSentToAtlassian(fetchStub: ReturnType<typeof vi.fn>): Array<{ clientId: unknown; clientSecret: unknown }> {
  const calls = fetchStub.mock.calls as Array<[string | URL | Request, RequestInit | undefined]>;
  return calls
    .filter(([input]) => String(input).includes('auth.atlassian.com/oauth/token'))
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
    .map(body => ({ clientId: body.client_id, clientSecret: body.client_secret }));
}

async function storedRefreshToken(tokenId: string): Promise<unknown> {
  const bag = await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: tokenId });
  return bag?.refreshToken;
}

/**
 * Stub the two outbound calls. `beforeTokenReply` runs just before Atlassian
 * answers the refresh, which is where a concurrent writer can slip in.
 * @param beforeTokenReply - Side effect to run once the refresh request arrives.
 */
function stubNetwork(beforeTokenReply: () => Promise<void> = async () => {}) {
  const fetchStub = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes('auth.atlassian.com/oauth/token')) {
      await beforeTokenReply();
      return new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ values: [], isLast: true }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

beforeEach(() => {
  vi.stubEnv('ATLASSIAN_CLIENT_ID', 'client-id');
  vi.stubEnv('ATLASSIAN_CLIENT_SECRET', 'client-secret');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await db.delete(knowledgeSourceSchema);
  await db.delete(sourceCredentialSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

describe('refreshing a grant that came from a login row', () => {
  it('writes the rotated refresh token to that api_token row and to nothing else', async () => {
    const tokenId = await seedLoginLinkedJiraSource();
    stubNetwork();
    const warn = vi.fn();
    const auth = resolveJiraAuth({
      baseUrl: BASE_URL,
      credentials: await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: tokenId }),
      persistence: { kind: 'persist', orgId: ORG, warn },
    });

    await jiraFetch(auth, '/rest/api/3/project/search');

    expect(await storedRefreshToken(tokenId)).toBe('r2');
    expect(await db.select().from(apiTokenSchema)).toHaveLength(1);
    expect(await db.select().from(sourceCredentialSchema)).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a refresh token someone else rotated first and carries on with their access token', async () => {
    const tokenId = await seedLoginLinkedJiraSource();
    const winner = { ...expiredGrant, accessToken: 'a-winner', refreshToken: 'r9', expiresAt: '2999-01-01T00:00:00.000Z' };
    const fetchStub = stubNetwork(async () => {
      await updateLoginCredentialValues({ orgId: ORG, tokenId, values: winner, expectedRefreshToken: 'r1' });
    });
    const warn = vi.fn();
    const auth = resolveJiraAuth({
      baseUrl: BASE_URL,
      credentials: await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: tokenId }),
      persistence: { kind: 'persist', orgId: ORG, warn },
    });

    await jiraFetch(auth, '/rest/api/3/project/search');

    expect(await storedRefreshToken(tokenId)).toBe('r9');
    expect(await db.select().from(sourceCredentialSchema)).toHaveLength(0);

    const jiraCall = fetchStub.mock.calls.find(([url]) => !String(url).includes('auth.atlassian.com'))!;

    expect((jiraCall[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer a-winner' });
  });

  it('warns the new token was not saved when the login row was revoked mid-refresh', async () => {
    const tokenId = await seedLoginLinkedJiraSource();
    stubNetwork(async () => {
      await db.update(apiTokenSchema).set({ revokedAt: new Date() }).where(eq(apiTokenSchema.id, tokenId));
    });
    const warn = vi.fn();
    const auth = resolveJiraAuth({
      baseUrl: BASE_URL,
      credentials: await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: tokenId }),
      persistence: { kind: 'persist', orgId: ORG, warn },
    });

    await jiraFetch(auth, '/rest/api/3/project/search');

    expect(warn).toHaveBeenCalledOnce();
    expect(await db.select().from(sourceCredentialSchema)).toHaveLength(0);
  });
});

describe('the Atlassian app a Jira refresh runs on (#1080)', () => {
  it('a login made on the workspace\'s own login app refreshes on that app, and the saved grant keeps it for the next refresh', async () => {
    const tokenId = await seedLoginLinkedJiraSource({ ...expiredGrant, loginClientId: 'ws_atlassian' });
    await saveWorkspaceAtlassianApp('ws_atlassian');
    const fetchStub = stubNetwork();
    const auth = resolveJiraAuth({
      baseUrl: BASE_URL,
      credentials: await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: tokenId }),
      persistence: { kind: 'persist', orgId: ORG, warn: vi.fn() },
    });

    await jiraFetch(auth, '/rest/api/3/project/search');

    expect(clientsSentToAtlassian(fetchStub)).toEqual([{ clientId: 'ws_atlassian', clientSecret: 'ws_atlassian_secret' }]);
    expect(await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: tokenId })).toMatchObject({ refreshToken: 'r2', loginClientId: 'ws_atlassian' });
  });

  it('a login whose login app was replaced says to log in again on the current app, without the reconnect hint or a call to Atlassian', async () => {
    const tokenId = await seedLoginLinkedJiraSource({ ...expiredGrant, loginClientId: 'ws_atlassian_old' });
    await saveWorkspaceAtlassianApp('ws_atlassian_new');
    const fetchStub = stubNetwork();
    const auth = resolveJiraAuth({
      baseUrl: BASE_URL,
      credentials: await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: tokenId }),
      persistence: { kind: 'persist', orgId: ORG, warn: vi.fn() },
    });

    const failure = await jiraFetch(auth, '/rest/api/3/project/search').then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('This Atlassian login was made with an Atlassian app that is no longer set up (it was replaced or removed), so it cannot be refreshed. An admin needs to log in with Atlassian again on the Connectors page, first saving an Atlassian login app on the Developers page if there is none.');
    expect(clientsSentToAtlassian(fetchStub)).toEqual([]);
    expect(await storedRefreshToken(tokenId)).toBe('r1');
  });

  it('finds the app from the grant on file, not the one this run loaded, when someone logged in again on a new app meanwhile', async () => {
    const tokenId = await seedLoginLinkedJiraSource({ ...expiredGrant, loginClientId: 'ws_atlassian_new' });
    await saveWorkspaceAtlassianApp('ws_atlassian_new');
    const fetchStub = stubNetwork();
    const auth = resolveJiraAuth({
      baseUrl: BASE_URL,
      credentials: { ...expiredGrant, loginClientId: 'ws_atlassian_old' },
      persistence: { kind: 'persist', orgId: ORG, warn: vi.fn() },
    });

    await jiraFetch(auth, '/rest/api/3/project/search');

    expect(clientsSentToAtlassian(fetchStub)).toEqual([{ clientId: 'ws_atlassian_new', clientSecret: 'ws_atlassian_new_secret' }]);
    expect(await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: tokenId })).toMatchObject({ refreshToken: 'r2', loginClientId: 'ws_atlassian_new' });
  });
});
