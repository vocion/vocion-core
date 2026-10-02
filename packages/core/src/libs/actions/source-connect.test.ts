/**
 * `source.connect` (#1080), against PGlite: a source saved from what the
 * person picked, on the login they already made. The rules someone could get
 * wrong: only an admin connects, the config is checked before anything is
 * written, a second run updates instead of duplicating, and nothing reaches
 * the vendor while saving.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/SourceCredentialService')>();
  return { ...original, linkSourceToStoredCredential: vi.fn(original.linkSourceToStoredCredential) };
});

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, apiTokenSchema, knowledgeSourceSchema, projectSchema, sourceDekSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { sealLoginValues, storeLoginCredential, storePlatformKey } = await import('@/services/ApiTokenService');
const { linkSourceToStoredCredential } = await import('@/services/SourceCredentialService');
const { createSourceOnLogin } = await import('@/services/connect/createSourceOnLogin');
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

async function seedGithubSource(slug: string, repos: string[]) {
  const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug, kind: 'plugin', configJson: { repos, _connector: 'github' } }).returning();
  return row!;
}

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

  it('adds the pick to the source\'s existing repositories and never drops one; undo puts the old list back', async () => {
    await seedLogin();
    const existing = await seedGithubSource('github-old', ['northwind/api']);
    const result = await sourceConnectAction.execute(asAdmin, githubPick);

    expect(result).toMatchObject({ created: false, sourceId: existing.id });
    expect((await sources())[0]!.configJson).toMatchObject({ repos: ['northwind/api', 'northwind/portal'] });

    await sourceConnectAction.undo!(asAdmin, githubPick, result);

    expect((await sources())[0]!.configJson).toMatchObject({ repos: ['northwind/api'] });
  });

  it('refuses to guess between several sources of the connector, and an explicit sourceSlug picks one', async () => {
    await seedLogin();
    await seedGithubSource('github-a', ['northwind/a']);
    const second = await seedGithubSource('github-b', ['northwind/b']);

    expect(await sourceConnectAction.precheck!(asAdmin, githubPick)).toBe('GitHub has 2 sources (github-a, github-b); say which one with sourceSlug');
    await expect(sourceConnectAction.execute(asAdmin, githubPick)).rejects.toThrow('say which one with sourceSlug');

    const result = await sourceConnectAction.execute(asAdmin, { ...githubPick, sourceSlug: 'github-b' });

    expect(result).toMatchObject({ sourceId: second.id, created: false });
    expect((await sources()).find(row => row.slug === 'github-a')!.configJson).toMatchObject({ repos: ['northwind/a'] });
  });

  it('refuses a sourceSlug that is not a source of this connector', async () => {
    await seedLogin();

    expect(await sourceConnectAction.precheck!(asAdmin, { ...githubPick, sourceSlug: 'nope' })).toContain('nope');
  });

  it('a failed credential link leaves no new source and no changed config, and returns the original reason', async () => {
    const pasted = await storePlatformKey({ orgId: ORG, platform: 'github', name: 'pat', apiKey: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', createdBy: ADMIN });
    vi.mocked(linkSourceToStoredCredential).mockRejectedValueOnce(new Error('link exploded'));

    await expect(sourceConnectAction.execute(asAdmin, githubPick)).rejects.toThrow('link exploded');
    expect(await sources()).toHaveLength(0);

    await seedGithubSource('github-old', ['northwind/api']);
    vi.mocked(linkSourceToStoredCredential).mockRejectedValueOnce(new Error('link exploded'));

    await expect(sourceConnectAction.execute(asAdmin, githubPick)).rejects.toThrow('link exploded');
    expect((await sources())[0]).toMatchObject({ configJson: { repos: ['northwind/api'] }, apiTokenId: null });
    expect(pasted.id).toBeTruthy();
  });

  it('refuses a member at proposal time, before a card exists', async () => {
    await seedLogin();

    expect(await sourceConnectAction.precheck!({ orgId: ORG, invokedBy: MEMBER }, githubPick)).toBe('Only a workspace admin can connect a source');
    expect(await sourceConnectAction.precheck!({ orgId: ORG, invokedBy: ADMIN }, githubPick)).toBeUndefined();
  });

  it('a member cannot undo what an admin connected, and the source is unchanged', async () => {
    await seedLogin();
    await seedGithubSource('github-old', ['northwind/api']);
    const result = await sourceConnectAction.execute(asAdmin, githubPick);

    await expect(sourceConnectAction.undo!({ orgId: ORG, reviewedBy: MEMBER }, githubPick, result)).rejects.toThrow('Only a workspace admin can connect a source');
    expect((await sources())[0]!.configJson).toMatchObject({ repos: ['northwind/api', 'northwind/portal'] });

    await expect(sourceConnectAction.undo!(asAdmin, githubPick, { ...result, sourceId: 'x' })).rejects.toThrow('no source to undo');
  });

  it('createNew adds a second source and leaves the first one\'s config alone', async () => {
    await seedLogin();
    const [first] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'github', kind: 'plugin', configJson: { repos: ['northwind/api'], deployBranch: 'staging', _connector: 'github' } }).returning();

    const added = await createSourceOnLogin({ orgId: ORG, actorUserId: ADMIN, createNew: true, connector: 'github', config: { repos: ['northwind/portal'], deployBranch: 'main' } });
    const third = await createSourceOnLogin({ orgId: ORG, actorUserId: ADMIN, createNew: true, connector: 'github', config: { repos: ['northwind/web'] } });
    const rows = await sources();
    const untouched = rows.find(row => row.id === first!.id)!;

    expect(added).toMatchObject({ ok: true, created: true, slug: 'github-2' });
    expect(third).toMatchObject({ ok: true, created: true, slug: 'github-3' });
    expect(rows).toHaveLength(3);
    expect(untouched.configJson).toEqual({ repos: ['northwind/api'], deployBranch: 'staging', _connector: 'github' });
  });

  it('adding to a source never re-points it: a source on a pasted key stays on it when a login exists', async () => {
    const pasted = await storePlatformKey({ orgId: ORG, platform: 'jira', name: 'Jira key', values: { email: 'dev@northwind.example', apiToken: 'jira-api-token-1234567890' }, createdBy: ADMIN });
    const loginId = await seedLogin('jira');
    const [onPasted] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'jira-pasted', kind: 'plugin', apiTokenId: pasted.id, configJson: { baseUrl: 'https://northwind.atlassian.net', projectKeys: ['OPS'], _connector: 'jira' } }).returning();

    const result = await createSourceOnLogin({ orgId: ORG, actorUserId: ADMIN, connector: 'jira', sourceSlug: 'jira-pasted', config: { baseUrl: 'https://northwind.atlassian.net', projectKeys: ['WEB'] } });

    expect(result).toMatchObject({ ok: true, created: false });

    const [after] = (await sources()).filter(row => row.id === onPasted!.id);

    expect(after!.apiTokenId).toBe(pasted.id);
    expect(after!.configJson).toMatchObject({ projectKeys: ['OPS', 'WEB'] });

    const fresh = await createSourceOnLogin({ orgId: ORG, actorUserId: ADMIN, createNew: true, connector: 'jira', config: { baseUrl: 'https://other.atlassian.net', projectKeys: ['X'] } });
    const [created] = (await sources()).filter(row => row.id === (fresh as { sourceId: number }).sourceId);

    expect(created!.apiTokenId).toBe(loginId);
  });
});
