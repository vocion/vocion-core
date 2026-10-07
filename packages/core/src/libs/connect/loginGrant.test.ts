import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The server's env app, for every vendor: what a login made before workspace
// login apps refreshes with. A test that needs the workspace's own app saves one.
vi.mock('./serverClients', () => ({ serverLoginClient: (provider: string) => ({ clientId: `${provider}_server_client`, clientSecret: 'server_secret', owner: 'server' }) }));

const { db } = await import('@/libs/DB');
const { apiTokenSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential, storePlatformKey, updateLoginCredentialValues } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { testConnectionPersistence, usableLoginGrant } = await import('./loginGrant');
const { TokenRequestError } = await import('./tokenRequest');

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const EXPIRED = '2026-10-05T11:00:00.000Z';
const LATER = '2026-10-05T18:00:00.000Z';

let orgCounter = 0;

/**
 * A HubSpot source on a stored login grant, in its own workspace.
 * @param grant - The values the login row holds.
 */
async function seedSourceOnLogin(grant: Record<string, unknown>) {
  orgCounter += 1;
  const orgId = `org_grant_${orgCounter}`;
  const stored = await storeLoginCredential({ orgId, platform: 'hubspot', name: 'HubSpot - Northwind', account: 'northwind.com', values: grant, createdBy: 'user_admin' });
  const [source] = await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug: `hubspot-${orgCounter}`,
    kind: 'plugin',
    configJson: { _connector: 'hubspot' },
    apiTokenId: stored.id,
    apiTokenExclusive: false,
  }).returning({ id: knowledgeSourceSchema.id });
  return { orgId, tokenId: stored.id, sourceId: source!.id };
}

/**
 * The login row's values as a sync would load them.
 * @param orgId - The workspace.
 * @param tokenId - The login row.
 */
async function storedValues(orgId: string, tokenId: string) {
  return getCredentialsForConnector({ orgId, connectorSlug: 'hubspot', apiTokenId: tokenId });
}

/**
 * When the login's refresh claim runs out, or null when nobody holds it.
 * @param tokenId - The login row.
 */
async function refreshClaimOn(tokenId: string) {
  const [row] = await db.select({ refreshingUntil: apiTokenSchema.refreshingUntil }).from(apiTokenSchema).where(eq(apiTokenSchema.id, tokenId));
  return row!.refreshingUntil;
}

/**
 * Mark the login as being refreshed by a caller this test plays.
 * @param tokenId - The login row.
 * @param until - When that caller's claim runs out.
 */
async function holdRefreshClaim(tokenId: string, until: Date) {
  await db.update(apiTokenSchema).set({ refreshingUntil: until }).where(eq(apiTokenSchema.id, tokenId));
}

/**
 * A vendor refresh that takes `vendor.ms` to answer and records each refresh
 * token it is handed.
 * @param vendor - How long it takes, and where it records.
 * @param vendor.ms - How long the vendor takes.
 * @param vendor.refreshedFrom - The refresh tokens it was handed, in order.
 * @param refreshToken - The refresh token sent.
 */
async function answerSlowly(vendor: { ms: number; refreshedFrom: string[] }, refreshToken: string) {
  vendor.refreshedFrom.push(refreshToken);
  await new Promise(resolve => setTimeout(resolve, vendor.ms));
  return { accessToken: `a-from-${refreshToken}`, refreshToken: `${refreshToken}-next`, expiresAt: LATER };
}

const QUICK_WAIT = { pollMs: 5, limitMs: 2_000 };

type ExpiringGrant = { accessToken: string; refreshToken: string; expiresAt: string };

/**
 * One caller asking for a usable Zoom-style grant on a seeded login.
 * @param seeded - The seeded workspace, login and source.
 * @param seeded.orgId - The workspace.
 * @param seeded.sourceId - The source.
 * @param grant - The grant this caller loaded.
 * @param vendor - The slow vendor both callers share.
 * @param vendor.ms - How long the vendor takes.
 * @param vendor.refreshedFrom - The refresh tokens it was handed.
 */
function callerOn(seeded: { orgId: string; sourceId: number }, grant: ExpiringGrant, vendor: { ms: number; refreshedFrom: string[] }) {
  return usableLoginGrant({
    vendor: 'Zoom',
    provider: 'zoom',
    connectorSlug: 'hubspot',
    grant,
    persistence: { kind: 'persist', orgId: seeded.orgId, sourceId: seeded.sourceId, warn: () => {} },
    refresh: refreshToken => answerSlowly(vendor, refreshToken),
    now: NOW,
    wait: QUICK_WAIT,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a sync on an expiring login', () => {
  it('a token that is still good is used as loaded, and nothing is written', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: LATER, hubId: 42 };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    const refreshedFrom: string[] = [];

    const usable = await usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async (refreshToken) => {
        refreshedFrom.push(refreshToken);
        return { accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER };
      },
      now: NOW,
    });

    expect(usable.accessToken).toBe('a1');
    expect(refreshedFrom).toEqual([]);
    expect(await storedValues(orgId, tokenId)).toMatchObject({ accessToken: 'a1', refreshToken: 'r1' });
  });

  it('refreshes from the STORED refresh token, not a stale one this run loaded, and saves the new grant to the same row, keeping what sat beside it', async () => {
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin({ accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED, hubId: 42 });
    const loadedEarlier = { accessToken: 'a0', refreshToken: 'r0', expiresAt: EXPIRED, hubId: 42 };
    const refreshedFrom: string[] = [];

    const usable = await usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant: loadedEarlier,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async (refreshToken) => {
        refreshedFrom.push(refreshToken);
        return { accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER };
      },
      now: NOW,
    });

    expect(refreshedFrom).toEqual(['r1']);
    expect(usable).toMatchObject({ accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER, hubId: 42 });
    expect(await storedValues(orgId, tokenId)).toMatchObject({ accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER, hubId: 42 });
  });

  it('when another sync saves a refresh first, this run uses the winner\'s grant and never overwrites it', async () => {
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin({ accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED });
    const warnings: string[] = [];

    const usable = await usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant: { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED },
      persistence: { kind: 'persist', orgId, sourceId, warn: message => warnings.push(message) },
      refresh: async () => {
        // The other sync lands while this one waits on the vendor.
        await updateLoginCredentialValues({ orgId, tokenId, values: { accessToken: 'a9', refreshToken: 'r9', expiresAt: LATER }, expectedRefreshToken: 'r1' });
        return { accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER };
      },
      now: NOW,
    });

    expect(usable).toMatchObject({ accessToken: 'a9', refreshToken: 'r9' });
    expect(await storedValues(orgId, tokenId)).toMatchObject({ accessToken: 'a9', refreshToken: 'r9' });
    expect(warnings).toEqual([]);
  });

  it('a Test connection that renewed a login it could not save fails, rather than passing on a token the stored login does not hold', async () => {
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin({ accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED });

    const failure = await usableLoginGrant({
      vendor: 'Apollo',
      provider: 'apollo',
      connectorSlug: 'apollo',
      grant: { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED },
      persistence: testConnectionPersistence('apollo', { orgId, sourceId }),
      refresh: async () => {
        // Another writer changes the login, still expired, so the save loses
        // and there is no usable winner to fall back on.
        await updateLoginCredentialValues({ orgId, tokenId, values: { accessToken: 'a9', refreshToken: 'r9', expiresAt: EXPIRED }, expectedRefreshToken: 'r1' });
        return { accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER };
      },
      now: NOW,
    }).catch((error: unknown) => error as Error);

    expect(failure.message).toBe('Apollo issued a new token but the saved login could not be updated. An admin needs to log in with Apollo again before the next sync.');
  });

  it('a test of typed values never refreshes: it has no connector to keep the new token in', () => {
    expect(testConnectionPersistence('apollo', undefined)).toEqual({ kind: 'never' });
  });

  it('when another sync already refreshed, this run uses the saved grant and never spends a refresh token', async () => {
    const { orgId, sourceId } = await seedSourceOnLogin({ accessToken: 'a5', refreshToken: 'r5', expiresAt: LATER });
    const refreshedFrom: string[] = [];

    const usable = await usableLoginGrant({
      vendor: 'Zoom',
      provider: 'zoom',
      connectorSlug: 'hubspot',
      grant: { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED },
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async (refreshToken) => {
        refreshedFrom.push(refreshToken);
        return { accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER };
      },
      now: NOW,
    });

    expect(refreshedFrom).toEqual([]);
    expect(usable).toMatchObject({ accessToken: 'a5', refreshToken: 'r5' });
  });

  it('a rotating vendor that refuses the refresh token another sync just rotated: this run uses that sync\'s grant, not "log in again"', async () => {
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin({ accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED });

    const usable = await usableLoginGrant({
      vendor: 'Zoom',
      provider: 'zoom',
      connectorSlug: 'hubspot',
      grant: { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED },
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async () => {
        // The other sync spends r1 first; the vendor then refuses it here.
        await updateLoginCredentialValues({ orgId, tokenId, values: { accessToken: 'a9', refreshToken: 'r9', expiresAt: LATER }, expectedRefreshToken: 'r1' });
        throw new TokenRequestError('Zoom', 'invalid_grant', 400);
      },
      now: NOW,
    });

    expect(usable).toMatchObject({ accessToken: 'a9', refreshToken: 'r9' });
  });

  it('a vendor that does not answer says to try again later, not to log in again, and the saved login is untouched', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);

    const failure = await usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async () => {
        throw new TokenRequestError('HubSpot', 'http_503', 503);
      },
      now: NOW,
    }).catch((error: unknown) => error as Error);

    expect(failure.message).toBe('HubSpot could not refresh the login just now (http_503). The saved login is unchanged; try again in a few minutes.');
    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });

  it('a caller with nowhere to save never refreshes an expired token: it names the two buttons that renew it, and the saved login is untouched', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId } = await seedSourceOnLogin(grant);
    const refreshedFrom: string[] = [];

    await expect(usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'never' },
      refresh: async (refreshToken) => {
        refreshedFrom.push(refreshToken);
        return { accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER };
      },
      now: NOW,
    })).rejects.toThrow(/Save the connector if it is new, then press Sync now on its row on the Connectors page, or Test connection where the row shows that instead; both renew the login\./);

    expect(refreshedFrom).toEqual([]);
    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });

  it('a refused refresh says to log in again with the vendor\'s code, and the saved login is untouched', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);

    await expect(usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async () => {
        throw new TokenRequestError('HubSpot', 'invalid_grant', 400);
      },
      now: NOW,
    })).rejects.toThrow('HubSpot would not refresh the login (invalid_grant). An admin needs to log in with HubSpot again on the Connectors page.');

    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });

  it('a refused OAuth client says an admin must fix the server\'s client, since logging in again would be refused the same way', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);

    const failure = await usableLoginGrant({
      vendor: 'Zoom',
      provider: 'zoom',
      connectorSlug: 'zoom',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async () => {
        throw new TokenRequestError('Zoom', 'invalid_client', 401);
      },
      now: NOW,
    }).catch((error: unknown) => error as Error);

    expect(failure.message).toBe('Zoom refused this server\'s OAuth client (invalid_client), so logging in again will not help. An admin needs to check the Zoom client ID and secret set on the server.');
    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });

  it('a login whose vendor app was removed from the server says an admin must set it up again, not to try again later', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);

    const failure = await usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async () => {
        throw new TokenRequestError('HubSpot', 'not_configured', null);
      },
      now: NOW,
    }).catch((error: unknown) => error as Error);

    expect(failure.message).toBe('The HubSpot app is no longer set up on this server (not_configured), so the login cannot be refreshed and logging in again will not help. An admin needs to set the HubSpot app up on the server again.');
    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });
});

describe('two callers on one expired login (a sync and an agent tool at once)', () => {
  it('only one calls the vendor; the other waits and uses the same new token, so a rotating refresh token is never spent twice', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const seeded = await seedSourceOnLogin(grant);
    const { orgId, tokenId } = seeded;
    const vendor = { ms: 50, refreshedFrom: [] as string[] };

    const [sync, agentTool] = await Promise.all([callerOn(seeded, grant, vendor), callerOn(seeded, grant, vendor)]);

    expect(vendor.refreshedFrom).toEqual(['r1']);
    expect(sync.accessToken).toBe('a-from-r1');
    expect(agentTool.accessToken).toBe('a-from-r1');
    expect(await storedValues(orgId, tokenId)).toMatchObject({ accessToken: 'a-from-r1', refreshToken: 'r1-next' });
    expect(await refreshClaimOn(tokenId)).toBeNull();
  });

  it('a caller that crashed mid-refresh blocks the login only until its claim runs out; then the next caller refreshes', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    await holdRefreshClaim(tokenId, new Date(Date.now() + 100));
    const vendor = { ms: 0, refreshedFrom: [] as string[] };

    const usable = await callerOn({ orgId, sourceId }, grant, vendor);

    expect(vendor.refreshedFrom).toEqual(['r1']);
    expect(usable.accessToken).toBe('a-from-r1');
    expect(await refreshClaimOn(tokenId)).toBeNull();
  });

  it('a refresh still running past the wait says the next sync retries, and never calls the vendor itself', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    const othersClaim = new Date(Date.now() + 30_000);
    await holdRefreshClaim(tokenId, othersClaim);
    const refreshedFrom: string[] = [];

    await expect(usableLoginGrant({
      vendor: 'Zoom',
      provider: 'zoom',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: refreshToken => answerSlowly({ ms: 0, refreshedFrom }, refreshToken),
      now: NOW,
      wait: { pollMs: 5, limitMs: 50 },
    })).rejects.toThrow('Another Zoom refresh of this login is still running. Try again in a minute.');

    expect(refreshedFrom).toEqual([]);
    expect(await refreshClaimOn(tokenId)).toEqual(othersClaim);
  });

  it('a login revoked while waiting ends the wait at once with "log in again", instead of waiting out a claim that never comes', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    await holdRefreshClaim(tokenId, new Date(Date.now() + 30_000));
    const refreshedFrom: string[] = [];

    const pending = usableLoginGrant({
      vendor: 'Zoom',
      provider: 'zoom',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: refreshToken => answerSlowly({ ms: 0, refreshedFrom }, refreshToken),
      now: NOW,
      wait: QUICK_WAIT,
    }).catch((error: unknown) => error as Error);
    await new Promise(resolve => setTimeout(resolve, 20));
    await db.update(apiTokenSchema).set({ revokedAt: new Date() }).where(eq(apiTokenSchema.id, tokenId));
    const failure = await pending;

    expect(failure.message).toBe('The Zoom login was revoked or removed. An admin needs to log in with Zoom again on the Connectors page.');
    expect(refreshedFrom).toEqual([]);
  });

  it('a source moved off the login while waiting is not refreshed from the stale token it first read, and the claim is let go', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    await holdRefreshClaim(tokenId, new Date(Date.now() + 60));
    const refreshedFrom: string[] = [];

    const pending = usableLoginGrant({
      vendor: 'Zoom',
      provider: 'zoom',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: refreshToken => answerSlowly({ ms: 0, refreshedFrom }, refreshToken),
      now: NOW,
      wait: QUICK_WAIT,
    }).catch((error: unknown) => error as Error);
    await new Promise(resolve => setTimeout(resolve, 20));
    await db.update(knowledgeSourceSchema).set({ apiTokenId: null }).where(eq(knowledgeSourceSchema.id, sourceId));
    const failure = await pending;

    expect(failure.message).toBe('The saved Zoom login could not be read. Try again in a minute.');
    expect(refreshedFrom).toEqual([]);
    expect(await refreshClaimOn(tokenId)).toBeNull();
  });

  it('a refused refresh lets go of the claim, so the next sync can try without waiting', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);

    await expect(usableLoginGrant({
      vendor: 'Zoom',
      provider: 'zoom',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async () => {
        throw new TokenRequestError('Zoom', 'http_503', 503);
      },
      now: NOW,
      wait: QUICK_WAIT,
    })).rejects.toThrow('Zoom could not refresh the login just now (http_503).');

    expect(await refreshClaimOn(tokenId)).toBeNull();
  });
});

describe('the app a refresh runs on', () => {
  it('a login made on the workspace\'s own login app is refreshed on that app, not the server\'s, since its refresh token only works with that client', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED, loginClientId: 'ws_hubspot_client' };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    await storePlatformKey({ orgId, name: 'Our HubSpot app', platform: 'hubspot-login-app', values: { clientId: 'ws_hubspot_client', clientSecret: 'ws_hubspot_secret' } });
    const handed: Array<string | undefined> = [];

    const usable = await usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async (_refreshToken, client) => {
        handed.push(client?.clientSecret);
        return { accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER };
      },
      now: NOW,
    });

    expect(handed).toEqual(['ws_hubspot_secret']);
    expect(usable).toMatchObject({ accessToken: 'a2', loginClientId: 'ws_hubspot_client' });
    // The saved login keeps its app too; without it the next refresh would
    // take the login for an old one and run it on the server's app.
    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r2', loginClientId: 'ws_hubspot_client' });
  });

  it('a login whose login app the workspace replaced says to log in again, never refreshes on the new app, and leaves the saved login as it was', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED, loginClientId: 'ws_hubspot_client_old' };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    await storePlatformKey({ orgId, name: 'Our HubSpot app', platform: 'hubspot-login-app', values: { clientId: 'ws_hubspot_client_new', clientSecret: 'ws_hubspot_secret_new' } });
    const refresh = vi.fn();

    await expect(usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh,
      now: NOW,
    })).rejects.toThrow('This HubSpot login was made with a HubSpot app that is no longer set up (it was replaced or removed), so it cannot be refreshed. An admin needs to log in with HubSpot again on the Connectors page, first saving a HubSpot login app on the Developers page if there is none.');
    expect(refresh).not.toHaveBeenCalled();
    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });

  it('a saved login app that cannot be decrypted says to save it again on Developers, not to try again later, and calls no vendor', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED, loginClientId: 'ws_hubspot_client' };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    const app = await storePlatformKey({ orgId, name: 'Our HubSpot app', platform: 'hubspot-login-app', values: { clientId: 'ws_hubspot_client', clientSecret: 'ws_hubspot_secret' } });
    // Another row's ciphertext under this row's nonce and tag: the vault can no longer read the app.
    const [login] = await db.select({ ciphertext: apiTokenSchema.ciphertext }).from(apiTokenSchema).where(eq(apiTokenSchema.id, tokenId));
    await db.update(apiTokenSchema).set({ ciphertext: login!.ciphertext }).where(eq(apiTokenSchema.id, app.id));
    const refresh = vi.fn();

    await expect(usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh,
      now: NOW,
    })).rejects.toThrow('The saved HubSpot login app could not be read, so this login cannot be refreshed. An admin needs to save the HubSpot login app again on the Developers page.');
    expect(refresh).not.toHaveBeenCalled();
    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });

  it('a refused workspace login app points at the Developers page, where it was saved, not at the server', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED, loginClientId: 'ws_hubspot_client' };
    const { orgId, sourceId } = await seedSourceOnLogin(grant);
    await storePlatformKey({ orgId, name: 'Our HubSpot app', platform: 'hubspot-login-app', values: { clientId: 'ws_hubspot_client', clientSecret: 'ws_hubspot_secret' } });

    await expect(usableLoginGrant({
      vendor: 'HubSpot',
      provider: 'hubspot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async () => {
        throw new TokenRequestError('HubSpot', 'invalid_client', 401);
      },
      now: NOW,
    })).rejects.toThrow('HubSpot refused this workspace\'s HubSpot login app (invalid_client), so logging in again will not help. An admin needs to check its client ID and secret on the Developers page.');
  });
});
