/**
 * Moving an existing API-key connector onto a stored workspace credential,
 * against PGlite.
 *
 * The migration this covers is the one the ticket calls its cost: a Strapi
 * connector keeps its token in `source_credential` and its instance URL in
 * `config`, and afterwards both have to be one credential the workspace can
 * see and rotate — with the connector still syncing throughout.
 *
 * What matters most here is the refusals. A connector the backfill cannot move
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
  knowledgeSourceSchema,
  sourceCredentialSchema,
  sourceDekSchema,
  sourceInstallSchema,
} = await import('@/models/Schema');
const { backfillConnectorCredentials } = await import('@/services/ConnectorCredentialBackfill');
const { getCredentialsForConnector, storeCredential } = await import('@/services/SourceCredentialService');
const { listPlatformCredentials } = await import('@/services/ApiTokenService');

const ORG = 'org_backfill';

/** One connector row plus the install its old credential hangs off. */
type Connector = { sourceId: number; installId: number };

/**
 * A connector the way it looked before connectors pointed at stored
 * credentials: its own config, and no `api_token_id`.
 * @param connectorSlug - Which connector it runs, e.g. `strapi`.
 * @param config - The connector's config, minus the `_connector` hint.
 * @param sourceSlug - The row's own slug, when it differs from the connector's.
 */
async function makeConnector(
  connectorSlug: string,
  config: Record<string, unknown> = {},
  sourceSlug: string = connectorSlug,
): Promise<Connector> {
  // The install is where the old credential hangs, and there is one per
  // (org, connector slug) however many connector rows run it.
  const [existingInstall] = await db
    .select({ id: sourceInstallSchema.id })
    .from(sourceInstallSchema)
    .where(eq(sourceInstallSchema.sourceSlug, connectorSlug))
    .limit(1);
  let installId = existingInstall?.id;
  if (installId === undefined) {
    const [install] = await db
      .insert(sourceInstallSchema)
      .values({ orgId: ORG, sourceSlug: connectorSlug, installedBy: 'tester' })
      .returning({ id: sourceInstallSchema.id });
    installId = install!.id;
  }
  const [source] = await db
    .insert(knowledgeSourceSchema)
    .values({
      orgId: ORG,
      slug: sourceSlug,
      kind: 'plugin',
      configJson: { ...config, _connector: connectorSlug },
    })
    .returning({ id: knowledgeSourceSchema.id });
  return { sourceId: source!.id, installId };
}

/**
 * What the connector resolves at sync time, the way `runSync` asks for it.
 * @param connector
 * @param connectorSlug
 */
async function credentialsInUse(connector: Connector, connectorSlug: string): Promise<unknown> {
  const [source] = await db
    .select({ apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.id, connector.sourceId));
  return getCredentialsForConnector({
    orgId: ORG,
    connectorSlug,
    apiTokenId: source?.apiTokenId ?? null,
  });
}

async function clearAll(): Promise<void> {
  await db.update(knowledgeSourceSchema).set({ apiTokenId: null });
  await db.delete(sourceCredentialSchema);
  await db.delete(knowledgeSourceSchema);
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
  it('moves a Strapi connector\'s token and instance URL into one credential', async () => {
    const connector = await makeConnector('strapi', {
      baseUrl: 'https://cms.partner.org',
      collections: ['events'],
    });
    await storeCredential({
      orgId: ORG,
      installId: connector.installId,
      displayName: 'Partner Strapi',
      raw: { token: 'strapi-token-aaaa' },
    });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toHaveLength(1);
    // Exactly the platform's fields — the collections list stays configuration.
    await expect(credentialsInUse(connector, 'strapi')).resolves.toEqual({
      baseUrl: 'https://cms.partner.org',
      token: 'strapi-token-aaaa',
    });
  });

  it('puts the moved credential in the workspace credentials list', async () => {
    const connector = await makeConnector('strapi', { baseUrl: 'https://cms.partner.org' });
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();
    const credentials = await listPlatformCredentials(ORG, 'strapi');

    expect(credentials.map(credential => credential.name)).toEqual(['Partner Strapi']);
  });

  it('takes the instance URL out of the config, so only one place claims it', async () => {
    const connector = await makeConnector('strapi', {
      baseUrl: 'https://cms.partner.org',
      collections: ['events'],
    });
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();
    const [source] = await db
      .select()
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.id, connector.sourceId));

    expect(source?.configJson).toEqual({ collections: ['events'], _connector: 'strapi' });
    expect(source?.apiTokenId).not.toBeNull();
  });

  it('finds a token stored under an older field name', async () => {
    // Connectors have read `token` and `apiToken` interchangeably, so stored
    // credentials use both.
    const connector = await makeConnector('strapi', { baseUrl: 'https://cms.partner.org' });
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Partner Strapi', raw: { apiToken: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();

    await expect(credentialsInUse(connector, 'strapi')).resolves.toMatchObject({ token: 'strapi-token-aaaa' });
  });

  it('moves a Jira connector\'s email and token together', async () => {
    const connector = await makeConnector('jira', { projects: ['VEERIO'] });
    await storeCredential({
      orgId: ORG,
      installId: connector.installId,
      displayName: 'Acme Jira',
      raw: { email: 'ops@acme.example', apiToken: 'jira-token-bbbb' },
    });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toHaveLength(1);
    await expect(credentialsInUse(connector, 'jira')).resolves.toMatchObject({
      email: 'ops@acme.example',
      apiToken: 'jira-token-bbbb',
    });
  });

  it('moves a Slack bot token onto the workspace credential', async () => {
    // Slack gained a platform, so the backfill now has somewhere to move its
    // key instead of leaving it on the install.
    const connector = await makeConnector('slack');
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Slack', raw: { token: 'xoxb-1' } });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toHaveLength(1);
    await expect(credentialsInUse(connector, 'slack')).resolves.toEqual({ token: 'xoxb-1' });
  });

  it('moves one Google grant across, keeping the durable set intact', async () => {
    const connector = await makeConnector('gmail');
    await storeCredential({
      orgId: ORG,
      installId: connector.installId,
      displayName: 'Google',
      raw: { clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'refresh-1' },
    });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toHaveLength(1);
    await expect(credentialsInUse(connector, 'gmail')).resolves.toMatchObject({
      clientId: 'client-1',
      refreshToken: 'refresh-1',
    });
  });

  it('moves a Zoom app across with all three of its values', async () => {
    const connector = await makeConnector('zoom');
    await storeCredential({
      orgId: ORG,
      installId: connector.installId,
      displayName: 'Zoom',
      raw: { accountId: 'acct-1', clientId: 'client-1', clientSecret: 'secret-1' },
    });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toHaveLength(1);
    await expect(credentialsInUse(connector, 'zoom')).resolves.toEqual({
      accountId: 'acct-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    });
  });

  it('leaves a connector with no credential platform alone', async () => {
    // The web crawler reads public pages, so there is no platform to move its
    // credential onto and nothing for the backfill to do.
    const connector = await makeConnector('web');
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Web', raw: { token: 'unused-1' } });

    const report = await backfillConnectorCredentials();
    const [source] = await db
      .select()
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.id, connector.sourceId));

    expect(report.moved).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(source?.apiTokenId).toBeNull();
  });

  it('adds nothing on a second run', async () => {
    const connector = await makeConnector('strapi', { baseUrl: 'https://cms.partner.org' });
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    await backfillConnectorCredentials();
    const second = await backfillConnectorCredentials();

    expect(second.moved).toEqual([]);
    await expect(listPlatformCredentials(ORG, 'strapi')).resolves.toHaveLength(1);
  });

  it('reports a Strapi connector with no instance URL, and changes nothing', async () => {
    const connector = await makeConnector('strapi', { collections: ['events'] });
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Partner Strapi', raw: { token: 'strapi-token-aaaa' } });

    const report = await backfillConnectorCredentials();
    const [source] = await db
      .select()
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.id, connector.sourceId));

    expect(report.moved).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ sourceSlug: 'strapi', sourceId: connector.sourceId });
    expect(report.skipped[0]?.reason).toMatch(/Instance URL/);
    // Untouched: still on its own copy, still syncing.
    expect(source?.apiTokenId).toBeNull();
    expect(source?.configJson).toEqual({ collections: ['events'], _connector: 'strapi' });
    await expect(credentialsInUse(connector, 'strapi')).resolves.toMatchObject({ token: 'strapi-token-aaaa' });
  });

  it('reports a Jira connector whose credential has no email', async () => {
    const connector = await makeConnector('jira');
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Acme Jira', raw: { token: 'jira-token-bbbb' } });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/email/i);
  });

  it('reports a connector with no live credential to move', async () => {
    const connector = await makeConnector('hubspot');

    const report = await backfillConnectorCredentials();

    expect(report.skipped).toEqual([
      { orgId: ORG, sourceSlug: 'hubspot', sourceId: connector.sourceId, reason: 'no live credential to move' },
    ]);
  });

  it('ignores a revoked credential rather than moving it back into service', async () => {
    const connector = await makeConnector('hubspot');
    const credentialId = await storeCredential({
      orgId: ORG,
      installId: connector.installId,
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
    const connector = await makeConnector('hubspot');
    const credentialId = await storeCredential({
      orgId: ORG,
      installId: connector.installId,
      displayName: 'Acme HubSpot',
      raw: { token: 'pat-na1-cccc' },
    });
    await db
      .update(sourceCredentialSchema)
      .set({ ciphertext: Buffer.from('not really ciphertext').toString('base64') })
      .where(eq(sourceCredentialSchema.id, credentialId));

    const report = await backfillConnectorCredentials();
    const [source] = await db
      .select()
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.id, connector.sourceId));

    expect(report.moved).toEqual([]);
    expect(report.skipped[0]?.reason).toBe('existing credential could not be decrypted');
    expect(source?.apiTokenId).toBeNull();
  });

  it('moves several connectors in one run, each to its own credential', async () => {
    const strapi = await makeConnector('strapi', { baseUrl: 'https://cms.partner.org' });
    await storeCredential({ orgId: ORG, installId: strapi.installId, displayName: 'Partner Strapi', raw: { token: 'strapi-aaaa' } });
    const hubspot = await makeConnector('hubspot');
    await storeCredential({ orgId: ORG, installId: hubspot.installId, displayName: 'Acme HubSpot', raw: { token: 'pat-na1-cccc' } });

    const report = await backfillConnectorCredentials();

    expect(report.moved.map(moved => moved.sourceSlug).sort()).toEqual(['hubspot', 'strapi']);
    expect(new Set(report.moved.map(moved => moved.apiTokenId)).size).toBe(2);
  });

  it('gives two Strapi connectors a credential each, from their own configs', async () => {
    // The reason the link is per connector row. Both run the `strapi`
    // connector, so both hang off one install — but they were configured
    // against different instances, and folding them onto one credential would
    // point one of them at the other's CMS.
    const staging = await makeConnector('strapi', { baseUrl: 'https://cms.staging.example' }, 'strapi-staging');
    const production = await makeConnector('strapi', { baseUrl: 'https://cms.example' }, 'strapi-production');
    await storeCredential({ orgId: ORG, installId: staging.installId, displayName: 'Strapi', raw: { token: 'strapi-shared' } });

    const report = await backfillConnectorCredentials();

    expect(report.moved).toHaveLength(2);
    expect(new Set(report.moved.map(moved => moved.apiTokenId)).size).toBe(2);
    await expect(credentialsInUse(staging, 'strapi')).resolves.toMatchObject({
      baseUrl: 'https://cms.staging.example',
    });
    await expect(credentialsInUse(production, 'strapi')).resolves.toMatchObject({
      baseUrl: 'https://cms.example',
    });
  });
});

/**
 * The backfill writes the same link `linkSourceToStoredCredential` does, so it
 * owes the same `api_token_exclusive` flag. Left on the column default, a
 * backfilled Jira or Strapi link would sit outside the unique index that stops
 * a second source claiming its credential.
 */
describe('the exclusivity flag the backfill writes', () => {
  it('claims a per-instance credential exclusively', async () => {
    const connector = await makeConnector('strapi', { baseUrl: 'https://cms.partner.org', collections: ['events'] });
    await storeCredential({
      orgId: ORG,
      installId: connector.installId,
      displayName: 'Strapi',
      raw: { token: 'strapi-token-aaaa' },
    });

    await backfillConnectorCredentials();
    const [row] = await db
      .select({ exclusive: knowledgeSourceSchema.apiTokenExclusive })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.id, connector.sourceId));

    expect(row?.exclusive).toBe(true);
  });

  it('leaves an account-wide credential shareable', async () => {
    const connector = await makeConnector('slack');
    await storeCredential({ orgId: ORG, installId: connector.installId, displayName: 'Slack', raw: { token: 'xoxb-1' } });

    await backfillConnectorCredentials();
    const [row] = await db
      .select({ exclusive: knowledgeSourceSchema.apiTokenExclusive })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.id, connector.sourceId));

    expect(row?.exclusive).toBe(false);
  });
});
