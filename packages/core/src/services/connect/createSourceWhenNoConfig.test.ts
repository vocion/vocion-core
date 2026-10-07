/**
 * What a finished login does about the source, against PGlite. A connector
 * that needs nothing more (Slack) gets its source from the login itself; one
 * that needs picks (GitHub repos, a Jira site and keys) is left for the chat
 * or the Connectors form, and an existing source is never doubled.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// Schedules land in the in-memory scheduler; the first sync is only recorded, so no test runs a connector or reaches a vendor.
vi.mock('@/services/SourceScheduleService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/SourceScheduleService')>();
  return { ...original, startSourceFullSync: vi.fn() };
});
vi.mock('@/services/WorkspaceAccessService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/WorkspaceAccessService')>();
  return { ...original, memberWorkspace: vi.fn(original.memberWorkspace) };
});

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, apiTokenSchema, knowledgeSourceSchema, projectSchema, sourceDekSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { sealLoginValues, storeLoginCredential } = await import('@/services/ApiTokenService');
const { memberWorkspace } = await import('@/services/WorkspaceAccessService');
const { howToConnectFor } = await import('@/libs/platforms/registry');
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
  vi.restoreAllMocks();
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

  it('follows the declaration, not the config schema: a login that declares a setting is left for the person', async () => {
    await seedLogin('slack');
    const login = howToConnectFor('slack')!.login as { settingsAfterLogin: readonly { key: string; label: string }[] };
    const declared = login.settingsAfterLogin;
    login.settingsAfterLogin = [{ key: 'channels', label: 'channels' }];
    try {
      const result = await createSourceWhenNoConfigNeeded({ orgId: ORG, userId: ADMIN, connector: 'slack', linkedSourceIds: [] });

      expect(result).toEqual({ created: false });
      expect(await sources()).toHaveLength(0);
    } finally {
      login.settingsAfterLogin = declared;
    }
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

  it('says so when the source cannot be created: a refused save reports why, and the login row stays', async () => {
    const loginId = await seedLogin('slack');
    await db.insert(knowledgeSourceSchema).values([
      { orgId: ORG, slug: 'slack-a', kind: 'plugin', configJson: { _connector: 'slack' } },
      { orgId: ORG, slug: 'slack-b', kind: 'plugin', configJson: { _connector: 'slack' } },
    ]);

    const result = await createSourceWhenNoConfigNeeded({ orgId: ORG, userId: ADMIN, connector: 'slack', linkedSourceIds: [] });

    expect(result).toEqual({ created: false, failed: expect.stringContaining('2 sources') });
    expect(await sources()).toHaveLength(2);
    expect(await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, loginId))).toHaveLength(1);
  });

  it('says so when the lookup throws, instead of letting the callback 500 after the login was stored', async () => {
    await seedLogin('slack');
    vi.mocked(memberWorkspace).mockResolvedValueOnce({ accountRole: 'admin' } as never);
    vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('database went away');
    });

    const result = await createSourceWhenNoConfigNeeded({ orgId: ORG, userId: ADMIN, connector: 'slack', linkedSourceIds: [] });

    expect(result).toEqual({ created: false, failed: 'The source could not be created.' });
  });
});
