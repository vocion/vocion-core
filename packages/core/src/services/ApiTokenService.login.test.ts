/**
 * A provider login stored as an `api_token` row (#1028), against PGlite.
 *
 * A login is the provider's bag (an installation id, a refresh token), not a
 * paste, so these tests pin what makes it safe to live next to pasted keys:
 * one row per account across re-logins, the one-live-row rule on platforms
 * that cap it, a refresh that cannot overwrite a newer one, and a bag that is
 * never shown on screen.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const {
  listTokens,
  resolveCredentialById,
  revealPlatformCredential,
  storeLoginCredential,
  storePlatformKey,
  updateLoginCredentialValues,
} = await import('@/services/ApiTokenService');

const ORG = 'org_logins';
const GITHUB_PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

async function clearCredentials(): Promise<void> {
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
}

function slackLogin(account: string, accessToken: string) {
  return storeLoginCredential({
    orgId: ORG,
    platform: 'slack',
    name: `Slack - ${account}`,
    account,
    values: { accessToken, team: account },
    createdBy: 'user_admin',
  });
}

async function storeAtlassianLogin() {
  return storeLoginCredential({
    orgId: ORG,
    platform: 'jira',
    name: 'Jira - northwind.atlassian.net',
    account: 'northwind.atlassian.net',
    values: { accessToken: 'at-1', refreshToken: 'rt-1' },
    createdBy: 'user_admin',
  });
}

beforeEach(clearCredentials);

afterEach(() => {
  vi.useRealTimers();
});

afterAll(clearCredentials);

describe('storeLoginCredential', () => {
  it('stores a first login as a login row the list never offers to reveal', async () => {
    const { id, rotated, replacedIds } = await slackLogin('Northwind', 'xoxb-first-token-1111');

    expect({ rotated, replacedIds }).toEqual({ rotated: false, replacedIds: [] });

    const [row] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, id));

    expect(row).toMatchObject({ obtainedVia: 'login', account: 'Northwind', platform: 'slack', secretHash: null });
    expect(JSON.stringify(row)).not.toContain('xoxb-first-token-1111');

    const [listed] = await listTokens(ORG);

    expect(listed).toMatchObject({ id, obtainedVia: 'login', account: 'Northwind', revealable: false });
  });

  it('rotates the same row in place when the same account logs in again', async () => {
    const first = await slackLogin('Northwind', 'xoxb-first-token-1111');

    const second = await slackLogin('Northwind', 'xoxb-second-token-2222');

    expect(second).toEqual({ id: first.id, replacedIds: [], rotated: true });
    expect(await db.select().from(apiTokenSchema)).toHaveLength(1);
    expect(await resolveCredentialById(ORG, first.id)).toEqual({
      status: 'ok',
      values: { accessToken: 'xoxb-second-token-2222', team: 'Northwind' },
    });
  });

  it('keeps a second row for a different account on a platform that holds many', async () => {
    const northwind = await slackLogin('Northwind', 'xoxb-north-1111');

    const acme = await slackLogin('Acme', 'xoxb-acme-2222');

    expect(acme.id).not.toBe(northwind.id);
    expect(acme.rotated).toBe(false);
    expect(await db.select().from(apiTokenSchema)).toHaveLength(2);
  });

  it('retires a pasted key when a login takes over a platform that holds one live row', async () => {
    const pasted = await storePlatformKey({ orgId: ORG, name: 'Acme GitHub', platform: 'github', apiKey: GITHUB_PAT });

    const login = await storeLoginCredential({
      orgId: ORG,
      platform: 'github',
      name: 'GitHub - northwind',
      account: 'northwind',
      values: { installationId: 4242, account: 'northwind', repositories: ['northwind/portal'] },
      createdBy: 'user_admin',
    });

    expect(login.replacedIds).toEqual([pasted.id]);

    const [old] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, pasted.id));

    expect(old!.revokedAt).not.toBeNull();

    const live = (await listTokens(ORG)).map(row => row.id);

    expect(live).toEqual([login.id]);
  });
});

describe('updateLoginCredentialValues', () => {
  it('writes the refreshed bag while the refresh token is still the one the caller read', async () => {
    const { id } = await storeAtlassianLogin();

    const written = await updateLoginCredentialValues({
      orgId: ORG,
      tokenId: id,
      values: { accessToken: 'at-2', refreshToken: 'rt-2' },
      expectedRefreshToken: 'rt-1',
    });

    expect(written).toBe(true);
    expect(await resolveCredentialById(ORG, id)).toEqual({ status: 'ok', values: { accessToken: 'at-2', refreshToken: 'rt-2' } });
  });

  it('loses the swap and leaves the row alone when another refresh already rotated the token', async () => {
    const { id } = await storeAtlassianLogin();

    const written = await updateLoginCredentialValues({
      orgId: ORG,
      tokenId: id,
      values: { accessToken: 'at-stale', refreshToken: 'rt-stale' },
      expectedRefreshToken: 'rt-0',
    });

    expect(written).toBe(false);
    expect(await resolveCredentialById(ORG, id)).toEqual({ status: 'ok', values: { accessToken: 'at-1', refreshToken: 'rt-1' } });
  });

  it('refuses a pasted key, which has no refresh lineage to swap', async () => {
    const { id } = await storePlatformKey({ orgId: ORG, name: 'Acme GitHub', platform: 'github', apiKey: GITHUB_PAT });

    const written = await updateLoginCredentialValues({ orgId: ORG, tokenId: id, values: { token: 'x' }, expectedRefreshToken: 'rt-1' });

    expect(written).toBe(false);
  });
});

describe('revealPlatformCredential', () => {
  it('never opens a login, so its tokens are not shown on screen', async () => {
    const { id } = await slackLogin('Northwind', 'xoxb-first-token-1111');

    expect(await revealPlatformCredential(ORG, id)).toEqual({ status: 'not-found' });
  });
});

describe('resolveCredentialById last-used stamp', () => {
  it('stamps the first use and then leaves the stamp alone for an hour', async () => {
    const { id } = await slackLogin('Northwind', 'xoxb-first-token-1111');
    vi.useFakeTimers({ toFake: ['Date'] });
    const firstUse = new Date('2026-10-02T10:00:00Z');
    vi.setSystemTime(firstUse);

    await resolveCredentialById(ORG, id);
    vi.setSystemTime(new Date('2026-10-02T10:30:00Z'));
    await resolveCredentialById(ORG, id);

    const [row] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, id));

    expect(row!.lastUsedAt).toEqual(firstUse);
  });

  it('stamps again once the last stamp is more than an hour old', async () => {
    const { id } = await slackLogin('Northwind', 'xoxb-first-token-1111');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    await resolveCredentialById(ORG, id);

    const later = new Date('2026-10-02T11:30:00Z');
    vi.setSystemTime(later);
    await resolveCredentialById(ORG, id);

    const [row] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, id));

    expect(row!.lastUsedAt).toEqual(later);
  });
});
