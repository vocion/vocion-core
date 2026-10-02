/**
 * `source.connect` (#1028), against PGlite: a source saved from what the
 * person picked, on the login they already made. The rules someone could get
 * wrong: only an admin connects, the config is checked before anything is
 * written, a second run updates instead of duplicating, and nothing reaches
 * the vendor while saving.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, apiTokenSchema, knowledgeSourceSchema, projectSchema, sourceDekSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { sealLoginValues, storeLoginCredential, storePlatformKey } = await import('@/services/ApiTokenService');
const { sourceConnectAction } = await import('./source-connect');

const ORG = 'org_connect_pick';
const ADMIN = 'user_connect_admin';
const MEMBER = 'user_connect_member';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-connect-pick', name: 'Northwind', slug: 'northwind-pick' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-connect-pick', slug: 'northwind', name: 'Northwind' });
  await db.insert(userSchema).values([
    { id: ADMIN, email: 'admin@northwind.example' },
    { id: MEMBER, email: 'member@northwind.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-connect-pick', userId: ADMIN, role: 'admin' },
    { accountId: 'acct-connect-pick', userId: MEMBER, role: 'member' },
  ]);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

async function seedLogin(platform: 'github' | 'jira' = 'github') {
  const values = { installationId: '42' };
  const sealed = await sealLoginValues(ORG, values);
  const stored = await storeLoginCredential({ orgId: ORG, platform, name: `${platform} login`, account: 'northwind', values, sealed, createdBy: ADMIN });
  return stored.id;
}

async function sources() {
  return db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
}

const asAdmin = { orgId: ORG, reviewedBy: ADMIN };
const githubPick = { connector: 'github', config: { repos: ['northwind/portal'] } };

describe('source.connect', () => {
  it('creates the source from the pick, linked to the login row', async () => {
    const loginId = await seedLogin();
    const result = await sourceConnectAction.execute(asAdmin, githubPick);
    const rows = await sources();

    expect(result).toMatchObject({ created: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ apiTokenId: loginId, apiTokenExclusive: false });
    expect(rows[0]!.configJson).toMatchObject({ repos: ['northwind/portal'], _connector: 'github' });
  });

  it('refuses at proposal time when the person has not logged in', async () => {
    expect(await sourceConnectAction.precheck!(asAdmin, githubPick)).toBe('Log in to GitHub first');
    expect(await sourceConnectAction.precheck!(asAdmin, { connector: 'nope', config: {} })).toBe('nope isn\'t a connector this workspace can add');
  });

  it('refuses a config the connector rejects, naming the field, and saves nothing', async () => {
    await seedLogin('jira');
    const bad = { connector: 'jira', config: { baseUrl: 'https://northwind.atlassian.net', projectKeys: [] } };

    await expect(sourceConnectAction.execute(asAdmin, bad)).rejects.toThrow(/projectKeys/);
    expect(await sourceConnectAction.precheck!(asAdmin, bad)).toMatch(/projectKeys/);
    expect(await sources()).toHaveLength(0);
  });

  it('refuses a member, and no source exists afterwards', async () => {
    await seedLogin();

    await expect(sourceConnectAction.execute({ orgId: ORG, reviewedBy: MEMBER }, githubPick)).rejects.toThrow('Only a workspace admin can connect a source');
    expect(await sources()).toHaveLength(0);
  });

  it('the person who approved decides, not the agent that proposed', async () => {
    await seedLogin();

    await expect(sourceConnectAction.execute({ orgId: ORG, invokedBy: ADMIN, reviewedBy: MEMBER }, githubPick)).rejects.toThrow('Only a workspace admin');
  });

  it('running the same pick twice leaves one source and reports the second as an update', async () => {
    await seedLogin();
    const first = await sourceConnectAction.execute(asAdmin, githubPick);
    const second = await sourceConnectAction.execute(asAdmin, { connector: 'github', config: { repos: ['northwind/portal', 'northwind/api'] } });

    expect(await sources()).toHaveLength(1);
    expect(second).toMatchObject({ created: false, sourceId: first.sourceId, before: { repos: ['northwind/portal'] } });
    expect((await sources())[0]!.configJson).toMatchObject({ repos: ['northwind/portal', 'northwind/api'] });
  });

  it('undo deletes a fresh source, restores an updated one, and refuses once it has synced', async () => {
    await seedLogin();
    const fresh = await sourceConnectAction.execute(asAdmin, githubPick);
    await sourceConnectAction.undo!(asAdmin, githubPick, fresh);

    expect(await sources()).toHaveLength(0);

    const created = await sourceConnectAction.execute(asAdmin, githubPick);
    const wider = { connector: 'github', config: { repos: ['northwind/api'] } };
    const updated = await sourceConnectAction.execute(asAdmin, wider);
    await sourceConnectAction.undo!(asAdmin, wider, updated);

    expect((await sources())[0]!.configJson).toMatchObject({ repos: ['northwind/portal'] });

    await db.update(knowledgeSourceSchema).set({ lastSyncedAt: new Date() }).where(eq(knowledgeSourceSchema.id, created.sourceId as number));

    await expect(sourceConnectAction.undo!(asAdmin, githubPick, created)).rejects.toThrow('It has synced since; remove it from Connectors instead');
    expect(await sources()).toHaveLength(1);
  });

  it('links through the pasted key when the person pasted one instead of logging in', async () => {
    const pasted = await storePlatformKey({ orgId: ORG, platform: 'github', name: 'pat', apiKey: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', createdBy: ADMIN });
    await sourceConnectAction.execute(asAdmin, githubPick);

    expect((await sources())[0]).toMatchObject({ apiTokenId: pasted.id });
  });

  it('never calls the network while saving', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await seedLogin();
    await sourceConnectAction.execute(asAdmin, githubPick);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('card names the connector and each picked field', async () => {
    const card = await sourceConnectAction.reviewCard!(asAdmin, githubPick);

    expect(card.title).toBe('Connect GitHub');
    expect(card.fields).toContainEqual({ label: 'Repositories', value: 'northwind/portal' });
  });
});
