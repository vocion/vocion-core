/**
 * The one-time move of existing OAuth logins into the credential store (#1028),
 * against PGlite. The rules someone could get wrong: the old `source_credential`
 * row stays live so the move can be undone, a second run adds nothing, and a
 * source the person put on a pasted key is never pulled onto the login.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema, sourceCredentialSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { storeCredentialForSource } = await import('@/services/SourceCredentialService');
const { moveLoginsToCredentialStore } = await import('./moveLogins');

const ORG = 'org_move';
const GITHUB_BAG = { installationId: '42', account: 'northwind', accountType: 'Organization', token: 'ghs_not_a_real_token' };

async function seedSource(slug: string, connector: string, apiTokenId: string | null = null) {
  const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug, kind: 'plugin', configJson: { _connector: connector }, apiTokenId }).returning();
  return row!;
}

async function sourceRow(id: number) {
  const [row] = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, id));
  return row!;
}

async function loginRows() {
  return db.select().from(apiTokenSchema).where(and(eq(apiTokenSchema.orgId, ORG), eq(apiTokenSchema.obtainedVia, 'login')));
}

describe('moveLoginsToCredentialStore', () => {
  beforeAll(async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct-move', name: 'Northwind', slug: 'northwind-move' });
    await db.insert(projectSchema).values(['org_move', 'org_unreadable'].map(id => ({ id, accountId: 'acct-move', slug: id, name: id })));
  });

  it('stores the login once, links every unlinked source non-exclusively, and leaves the old row live', async () => {
    const { credentialId } = await storeCredentialForSource({ orgId: ORG, sourceSlug: 'github', raw: GITHUB_BAG, displayName: 'GitHub - northwind' });
    const first = await seedSource('github-portal', 'github');
    const second = await seedSource('github-api', 'github');

    const report = await moveLoginsToCredentialStore();

    const logins = await loginRows();

    expect(logins).toHaveLength(1);
    expect(report.moved).toEqual([{ orgId: ORG, connector: 'github', tokenId: logins[0]!.id, linkedSourceIds: [first.id, second.id] }]);

    for (const id of [first.id, second.id]) {
      const row = await sourceRow(id);

      expect(row.apiTokenId).toBe(logins[0]!.id);
      expect(row.apiTokenExclusive).toBe(false);
    }
    const [old] = await db.select().from(sourceCredentialSchema).where(eq(sourceCredentialSchema.id, credentialId));

    expect(old!.revokedAt).toBeNull();
  });

  it('a second run moves nothing and inserts nothing', async () => {
    const before = await loginRows();
    const report = await moveLoginsToCredentialStore();

    expect(report.moved).toEqual([]);
    expect(await loginRows()).toHaveLength(before.length);
  });

  it('never relinks a source the person put on a pasted key', async () => {
    const pasted = await storePlatformKey({ orgId: ORG, platform: 'jira', name: 'Jira key', values: { email: 'dev@northwind.example', apiToken: 'jira-api-token-1234567890' }, createdBy: 'user_admin' });
    await storeCredentialForSource({ orgId: ORG, sourceSlug: 'jira', raw: { accessToken: 'a', refreshToken: 'r', cloudId: 'c', siteUrl: 'https://northwind.atlassian.net' } });
    const onPasted = await seedSource('jira-pasted', 'jira', pasted.id);

    await moveLoginsToCredentialStore();

    expect((await sourceRow(onPasted.id)).apiTokenId).toBe(pasted.id);
  });

  it('reports a bag the provider cannot read, naming the connector, and links nothing', async () => {
    await storeCredentialForSource({ orgId: 'org_unreadable', sourceSlug: 'slack', raw: { nothing: 'useful' } });
    await db.insert(knowledgeSourceSchema).values({ orgId: 'org_unreadable', slug: 'slack-general', kind: 'plugin', configJson: { _connector: 'slack' } });

    const report = await moveLoginsToCredentialStore();

    expect(report.skipped.filter(entry => entry.orgId === 'org_unreadable')).toEqual([{ orgId: 'org_unreadable', connector: 'slack', why: expect.any(String) }]);

    const [source] = await db.select().from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, 'org_unreadable'), isNull(knowledgeSourceSchema.apiTokenId)));

    expect(source).toBeDefined();
  });
});
