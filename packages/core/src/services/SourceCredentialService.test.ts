/**
 * Credential vault bridge against PGlite. Verifies the store→encrypt→DB→
 * decrypt→get round-trip, that the DB only ever holds ciphertext, and that a
 * revoked credential is not resolved.
 *
 * The vault is stubbed to a self-contained AES-256-GCM fake (the real cipher
 * helpers, a fixed test key, a real `source_dek` row to satisfy the FK) so the
 * test exercises this service's store/get/revoke logic against real tables
 * without `buildCredentialVault`'s env-based `require` (which vitest can't
 * resolve). localVault's DEK mechanics have their own integration suite.
 */
import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let testDekId = 0;
const TEST_KEY = Buffer.alloc(32, 7);

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
  projectSchema,
  sourceCredentialSchema,
  sourceDekSchema,
  sourceInstallSchema,
  tenantAccountSchema,
} = await import('@/models/Schema');
const {
  connectorHoldingCredential,
  credentialIdsInUse,
  credentialStatusForOrg,
  CredentialInUseError,
  getCredentialsForConnector,
  getCredentialsForSource,
  linkSourceToStoredCredential,
  storeCredential,
  storedCredentialIdForSource,
} = await import('@/services/SourceCredentialService');
const { listPlatformCredentials, rotatePlatformCredential, revokeToken, storePlatformKey } = await import('@/services/ApiTokenService');

const ORG = 'org_cred_test';

async function makeInstall(slug: string): Promise<number> {
  const [row] = await db
    .insert(sourceInstallSchema)
    .values({ orgId: ORG, sourceSlug: slug, installedBy: 'tester' })
    .returning({ id: sourceInstallSchema.id });
  return row!.id;
}

/**
 * One connector row, the unit a stored credential is named by.
 * @param connectorSlug - Which connector it runs, e.g. `strapi`.
 * @param sourceSlug - The row's own slug, when it differs from the connector's.
 */
async function makeConnector(connectorSlug: string, sourceSlug: string = connectorSlug): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug: sourceSlug, kind: 'plugin', configJson: { _connector: connectorSlug } })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

/**
 * What a connector resolves at sync time, the way `runSync` asks for it.
 * @param sourceId
 * @param connectorSlug
 */
async function credentialsInUse(sourceId: number, connectorSlug: string): Promise<unknown> {
  const [source] = await db
    .select({ apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.id, sourceId));
  return getCredentialsForConnector({ orgId: ORG, connectorSlug, apiTokenId: source?.apiTokenId ?? null });
}

beforeEach(async () => {
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  // `knowledge_source.api_token_id` is `on delete restrict`, so the connector
  // rows go before the credentials they name.
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  const [dek] = await db
    .insert(sourceDekSchema)
    .values({ orgId: ORG, wrappedDek: 'test', algorithm: 'AES_256_GCM' })
    .returning({ id: sourceDekSchema.id });
  testDekId = dek!.id;
  // `ensureInstall` defaults an install's project to the org id, and
  // `source_install.project_id` is a real foreign key, so the row has to exist.
  await db.insert(tenantAccountSchema).values({ id: ORG, name: 'Cred Test', slug: 'cred-test' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ORG, slug: 'cred-test', name: 'Cred Test' });
});

afterAll(async () => {
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  // `knowledge_source.api_token_id` is `on delete restrict`, so the connector
  // rows go before the credentials they name.
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('SourceCredentialService', () => {
  it('round-trips credentials and stores only ciphertext', async () => {
    const installId = await makeInstall('hubspot');
    const raw = { token: 'pat-na1-supersecret', developerToken: 'dev-123' };
    const credId = await storeCredential({ orgId: ORG, installId, displayName: 'chris@metacto.com', raw });

    const [row] = await db.select().from(sourceCredentialSchema).where(eq(sourceCredentialSchema.id, credId));

    expect(row!.ciphertext).not.toContain('supersecret');
    expect(row!.nonce).toBeTruthy();
    expect(row!.authTag).toBeTruthy();

    const resolved = await getCredentialsForSource(ORG, 'hubspot');

    expect(resolved).toEqual(raw);
  });

  it('returns undefined when the source has no install', async () => {
    expect(await getCredentialsForSource(ORG, 'never-installed')).toBeUndefined();
  });

  it('does not resolve a revoked credential', async () => {
    const installId = await makeInstall('gmail');
    const credId = await storeCredential({ orgId: ORG, installId, displayName: 'inbox', raw: { token: 'abc' } });
    await db.update(sourceCredentialSchema).set({ revokedAt: new Date() }).where(eq(sourceCredentialSchema.id, credId));

    expect(await getCredentialsForSource(ORG, 'gmail')).toBeUndefined();
  });
});

describe('a connector pointing at a stored credential', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('resolves the stored credential instead of asking for the key again', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });

    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(credentialsInUse(sourceId, 'strapi')).resolves.toEqual(STRAPI);
  });

  it('uses the new value after a rotation, with no change to the connector', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    await rotatePlatformCredential({
      orgId: ORG,
      tokenId: credential.id,
      values: { baseUrl: STRAPI.baseUrl, token: 'strapi-token-rotated' },
    });

    await expect(credentialsInUse(sourceId, 'strapi')).resolves.toEqual({
      baseUrl: STRAPI.baseUrl,
      token: 'strapi-token-rotated',
    });
  });

  it('gives two connectors of one kind a credential each', async () => {
    // The reason the link is on the connector row: a workspace runs a Strapi
    // against staging and another against production, and each has to
    // authenticate against its own instance.
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const stagingKey = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — staging',
      platform: 'strapi',
      values: { baseUrl: 'https://cms.staging.example', token: 'strapi-staging-key' },
    });
    const productionKey = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — production',
      platform: 'strapi',
      values: { baseUrl: 'https://cms.example', token: 'strapi-production-key' },
    });

    await linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: stagingKey.id });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: production, connectorSlug: 'strapi', apiTokenId: productionKey.id });

    await expect(credentialsInUse(staging, 'strapi')).resolves.toMatchObject({ token: 'strapi-staging-key' });
    await expect(credentialsInUse(production, 'strapi')).resolves.toMatchObject({ token: 'strapi-production-key' });
  });

  it('leaves the other connector alone when one of the two is revoked', async () => {
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const stagingKey = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — staging',
      platform: 'strapi',
      values: { baseUrl: 'https://cms.staging.example', token: 'strapi-staging-key' },
    });
    const productionKey = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — production',
      platform: 'strapi',
      values: { baseUrl: 'https://cms.example', token: 'strapi-production-key' },
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: stagingKey.id });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: production, connectorSlug: 'strapi', apiTokenId: productionKey.id });

    await revokeToken(ORG, stagingKey.id);

    await expect(credentialsInUse(staging, 'strapi')).rejects.toThrow(/was revoked/);
    await expect(credentialsInUse(production, 'strapi')).resolves.toMatchObject({ token: 'strapi-production-key' });
  });

  it('reports a revoked credential as broken rather than as no credential', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });
    await revokeToken(ORG, credential.id);

    await expect(credentialsInUse(sourceId, 'strapi')).rejects.toThrow(/was revoked/);
  });

  it('reports an expired credential as broken', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
      expiresAt: new Date(Date.now() - 1000),
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(credentialsInUse(sourceId, 'strapi')).rejects.toThrow(/has expired/);
  });

  it('ignores a leftover per-install copy once the connector points at a stored credential', async () => {
    // A migrated connector may still have its old `source_credential` row. The
    // stored credential is the one that rotates, so it has to win.
    const sourceId = await makeConnector('strapi');
    const installId = await makeInstall('strapi');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });
    await storeCredential({ orgId: ORG, installId, displayName: 'old copy', raw: { token: 'stale-token' } });

    await expect(credentialsInUse(sourceId, 'strapi')).resolves.toEqual(STRAPI);
  });

  it('refuses a credential belonging to a different platform', async () => {
    const sourceId = await makeConnector('strapi');
    const hubspot = await storePlatformKey({
      orgId: ORG,
      name: 'Acme HubSpot',
      platform: 'hubspot',
      apiKey: 'pat-na1-hubspot-token',
    });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId,
      connectorSlug: 'strapi',
      apiTokenId: hubspot.id,
    })).rejects.toThrow(/belongs to hubspot/);
  });

  it('refuses a connector that does not authenticate with a stored credential', async () => {
    // The web crawler reads public pages, so there is no credential for a
    // connector row to point at.
    const sourceId = await makeConnector('web');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId,
      connectorSlug: 'web',
      apiTokenId: credential.id,
    })).rejects.toThrow(/does not authenticate with a stored API credential/);
  });

  it('refuses a credential that does not exist', async () => {
    const sourceId = await makeConnector('strapi');

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId,
      connectorSlug: 'strapi',
      apiTokenId: 'nosuchcredential',
    })).rejects.toThrow(/does not exist/);
  });

  it('refuses another org\'s credential', async () => {
    const sourceId = await makeConnector('strapi');
    const theirs = await storePlatformKey({
      orgId: 'org_somebody_else',
      name: 'Their Strapi',
      platform: 'strapi',
      values: STRAPI,
    });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId,
      connectorSlug: 'strapi',
      apiTokenId: theirs.id,
    })).rejects.toThrow(/does not exist/);
  });

  it('refuses a credential another connector already uses', async () => {
    // One credential, one connector. A key is issued for the single instance
    // or account its connector talks to, so a second connector naming it is a
    // mis-pick — and revoking it would take down a connector nobody was
    // looking at.
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — staging',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId: production,
      connectorSlug: 'strapi',
      apiTokenId: credential.id,
    })).rejects.toThrow(CredentialInUseError);
  });

  it('names the connector holding the credential, so the refusal can be acted on', async () => {
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — staging',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId: production,
      connectorSlug: 'strapi',
      apiTokenId: credential.id,
    })).rejects.toThrow(/strapi-staging connector already uses that credential/);
  });

  it('lets a connector re-pick the credential it already uses', async () => {
    // Saving the form again without changing the pick must not read as two
    // connectors competing for one credential.
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId,
      connectorSlug: 'strapi',
      apiTokenId: credential.id,
    })).resolves.toBeUndefined();
  });

  it('refuses a credential another org\'s connector holds only as not existing', async () => {
    // The credential lookup is org-scoped, so a cross-org id never reaches the
    // in-use check — and the message must not confirm that somebody else's
    // connector uses it.
    const sourceId = await makeConnector('strapi');
    const theirs = await storePlatformKey({
      orgId: 'org_somebody_else',
      name: 'Their Strapi',
      platform: 'strapi',
      values: STRAPI,
    });
    await db
      .insert(knowledgeSourceSchema)
      .values({ orgId: 'org_somebody_else', slug: 'strapi', kind: 'plugin', configJson: {}, apiTokenId: theirs.id });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId,
      connectorSlug: 'strapi',
      apiTokenId: theirs.id,
    })).rejects.toThrow(/does not exist/);
  });

  it('refuses to link a connector belonging to another org', async () => {
    const [theirSource] = await db
      .insert(knowledgeSourceSchema)
      .values({ orgId: 'org_somebody_else', slug: 'strapi', kind: 'plugin', configJson: { _connector: 'strapi' } })
      .returning({ id: knowledgeSourceSchema.id });
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId: theirSource!.id,
      connectorSlug: 'strapi',
      apiTokenId: credential.id,
    })).rejects.toThrow(/not found for org/);
  });
});

describe('credentialStatusForOrg', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('shows a linked connector as connected and not broken', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: STRAPI });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    const status = await credentialStatusForOrg(ORG);

    expect(status.bySourceId[sourceId]?.connected).toBe(true);
    expect(status.bySourceId[sourceId]?.broken).toBeNull();
  });

  it('shows a revoked credential as broken, not as awaiting connection', async () => {
    // The distinction the badge needs: this connector does not need a key
    // pasted, it needs the key it already names put back in service.
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: STRAPI });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });
    await revokeToken(ORG, credential.id);

    const status = await credentialStatusForOrg(ORG);

    expect(status.bySourceId[sourceId]).toMatchObject({ connected: false, broken: 'revoked' });
  });

  it('shows an expired credential as broken', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
      expiresAt: new Date(Date.now() - 1000),
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    const status = await credentialStatusForOrg(ORG);

    expect(status.bySourceId[sourceId]).toMatchObject({ connected: false, broken: 'expired' });
  });

  it('answers each of two connectors of one kind separately', async () => {
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const stagingKey = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — staging',
      platform: 'strapi',
      values: { baseUrl: 'https://cms.staging.example', token: 'strapi-staging-key' },
    });
    const productionKey = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — production',
      platform: 'strapi',
      values: { baseUrl: 'https://cms.example', token: 'strapi-production-key' },
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: stagingKey.id });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: production, connectorSlug: 'strapi', apiTokenId: productionKey.id });
    await revokeToken(ORG, stagingKey.id);

    const status = await credentialStatusForOrg(ORG);

    expect(status.bySourceId[staging]).toMatchObject({ connected: false, broken: 'revoked' });
    expect(status.bySourceId[production]).toMatchObject({ connected: true, broken: null });
  });

  it('still answers an OAuth install from its own credential row', async () => {
    const installId = await makeInstall('gmail');
    await storeCredential({ orgId: ORG, installId, displayName: 'inbox', raw: { token: 'abc' } });

    const status = await credentialStatusForOrg(ORG);

    expect(status.byConnectorSlug.gmail).toMatchObject({ connected: true, broken: null });
  });

  it('leaves a connector nobody has connected out of both maps', async () => {
    const sourceId = await makeConnector('strapi');

    const status = await credentialStatusForOrg(ORG);

    expect(status.bySourceId[sourceId]).toBeUndefined();
    expect(status.byConnectorSlug.strapi).toBeUndefined();
  });
});

describe('credentialIdsInUse', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('lists a credential another connector holds, so setup can leave it out', async () => {
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STRAPI });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(credentialIdsInUse(ORG, production)).resolves.toEqual([credential.id]);
  });

  it('leaves out the asking connector\'s own credential, which is its current pick', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: STRAPI });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(credentialIdsInUse(ORG, sourceId)).resolves.toEqual([]);
    await expect(credentialIdsInUse(ORG)).resolves.toEqual([credential.id]);
  });

  it('says nothing is in use when no connector names a credential', async () => {
    await makeConnector('strapi');

    await expect(credentialIdsInUse(ORG)).resolves.toEqual([]);
  });

  it('ignores another org\'s connectors', async () => {
    const theirs = await storePlatformKey({ orgId: 'org_somebody_else', name: 'Their Strapi', platform: 'strapi', values: STRAPI });
    await db
      .insert(knowledgeSourceSchema)
      .values({ orgId: 'org_somebody_else', slug: 'strapi', kind: 'plugin', configJson: {}, apiTokenId: theirs.id });

    await expect(credentialIdsInUse(ORG)).resolves.toEqual([]);
  });
});

describe('the database rule behind it', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('refuses a second connector on one credential even when the service is bypassed', async () => {
    // The service's own check is for the message. This is the rule: two people
    // picking the same credential at once both pass that check, and the index
    // is what stops the second write.
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STRAPI });
    await db
      .update(knowledgeSourceSchema)
      .set({ apiTokenId: credential.id, apiTokenExclusive: true })
      .where(eq(knowledgeSourceSchema.id, staging));

    // Asserted on SQLSTATE rather than on the message, because the driver
    // wraps the message and `isUniqueViolation` reads the code too.
    const refusal = await db
      .update(knowledgeSourceSchema)
      .set({ apiTokenId: credential.id, apiTokenExclusive: true })
      .where(eq(knowledgeSourceSchema.id, production))
      .then(() => null, (error: unknown) => error);

    expect(refusal).not.toBeNull();
    expect((refusal as { cause?: { code?: string } })?.cause?.code ?? (refusal as { code?: string })?.code).toBe('23505');
  });

  it('lets any number of connectors name no credential at all', async () => {
    // The index is partial, so the connectors using none are not all
    // competing for one null.
    await makeConnector('web', 'web-docs');
    await makeConnector('web', 'web-blog');

    const [count] = await db
      .select({ apiTokenId: knowledgeSourceSchema.apiTokenId })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.slug, 'web-blog'));

    expect(count?.apiTokenId).toBeNull();
  });
});

describe('connectorHoldingCredential', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('names the connector using a credential, so a caller can refuse before writing', async () => {
    // What rotation asks. Without it, rotating would replace the value of a
    // credential another connector depends on and only then refuse.
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — staging', platform: 'strapi', values: STRAPI });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(connectorHoldingCredential(ORG, credential.id, production)).resolves.toBe('strapi-staging');
  });

  it('says nobody holds it when the asking connector is the one holding it', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: STRAPI });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    await expect(connectorHoldingCredential(ORG, credential.id, sourceId)).resolves.toBeNull();
  });

  it('says nobody holds a free credential', async () => {
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — spare', platform: 'strapi', values: STRAPI });

    await expect(connectorHoldingCredential(ORG, credential.id)).resolves.toBeNull();
  });
});

describe('resolving by slug, for callers that hold only a slug', () => {
  const HUBSPOT = { token: 'pat-na1-hubspot' };

  it('finds the credential when the row is named after its connector', async () => {
    const sourceId = await makeConnector('hubspot');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Acme HubSpot', platform: 'hubspot', values: HUBSPOT });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'hubspot', apiTokenId: credential.id });

    await expect(getCredentialsForSource(ORG, 'hubspot')).resolves.toEqual(HUBSPOT);
  });

  it('finds it when the row is named something else and only runs that connector', async () => {
    // An action declares a connector slug (`hubspot`), not a connector row, so
    // it asks by a name no row carries. Falling through to the copy in
    // `source_credential` would have it authenticate with the old key while
    // every sync used the rotated one.
    const sourceId = await makeConnector('hubspot', 'hubspot-deals');
    const installId = await makeInstall('hubspot');
    await storeCredential({ orgId: ORG, installId, displayName: 'old copy', raw: { token: 'stale-token' } });
    const credential = await storePlatformKey({ orgId: ORG, name: 'Acme HubSpot', platform: 'hubspot', values: HUBSPOT });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'hubspot', apiTokenId: credential.id });

    await expect(getCredentialsForSource(ORG, 'hubspot')).resolves.toEqual(HUBSPOT);
  });

  it('picks the oldest of several rows running that connector, so the answer is stable', async () => {
    const first = await makeConnector('hubspot', 'hubspot-deals');
    const second = await makeConnector('hubspot', 'hubspot-contacts');
    const firstKey = await storePlatformKey({ orgId: ORG, name: 'HubSpot — deals', platform: 'hubspot', values: { token: 'pat-na1-first' } });
    const secondKey = await storePlatformKey({ orgId: ORG, name: 'HubSpot — contacts', platform: 'hubspot', values: { token: 'pat-na1-second' } });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: second, connectorSlug: 'hubspot', apiTokenId: secondKey.id });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: first, connectorSlug: 'hubspot', apiTokenId: firstKey.id });

    await expect(getCredentialsForSource(ORG, 'hubspot')).resolves.toEqual({ token: 'pat-na1-first' });
  });

  it('still falls back to the install copy when no row names a credential', async () => {
    // A connector nobody has migrated yet, and every OAuth connector.
    await makeConnector('gmail');
    const installId = await makeInstall('gmail');
    await storeCredential({ orgId: ORG, installId, displayName: 'inbox', raw: { token: 'grant-token' } });

    await expect(getCredentialsForSource(ORG, 'gmail')).resolves.toEqual({ token: 'grant-token' });
  });

  it('ignores another org\'s connector running the same connector', async () => {
    const theirKey = await storePlatformKey({ orgId: 'org_somebody_else', name: 'Their HubSpot', platform: 'hubspot', values: { token: 'pat-na1-theirs' } });
    await db
      .insert(knowledgeSourceSchema)
      .values({ orgId: 'org_somebody_else', slug: 'hubspot-theirs', kind: 'plugin', configJson: { _connector: 'hubspot' }, apiTokenId: theirKey.id });

    await expect(getCredentialsForSource(ORG, 'hubspot')).resolves.toBeUndefined();
  });
});

describe('the index refusing a link the pre-check let through', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('reports it as in use rather than as a database failure', async () => {
    // The pre-check is org-scoped; the index is not. So a credential this org
    // owns but another org's connector row holds gets past the check and is
    // refused by the index — the same path a genuine race takes, and the
    // reason the refusal is translated rather than rethrown.
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: STRAPI });
    await db
      .insert(knowledgeSourceSchema)
      .values({
        orgId: 'org_somebody_else',
        slug: 'strapi-theirs',
        kind: 'plugin',
        configJson: {},
        apiTokenId: credential.id,
        apiTokenExclusive: true,
      });

    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId,
      connectorSlug: 'strapi',
      apiTokenId: credential.id,
    })).rejects.toThrow(CredentialInUseError);
  });

  it('leaves the connector unlinked when it does', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: STRAPI });
    await db
      .insert(knowledgeSourceSchema)
      .values({ orgId: 'org_somebody_else', slug: 'strapi-theirs', kind: 'plugin', configJson: {}, apiTokenId: credential.id, apiTokenExclusive: true });

    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id })
      .catch(() => undefined);

    await expect(storedCredentialIdForSource(ORG, sourceId)).resolves.toBeNull();
  });

  it('never lets two connectors end up on one credential, whichever path refuses', async () => {
    // The outcome both paths exist to guarantee, asserted without caring which
    // of the two produced it.
    const staging = await makeConnector('strapi', 'strapi-staging');
    const production = await makeConnector('strapi', 'strapi-production');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi', platform: 'strapi', values: STRAPI });

    const attempts = await Promise.allSettled([
      linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: credential.id }),
      linkSourceToStoredCredential({ orgId: ORG, sourceId: production, connectorSlug: 'strapi', apiTokenId: credential.id }),
    ]);
    const holders = await db
      .select({ id: knowledgeSourceSchema.id })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.apiTokenId, credential.id));

    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(holders).toHaveLength(1);
  });
});

describe('a credential whose connector is deleted', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('becomes free for another connector to use', async () => {
    // Deleting a connector must not strand its credential. Somebody removing
    // a Strapi and adding it back should be offered the key they already
    // typed, not told it is in use by a connector that no longer exists.
    const first = await makeConnector('strapi', 'strapi-old');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi', platform: 'strapi', values: STRAPI });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: first, connectorSlug: 'strapi', apiTokenId: credential.id });

    await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, first));
    const replacement = await makeConnector('strapi', 'strapi-new');

    await expect(credentialIdsInUse(ORG)).resolves.toEqual([]);
    await expect(linkSourceToStoredCredential({
      orgId: ORG,
      sourceId: replacement,
      connectorSlug: 'strapi',
      apiTokenId: credential.id,
    })).resolves.toBeUndefined();
  });

  it('survives the delete, because the credential is the workspace\'s and not the connector\'s', async () => {
    const sourceId = await makeConnector('strapi');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi', platform: 'strapi', values: STRAPI });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: credential.id });

    await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, sourceId));

    await expect(listPlatformCredentials(ORG, 'strapi')).resolves.toHaveLength(1);
  });
});

/**
 * The other half of the exclusivity rule. A credential issued for one place
 * belongs to one source; an account-wide grant is meant to be held by several,
 * and making a workspace paste the same Slack bot token once per channel was
 * the thing that made the API tokens page not worth using for these connectors.
 */
describe('a credential several sources may share', () => {
  const SLACK = { token: 'xoxb-shared-token' };
  const GOOGLE = {
    clientId: 'client-1.apps.googleusercontent.com',
    clientSecret: 'secret-1',
    refreshToken: 'refresh-1',
  };

  it('lets two Slack sources hold one bot token', async () => {
    // One source syncs one channel, and one bot token reads them all.
    const support = await makeConnector('slack', 'slack-support');
    const sales = await makeConnector('slack', 'slack-sales');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Slack', platform: 'slack', values: SLACK });

    await linkSourceToStoredCredential({ orgId: ORG, sourceId: support, connectorSlug: 'slack', apiTokenId: credential.id });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: sales, connectorSlug: 'slack', apiTokenId: credential.id });

    await expect(storedCredentialIdForSource(ORG, support)).resolves.toBe(credential.id);
    await expect(storedCredentialIdForSource(ORG, sales)).resolves.toBe(credential.id);
  });

  it('serves every Google connector from the one Google credential', async () => {
    // One OAuth consent covers all of them, which is the reason `google` is a
    // single platform rather than five.
    const mail = await makeConnector('gmail', 'gmail-inbox');
    const files = await makeConnector('drive', 'drive-shared');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Google', platform: 'google', values: GOOGLE });

    await linkSourceToStoredCredential({ orgId: ORG, sourceId: mail, connectorSlug: 'gmail', apiTokenId: credential.id });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId: files, connectorSlug: 'drive', apiTokenId: credential.id });

    await expect(credentialsInUse(mail, 'gmail')).resolves.toMatchObject({ refreshToken: 'refresh-1' });
    await expect(credentialsInUse(files, 'drive')).resolves.toMatchObject({ refreshToken: 'refresh-1' });
  });

  it('does not mark a shared link exclusive, so the index leaves it alone', async () => {
    const support = await makeConnector('slack', 'slack-support');
    const credential = await storePlatformKey({ orgId: ORG, name: 'Slack', platform: 'slack', values: SLACK });

    await linkSourceToStoredCredential({ orgId: ORG, sourceId: support, connectorSlug: 'slack', apiTokenId: credential.id });

    const [row] = await db
      .select({ exclusive: knowledgeSourceSchema.apiTokenExclusive })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.id, support));

    expect(row?.exclusive).toBe(false);
  });

  it('marks a per-instance link exclusive, so the index still refuses a second', async () => {
    const staging = await makeConnector('strapi', 'strapi-staging');
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — staging',
      platform: 'strapi',
      values: { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' },
    });

    await linkSourceToStoredCredential({ orgId: ORG, sourceId: staging, connectorSlug: 'strapi', apiTokenId: credential.id });

    const [row] = await db
      .select({ exclusive: knowledgeSourceSchema.apiTokenExclusive })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.id, staging));

    expect(row?.exclusive).toBe(true);
  });
});
