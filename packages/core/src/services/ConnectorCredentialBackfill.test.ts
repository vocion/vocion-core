/**
 * Moving an existing API-key connector onto a stored workspace credential,
 * against PGlite.
 *
 * The migration this covers is the one the ticket calls its cost: a Strapi
 * install keeps its token in `source_credential` and its instance URL in
 * `config`, and afterwards both have to be one credential the workspace can
 * see, rotate and share — with the install still syncing throughout.
 *
 * What matters most here is the refusals. An install the backfill cannot move
 * safely must be left exactly as it was: still pointing at nothing, still
 * holding its own copy, still syncing. A backfill that half-moves a credential
 * would take a working connector offline for a reason nobody could read back.
 */
import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let testDekId = 0;
const TEST_KEY = Buffer.alloc(32, 9);

vi.mock('@/libs/DB');
vi.mock('@/libs/crypto/credentialVault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/crypto/credentialVault')>();
  return {
    ...actual,
    buildCredentialVault: () => ({
      kind: 'local' as const,
      async encrypt(_orgId: string, plaintext: Buffer) {
        const { ciphertext, nonce, authTag } = actual.aesEncrypt(TEST_KEY, plaintext);
        return {
          ciphertext: ciphertext.toString('base64'),
          nonce: nonce.toString('base64'),
          authTag: authTag.toString('base64'),
          dekId: testDekId,
        };
      },
      async decrypt(_orgId: string, ciphertext: string, nonce: string, authTag: string) {
        return actual.aesDecrypt(
          TEST_KEY,
          Buffer.from(ciphertext, 'base64'),
          Buffer.from(nonce, 'base64'),
          Buffer.from(authTag, 'base64'),
        );
      },
    }),
  };
});

const { db } = await import('@/libs/DB');
const {
  apiTokenSchema,
  sourceCredentialSchema,
  sourceDekSchema,
  sourceInstallSchema,
} = await import('@/models/Schema');
const { backfillConnectorCredentials } = await import('@/services/ConnectorCredentialBackfill');
const { getCredentialsForSource, storeCredential } = await import('@/services/SourceCredentialService');
const { listPlatformCredentials } = await import('@/services/ApiTokenService');

const ORG = 'org_backfill';

/**
 * An install the way it looked before connectors pointed at stored
 * credentials: its own config, and no `api_token_id`.
 * @param slug - Connector slug.
 * @param config - The install's config.
 */
async function makeInstall(slug: string, config: Record<string, unknown> = {}): Promise<number> {
  const [row] = await db
    .insert(sourceInstallSchema)
    .values({ orgId: ORG, sourceSlug: slug, installedBy: 'tester', config })
    .returning({ id: sourceInstallSchema.id });
  return row!.id;
}

async function clearAll(): Promise<void> {
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
}

beforeEach(async () => {
  await clearAll();
  const [dek] = await db
    .insert(sourceDekSchema)
    .values({ orgId: ORG, wrappedDek: 'test', algorithm: 'AES_256_GCM' })
    .returning({ id: sourceDekSchema.id });
  testDekId = dek!.id;
});

afterAll(clearAll);

describe('backfillConnectorCredentials', () => {
  it('moves a Strapi install\'s token and instance URL into one credential', async () => {
    const installId = await makeInstall('strapi', {
      baseUrl: 'https://cms.partner.org',
      collections: ['events'],
    });
    await storeCredential({
      orgId: ORG,
      installId,
      displayName: 'Partner Strapi',
      raw: { token: 'strapi-token-aaaa' },
    });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toHaveLength(1);
    // Exactly the platform's fields — the collections list stays configuration.
    await expect(getCredentialsForSource(ORG, 'strapi')).resolves.toEqual({
      baseUrl: 'https://cms.partner.org',
      token: 'strapi-token-aaaa',
    });
  });

  it('keeps the install syncing, now against the credential it points at', async () => {
    const installId = await makeInstall('strapi', { baseUrl: 'https://cms.partner.org', collections: ['events'] });
    await storeCredential({ orgId: ORG, installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();
    const resolved = await getCredentialsForSource(ORG, 'strapi');

    expect(resolved?.token).toBe('strapi-token-aaaa');
    expect(resolved?.baseUrl).toBe('https://cms.partner.org');
  });

  it('puts the moved credential in the workspace credentials list', async () => {
    const installId = await makeInstall('strapi', { baseUrl: 'https://cms.partner.org', collections: ['events'] });
    await storeCredential({ orgId: ORG, installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();
    const credentials = await listPlatformCredentials(ORG, 'strapi');

    expect(credentials.map(credential => credential.name)).toEqual(['Partner Strapi']);
  });

  it('takes the instance URL out of the config, so only one place claims it', async () => {
    const installId = await makeInstall('strapi', { baseUrl: 'https://cms.partner.org', collections: ['events'] });
    await storeCredential({ orgId: ORG, installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();
    const [install] = await db.select().from(sourceInstallSchema).where(eq(sourceInstallSchema.id, installId));

    expect(install?.config).toEqual({ collections: ['events'] });
    expect(install?.apiTokenId).not.toBeNull();
  });

  it('finds a token stored under an older field name', async () => {
    // Connectors have read `token` and `apiToken` interchangeably, so stored
    // credentials use both.
    const installId = await makeInstall('strapi', { baseUrl: 'https://cms.partner.org' });
    await storeCredential({ orgId: ORG, installId, displayName: 'Partner Strapi', raw: { apiToken: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();

    await expect(getCredentialsForSource(ORG, 'strapi')).resolves.toMatchObject({ token: 'strapi-token-aaaa' });
  });

  it('moves a Jira install\'s email and token together', async () => {
    const installId = await makeInstall('jira', { projects: ['VEERIO'] });
    await storeCredential({
      orgId: ORG,
      installId,
      displayName: 'Acme Jira',
      raw: { email: 'ops@acme.example', apiToken: 'jira-token-bbbb' },
    });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toHaveLength(1);
    await expect(getCredentialsForSource(ORG, 'jira')).resolves.toMatchObject({
      email: 'ops@acme.example',
      apiToken: 'jira-token-bbbb',
    });
  });

  it('leaves an OAuth install alone', async () => {
    // A Slack grant is issued to one installation and carries a refresh token,
    // so there is nothing to move and nothing to share.
    const installId = await makeInstall('slack');
    await storeCredential({ orgId: ORG, installId, displayName: 'Slack', raw: { token: 'xoxb-1' } });

    const report = await backfillConnectorCredentials();
    const [install] = await db.select().from(sourceInstallSchema).where(eq(sourceInstallSchema.id, installId));

    expect(report.moved).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(install?.apiTokenId).toBeNull();
  });

  it('adds nothing on a second run', async () => {
    const installId = await makeInstall('strapi', { baseUrl: 'https://cms.partner.org' });
    await storeCredential({ orgId: ORG, installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();
    const second = await backfillConnectorCredentials();

    expect(second.moved).toEqual([]);
    await expect(listPlatformCredentials(ORG, 'strapi')).resolves.toHaveLength(1);
  });

  it('reports a Strapi install with no instance URL, and changes nothing', async () => {
    const installId = await makeInstall('strapi', { collections: ['events'] });
    await storeCredential({ orgId: ORG, installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    const report = await backfillConnectorCredentials();
    const [install] = await db.select().from(sourceInstallSchema).where(eq(sourceInstallSchema.id, installId));

    expect(report.moved).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ sourceSlug: 'strapi', installId });
    expect(report.skipped[0]?.reason).toMatch(/Instance URL/);
    // Untouched: still on its own copy, still syncing.
    expect(install?.apiTokenId).toBeNull();
    expect(install?.config).toEqual({ collections: ['events'] });
    await expect(getCredentialsForSource(ORG, 'strapi')).resolves.toMatchObject({ token: 'strapi-token-aaaa' });
  });

  it('reports a Jira install whose credential has no email', async () => {
    const installId = await makeInstall('jira');
    await storeCredential({ orgId: ORG, installId, displayName: 'Acme Jira', raw: { token: 'jira-token-bbbb' } });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/email/i);
  });

  it('reports an install with no live credential to move', async () => {
    const installId = await makeInstall('hubspot');

    const report = await backfillConnectorCredentials();

    expect(report.skipped).toEqual([
      { orgId: ORG, sourceSlug: 'hubspot', installId, reason: 'no live credential to move' },
    ]);
  });

  it('ignores a revoked credential rather than moving it back into service', async () => {
    const installId = await makeInstall('hubspot');
    const credentialId = await storeCredential({
      orgId: ORG,
      installId,
      displayName: 'Acme HubSpot',
      raw: { token: 'pat-na1-cccc' },
    });
    await db
      .update(sourceCredentialSchema)
      .set({ revokedAt: new Date() })
      .where(eq(sourceCredentialSchema.id, credentialId));

    const report = await backfillConnectorCredentials();

    expect(report.moved).toEqual([]);
    expect(report.skipped[0]?.reason).toBe('no live credential to move');
  });

  it('reports a credential that will not decrypt, and changes nothing', async () => {
    const installId = await makeInstall('hubspot');
    const credentialId = await storeCredential({
      orgId: ORG,
      installId,
      displayName: 'Acme HubSpot',
      raw: { token: 'pat-na1-cccc' },
    });
    await db
      .update(sourceCredentialSchema)
      .set({ ciphertext: Buffer.from('not really ciphertext').toString('base64') })
      .where(eq(sourceCredentialSchema.id, credentialId));

    const report = await backfillConnectorCredentials();
    const [install] = await db.select().from(sourceInstallSchema).where(eq(sourceInstallSchema.id, installId));

    expect(report.moved).toEqual([]);
    expect(report.skipped[0]?.reason).toBe('existing credential could not be decrypted');
    expect(install?.apiTokenId).toBeNull();
  });

  it('moves several installs in one run, each to its own credential', async () => {
    const strapiInstall = await makeInstall('strapi', { baseUrl: 'https://cms.partner.org' });
    await storeCredential({ orgId: ORG, installId: strapiInstall, displayName: 'Partner Strapi', raw: { token: 'strapi-aaaa' } });
    const hubspotInstall = await makeInstall('hubspot');
    await storeCredential({ orgId: ORG, installId: hubspotInstall, displayName: 'Acme HubSpot', raw: { token: 'pat-na1-cccc' } });

    const report = await backfillConnectorCredentials();

    expect(report.moved.map(moved => moved.sourceSlug).sort()).toEqual(['hubspot', 'strapi']);
    expect(new Set(report.moved.map(moved => moved.apiTokenId)).size).toBe(2);
  });
});
