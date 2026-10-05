/**
 * Adding a connector and its credential in one save (#1080), against PGlite.
 * The rules someone could get wrong: the source and its key are written
 * together or not at all, only an admin saves, a kept login is linked and not
 * copied, and a pasted value goes through the same store as every other key.
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
const { sealLoginValues, storeLoginCredential } = await import('@/services/ApiTokenService');
const { linkSourceToStoredCredential } = await import('@/services/SourceCredentialService');
const { createSourceWithCredential } = await import('./createSourceWithCredential');

const ORG = 'org_one_step';
const ADMIN = 'user_one_step_admin';
const MEMBER = 'user_one_step_member';
const PASTED_TOKEN = 'pat-na1-not-a-real-token-0001';
const GITHUB_PAT = 'ghp_notarealtokennotarealtokennotareal01';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-one-step', name: 'Northwind', slug: 'northwind-one-step' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-one-step', slug: 'northwind', name: 'Northwind' });
  await db.insert(userSchema).values([
    { id: ADMIN, email: 'admin@northwind-one-step.example' },
    { id: MEMBER, email: 'member@northwind-one-step.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-one-step', userId: ADMIN, role: 'admin' },
    { accountId: 'acct-one-step', userId: MEMBER, role: 'member' },
  ]);
});

afterEach(async () => {
  vi.mocked(linkSourceToStoredCredential).mockClear();
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

async function seedGithubLogin() {
  const values = { installationId: '42', token: 'ghs_not_a_real_token_abcd' };
  const sealed = await sealLoginValues(ORG, values);
  const stored = await storeLoginCredential({ orgId: ORG, platform: 'github', name: 'github login', account: 'northwind', values, sealed, createdBy: ADMIN });
  return stored.id;
}

async function sources() {
  return db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
}

async function tokens() {
  return db.select().from(apiTokenSchema).where(eq(apiTokenSchema.orgId, ORG));
}

const hubspotPaste = { orgId: ORG, actorUserId: ADMIN, connector: 'hubspot', config: {}, credential: { values: { token: PASTED_TOKEN } } };

describe('createSourceWithCredential', () => {
  it('a pasted value becomes an api_token row for the platform and the new source points at it', async () => {
    const result = await createSourceWithCredential(hubspotPaste);
    const [source] = await sources();
    const [token] = await tokens();

    expect(result).toMatchObject({ ok: true, sourceId: source!.id });
    expect(token).toMatchObject({ platform: 'hubspot', obtainedVia: 'paste', revokedAt: null });
    expect(source).toMatchObject({ apiTokenId: token!.id });
  });

  it('a credential write that fails leaves no source and no key behind', async () => {
    vi.mocked(linkSourceToStoredCredential).mockRejectedValueOnce(new Error('link blew up'));
    const result = await createSourceWithCredential(hubspotPaste);

    expect(result.ok).toBe(false);
    expect(await sources()).toHaveLength(0);
    expect(await tokens()).toHaveLength(0);
  });

  it('refuses a value the platform rejects, with its sentence, and writes nothing', async () => {
    const result = await createSourceWithCredential({ ...hubspotPaste, credential: { values: { token: '   ' } } });

    expect(result).toMatchObject({ ok: false });
    expect(await sources()).toHaveLength(0);
    expect(await tokens()).toHaveLength(0);
  });

  it('refuses a member and writes nothing', async () => {
    const result = await createSourceWithCredential({ ...hubspotPaste, actorUserId: MEMBER });

    expect(result).toEqual({ ok: false, reason: 'Only a workspace admin can connect a source' });
    expect(await sources()).toHaveLength(0);
    expect(await tokens()).toHaveLength(0);
  });

  it('a kept stored login is linked as it is: no new key row, not exclusive', async () => {
    const loginId = await seedGithubLogin();
    const result = await createSourceWithCredential({ orgId: ORG, actorUserId: ADMIN, connector: 'github', config: { repos: ['northwind/portal'] }, credential: { keepStored: true } });

    expect(result).toMatchObject({ ok: true });
    expect(await tokens()).toHaveLength(1);
    expect((await sources())[0]).toMatchObject({ apiTokenId: loginId, apiTokenExclusive: false });
  });

  it('keeping a stored credential when the workspace holds none is refused, and nothing is created', async () => {
    const result = await createSourceWithCredential({ orgId: ORG, actorUserId: ADMIN, connector: 'github', config: { repos: ['northwind/portal'] }, credential: { keepStored: true } });

    expect(result).toMatchObject({ ok: false });
    expect(await sources()).toHaveLength(0);
  });

  it('refuses a config the connector rejects before any key is stored', async () => {
    const result = await createSourceWithCredential({ orgId: ORG, actorUserId: ADMIN, connector: 'jira', config: { baseUrl: 'https://northwind.atlassian.net', projectKeys: [] }, credential: { values: { email: 'a@b.example', apiToken: 'x' } } });

    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/projectKeys/) });
    expect(await tokens()).toHaveLength(0);
  });

  it('a second add on the same connector makes a second source, never merges into the first', async () => {
    await createSourceWithCredential(hubspotPaste);
    await createSourceWithCredential({ ...hubspotPaste, credential: { values: { token: 'pat-na1-not-a-real-token-0002' } } });

    expect(await sources()).toHaveLength(2);
    expect(await tokens()).toHaveLength(2);
  });

  it('a pasted key on a one-key platform is refused while another source uses the saved login, and nothing changes', async () => {
    // GitHub keeps one live key per workspace, so storing the paste would revoke
    // the login, and the source on it would fail its next sync as "revoked".
    const loginId = await seedGithubLogin();
    await createSourceWithCredential({ orgId: ORG, actorUserId: ADMIN, connector: 'github', config: { repos: ['northwind/portal'] }, credential: { keepStored: true } });
    const [portal] = await sources();
    const result = await createSourceWithCredential({ orgId: ORG, actorUserId: ADMIN, connector: 'github', config: { repos: ['northwind/billing'] }, credential: { values: { token: GITHUB_PAT } } });

    expect(result).toEqual({ ok: false, reason: expect.stringContaining(portal!.slug) });
    expect(await sources()).toHaveLength(1);
    expect(await tokens()).toEqual([expect.objectContaining({ id: loginId, revokedAt: null })]);
  });

  it('a pasted key on a one-key platform replaces the saved one when no source uses it', async () => {
    const loginId = await seedGithubLogin();
    const result = await createSourceWithCredential({ orgId: ORG, actorUserId: ADMIN, connector: 'github', config: { repos: ['northwind/billing'] }, credential: { values: { token: GITHUB_PAT } } });
    const rows = await tokens();
    const pasted = rows.find(row => row.obtainedVia === 'paste');

    expect(result).toMatchObject({ ok: true });
    expect(rows.find(row => row.id === loginId)?.revokedAt).not.toBeNull();
    expect((await sources())[0]).toMatchObject({ apiTokenId: pasted!.id });
  });

  it('an edited value of a stored key is saved as a new pasted credential; the stored one stays live and unlinked', async () => {
    const first = await createSourceWithCredential(hubspotPaste);
    const [storedBefore] = await tokens();
    const edited = await createSourceWithCredential({ ...hubspotPaste, credential: { values: { token: `${PASTED_TOKEN}-edited` } } });
    const rows = await tokens();
    const editedSource = (await sources()).find(source => edited.ok && source.id === edited.sourceId)!;

    expect(first.ok && edited.ok).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === storedBefore!.id)).toMatchObject({ revokedAt: null });
    expect(editedSource.apiTokenId).not.toBe(storedBefore!.id);
    expect(rows.find(row => row.id === editedSource.apiTokenId)).toMatchObject({ obtainedVia: 'paste', platform: 'hubspot' });
  });
});
