/**
 * Connector credentials in `api_token`, against PGlite.
 *
 * A connector platform breaks the rule the rest of the table lives by: an org
 * may hold as many live Jira or Strapi credentials as it wants, told apart by
 * name, and a connector install names the one it uses by row id. That makes two
 * things worth pinning here — that the carve-out really does let several live
 * rows coexist, and that it did not loosen the one-live cap the LLM platforms
 * depend on.
 *
 * The other half is rotation. Because an install points at a row id, rotating
 * a connector credential has to rewrite that row rather than revoke it and
 * insert a replacement; otherwise the install would keep resolving the old key.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const {
  issueToken,
  listPlatformCredentials,
  resolveCredentialById,
  resolvePlatformCredential,
  rotatePlatformCredential,
  revokeToken,
  storePlatformKey,
} = await import('@/services/ApiTokenService');

const ORG = 'org_connector_creds';
const OTHER_ORG = 'org_connector_creds_other';

const STAGING = { baseUrl: 'https://cms.staging.example.com', token: 'strapi-staging-token-aaaa' };
const PRODUCTION = { baseUrl: 'https://cms.example.com', token: 'strapi-prod-token-bbbb' };

async function clearCredentials(): Promise<void> {
  // api_token references source_dek, so credentials go first.
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
}

beforeEach(clearCredentials);

afterAll(clearCredentials);

describe('several live credentials for one connector platform', () => {
  it('keeps both when a workspace stores two Strapi credentials', async () => {
    const staging = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });
    const production = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: PRODUCTION });

    const live = await listPlatformCredentials(ORG, 'strapi');

    expect(live.map(credential => credential.id).sort()).toEqual([staging.id, production.id].sort());
  });

  it('does not revoke the first credential when a second is stored', async () => {
    const staging = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });
    await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: PRODUCTION });

    const [row] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, staging.id));

    expect(row?.revokedAt).toBeNull();
  });

  it('resolves each credential to its own values, so two installs can differ', async () => {
    const staging = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });
    const production = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: PRODUCTION });

    await expect(resolveCredentialById(ORG, staging.id)).resolves.toEqual({ status: 'ok', values: STAGING });
    await expect(resolveCredentialById(ORG, production.id)).resolves.toEqual({ status: 'ok', values: PRODUCTION });
  });

  it('tells the two apart by name and masked hint, without opening either', async () => {
    await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });

    const [credential] = await listPlatformCredentials(ORG, 'strapi');

    expect(credential?.name).toBe('Strapi — staging');
    expect(credential?.keyHint).toBe('…aaaa');
    expect(JSON.stringify(credential)).not.toContain(STAGING.token);
  });

  it('offers a credential stored under API credentials to a connector of the same platform', async () => {
    // The whole point of the ticket: the workspace typed its Jira key once,
    // and connector setup finds it rather than asking again.
    await storePlatformKey({
      orgId: ORG,
      name: 'Acme Jira',
      platform: 'jira',
      values: { email: 'ops@acme.example', apiToken: 'jira-token-cccc' },
    });

    const offered = await listPlatformCredentials(ORG, 'jira');

    expect(offered.map(credential => credential.name)).toEqual(['Acme Jira']);
  });

  it('never offers another org\'s credentials', async () => {
    await storePlatformKey({ orgId: OTHER_ORG, name: 'Their Strapi', platform: 'strapi', values: STAGING });

    await expect(listPlatformCredentials(ORG, 'strapi')).resolves.toEqual([]);
  });

  it('leaves a revoked credential off the list', async () => {
    const staging = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });
    await revokeToken(ORG, staging.id);

    await expect(listPlatformCredentials(ORG, 'strapi')).resolves.toEqual([]);
  });

  it('offers nothing for vocion, whose tokens authenticate no connector', async () => {
    await issueToken({ orgId: ORG, name: 'Integration token' });

    await expect(listPlatformCredentials(ORG, 'vocion')).resolves.toEqual([]);
  });
});

describe('the one-live cap the carve-out must not loosen', () => {
  const OPENAI_KEY = 'sk-abcdefghijklmnop1234';
  const REPLACEMENT_KEY = 'sk-zyxwvutsrqponmlk9876';

  it('still replaces the org\'s OpenAI key when a second is stored', async () => {
    const first = await storePlatformKey({ orgId: ORG, name: 'Acme OpenAI', platform: 'openai', apiKey: OPENAI_KEY });
    await storePlatformKey({ orgId: ORG, name: 'Acme OpenAI', platform: 'openai', apiKey: REPLACEMENT_KEY });

    const [replaced] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, first.id));
    const live = await db
      .select()
      .from(apiTokenSchema)
      .where(and(eq(apiTokenSchema.orgId, ORG), eq(apiTokenSchema.platform, 'openai')));

    expect(replaced?.revokedAt).not.toBeNull();
    expect(live.filter(row => row.revokedAt === null)).toHaveLength(1);
  });

  it('refuses to resolve a connector platform per org, because there is no single answer', async () => {
    await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });

    await expect(resolvePlatformCredential(ORG, 'strapi')).rejects.toThrow(/resolveCredentialById/);
  });
});

describe('resolveCredentialById', () => {
  it('reports a revoked credential as revoked, not as missing', async () => {
    // This is what lets a connector say "someone retired the key you point at"
    // instead of failing its next sync for no stated reason.
    const stored = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });
    await revokeToken(ORG, stored.id);

    await expect(resolveCredentialById(ORG, stored.id)).resolves.toEqual({ status: 'revoked' });
  });

  it('reports an expired credential as expired', async () => {
    const stored = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — staging',
      platform: 'strapi',
      values: STAGING,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(resolveCredentialById(ORG, stored.id)).resolves.toEqual({ status: 'expired' });
  });

  it('reports an unknown id as not found', async () => {
    await expect(resolveCredentialById(ORG, 'nosuchcredential')).resolves.toEqual({ status: 'not-found' });
  });

  it('hides a credential belonging to another org', async () => {
    const theirs = await storePlatformKey({ orgId: OTHER_ORG, name: 'Their Strapi', platform: 'strapi', values: STAGING });

    await expect(resolveCredentialById(ORG, theirs.id)).resolves.toEqual({ status: 'not-found' });
  });

  it('refuses to hand out a Vocion-minted token as a connector credential', async () => {
    const { id } = await issueToken({ orgId: ORG, name: 'Integration token' });

    await expect(resolveCredentialById(ORG, id)).resolves.toEqual({ status: 'minted' });
  });
});

describe('rotatePlatformCredential', () => {
  it('replaces the values while keeping the row id an install points at', async () => {
    const stored = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });

    const rotated = await rotatePlatformCredential({
      orgId: ORG,
      tokenId: stored.id,
      values: { baseUrl: STAGING.baseUrl, token: 'strapi-rotated-token-dddd' },
    });

    expect(rotated).toEqual({ status: 'ok', keyHint: '…dddd' });
    await expect(resolveCredentialById(ORG, stored.id)).resolves.toEqual({
      status: 'ok',
      values: { baseUrl: STAGING.baseUrl, token: 'strapi-rotated-token-dddd' },
    });
  });

  it('adds no second row, so nothing pointing at the credential goes stale', async () => {
    const stored = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });
    await rotatePlatformCredential({
      orgId: ORG,
      tokenId: stored.id,
      values: { baseUrl: STAGING.baseUrl, token: 'strapi-rotated-token-dddd' },
    });

    await expect(db.select().from(apiTokenSchema)).resolves.toHaveLength(1);
  });

  it('rejects a rotation whose values do not fit the platform', async () => {
    const stored = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });

    await expect(rotatePlatformCredential({
      orgId: ORG,
      tokenId: stored.id,
      values: { baseUrl: 'cms.example.com', token: 'strapi-rotated-token-dddd' },
    })).rejects.toThrow(/Instance URL/);
  });

  it('leaves the stored credential untouched when the rotation is rejected', async () => {
    const stored = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });

    await expect(rotatePlatformCredential({
      orgId: ORG,
      tokenId: stored.id,
      values: { baseUrl: 'cms.example.com', token: 'nope' },
    })).rejects.toThrow();

    await expect(resolveCredentialById(ORG, stored.id)).resolves.toEqual({ status: 'ok', values: STAGING });
  });

  it('refuses to rotate a revoked credential back into service', async () => {
    const stored = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STAGING });
    await revokeToken(ORG, stored.id);

    await expect(rotatePlatformCredential({
      orgId: ORG,
      tokenId: stored.id,
      values: PRODUCTION,
    })).resolves.toEqual({ status: 'revoked' });
  });

  it('reports an unknown id as not found', async () => {
    await expect(rotatePlatformCredential({
      orgId: ORG,
      tokenId: 'nosuchcredential',
      values: STAGING,
    })).resolves.toEqual({ status: 'not-found' });
  });

  it('refuses a platform that holds one live credential, where storing is the rotation', async () => {
    const stored = await storePlatformKey({
      orgId: ORG,
      name: 'Acme OpenAI',
      platform: 'openai',
      apiKey: 'sk-abcdefghijklmnop1234',
    });

    await expect(rotatePlatformCredential({
      orgId: ORG,
      tokenId: stored.id,
      values: { apiKey: 'sk-zyxwvutsrqponmlk9876' },
    })).rejects.toThrow(/storePlatformKey/);
  });

  it('clears an expiry when asked to, and leaves it alone when not', async () => {
    const stored = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — staging',
      platform: 'strapi',
      values: STAGING,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await rotatePlatformCredential({ orgId: ORG, tokenId: stored.id, values: PRODUCTION });
    const [keptExpiry] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, stored.id));

    await rotatePlatformCredential({ orgId: ORG, tokenId: stored.id, values: PRODUCTION, expiresAt: null });
    const [clearedExpiry] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, stored.id));

    expect(keptExpiry?.expiresAt).not.toBeNull();
    expect(clearedExpiry?.expiresAt).toBeNull();
  });
});
