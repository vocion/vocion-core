/**
 * What a finished login does about the source, against PGlite. A connector
 * that needs nothing more (Slack) gets its source from the login itself; one
 * that needs picks (GitHub repos, a Jira site and keys) is left for the chat
 * or the Connectors form, and an existing source is never doubled.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, apiTokenSchema, knowledgeSourceSchema, projectSchema, sourceDekSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { sealLoginValues, storeLoginCredential } = await import('@/services/ApiTokenService');
const { createSourceWhenNoConfigNeeded } = await import('./createSourceOnLogin');

const ORG = 'org_login_autosource';
const ADMIN = 'user_login_autosource_admin';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-login-autosource', name: 'Northwind', slug: 'northwind-autosource' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-login-autosource', slug: 'northwind-auto', name: 'Northwind' });
  await db.insert(userSchema).values({ id: ADMIN, email: 'admin@autosource.example' });
  await db.insert(accountMembershipSchema).values({ accountId: 'acct-login-autosource', userId: ADMIN, role: 'admin' });
});

afterEach(async () => {
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

async function seedLogin(platform: 'github' | 'slack') {
  const values = { token: 'not-a-real-token' };
  const sealed = await sealLoginValues(ORG, values);
  return (await storeLoginCredential({ orgId: ORG, platform, name: `${platform} login`, account: 'northwind', values, sealed, createdBy: ADMIN })).id;
}

async function sources() {
  return db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
}

describe('createSourceWhenNoConfigNeeded', () => {
  it('creates the source for a connector that needs no picks, linked to the login', async () => {
    const loginId = await seedLogin('slack');

    const result = await createSourceWhenNoConfigNeeded({ orgId: ORG, userId: ADMIN, connector: 'slack', linkedSourceIds: [] });

    expect(result).toEqual({ created: true });
    expect(await sources()).toMatchObject([{ apiTokenId: loginId }]);
  });

  it('leaves a connector that needs repos or a site for the person to pick', async () => {
    await seedLogin('github');

    const result = await createSourceWhenNoConfigNeeded({ orgId: ORG, userId: ADMIN, connector: 'github', linkedSourceIds: [] });

    expect(result).toEqual({ created: false });
    expect(await sources()).toHaveLength(0);
  });

  it('does not add a second source when the login already linked one', async () => {
    await seedLogin('slack');
    const [existing] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'slack', kind: 'plugin', configJson: { _connector: 'slack' } }).returning();

    const result = await createSourceWhenNoConfigNeeded({ orgId: ORG, userId: ADMIN, connector: 'slack', linkedSourceIds: [existing!.id] });

    expect(result).toEqual({ created: false });
    expect(await sources()).toHaveLength(1);
  });
});
