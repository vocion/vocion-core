/**
 * A refreshed Atlassian grant is written back to the row it was read from
 * (#1028). A Jira source linked to a login `api_token` row reads its grant
 * from that row, so the rotated refresh token has to land there: Atlassian
 * retires the old one, and a write to `source_credential` instead would leave
 * the workspace's Jira holding a dead token on the next sync.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, knowledgeSourceSchema, sourceCredentialSchema, sourceDekSchema } = await import('@/models/Schema');
const { storeLoginCredential, updateLoginCredentialValues } = await import('@/services/ApiTokenService');
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

async function seedLoginLinkedJiraSource(): Promise<string> {
  const stored = await storeLoginCredential({
    orgId: ORG,
    platform: platformForConnectorSlug('jira')!.id,
    name: 'Atlassian - Northwind',
    account: 'Northwind',
    values: expiredGrant,
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
