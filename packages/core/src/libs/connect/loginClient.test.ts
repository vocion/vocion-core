/**
 * Which app a vendor login runs on (#1080), against PGlite: the workspace's
 * own login app first, the server's env app otherwise, and for a refresh the
 * very app the login was made on.
 */
import type { ConnectProvider } from './provider';
import type { LoginClient } from './serverClients';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const serverApps: Partial<Record<string, LoginClient>> = {};
vi.mock('./serverClients', () => ({ serverLoginClient: (provider: string) => serverApps[provider] ?? null }));

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { revokeToken, storePlatformKey } = await import('@/services/ApiTokenService');
const { loginClientForGrant, loginClientForNewLogin, loginOffered } = await import('./loginClient');
const { refusalFix, TokenRequestError } = await import('./tokenRequest');

const ORG = 'org_login_client';
const SERVER_GOOGLE: LoginClient = { clientId: 'server_google', clientSecret: 'server_secret', owner: 'server' };

/**
 * Save the workspace's own Google login app, as an admin does on the Developers page.
 * @param clientId - The app's client ID.
 */
async function saveWorkspaceGoogleApp(clientId: string): Promise<string> {
  const stored = await storePlatformKey({ orgId: ORG, name: 'Our Google app', platform: 'google-login-app', values: { clientId, clientSecret: `${clientId}_secret` } });
  return stored.id;
}

/**
 * A provider as the Connectors page sees it: only its id and whether the server's env sets it up.
 * @param id - The provider id.
 * @param configured - Whether the server's env holds its app.
 */
function providerStub(id: ConnectProvider['id'], configured: boolean): ConnectProvider {
  return { id, configured: () => configured } as unknown as ConnectProvider;
}

/**
 * The code a refresh lookup failed with, or null when it found an app.
 * @param loginClientId - What the stored login recorded.
 */
async function refreshLookupFailure(loginClientId: unknown): Promise<string | null> {
  try {
    await loginClientForGrant({ orgId: ORG, provider: 'google', vendor: 'Google', loginClientId });
    return null;
  } catch (error) {
    return error instanceof TokenRequestError ? error.code : 'not a TokenRequestError';
  }
}

describe('the app a vendor login runs on', () => {
  beforeEach(() => {
    serverApps.google = SERVER_GOOGLE;
  });

  afterEach(async () => {
    delete serverApps.google;
    // api_token references source_dek, so credentials go first.
    await db.delete(apiTokenSchema);
    await db.delete(sourceDekSchema);
  });

  it('a new login takes the workspace\'s own app over the server\'s, so a workspace can bring its own without a redeploy', async () => {
    await saveWorkspaceGoogleApp('ws_google');

    await expect(loginClientForNewLogin(ORG, 'google')).resolves.toEqual({ clientId: 'ws_google', clientSecret: 'ws_google_secret', owner: 'workspace' });
  });

  it('a new login uses the server\'s app when the workspace saved none, and has none when neither exists', async () => {
    await expect(loginClientForNewLogin(ORG, 'google')).resolves.toEqual(SERVER_GOOGLE);

    delete serverApps.google;

    await expect(loginClientForNewLogin(ORG, 'google')).resolves.toBeNull();
  });

  it('a revoked login app is no longer used: the login falls back to the server\'s', async () => {
    const tokenId = await saveWorkspaceGoogleApp('ws_google');
    await revokeToken(ORG, tokenId);

    await expect(loginClientForNewLogin(ORG, 'google')).resolves.toEqual(SERVER_GOOGLE);
  });

  it('GitHub and PostHog never take a workspace app: their logins are not a client ID and secret', async () => {
    await expect(loginClientForNewLogin(ORG, 'github')).resolves.toBeNull();
    await expect(loginClientForNewLogin(ORG, 'posthog')).resolves.toBeNull();
  });

  it('a refresh finds the app the login recorded, the workspace\'s or the server\'s, whichever is current', async () => {
    await saveWorkspaceGoogleApp('ws_google');

    await expect(loginClientForGrant({ orgId: ORG, provider: 'google', vendor: 'Google', loginClientId: 'ws_google' })).resolves.toMatchObject({ clientId: 'ws_google', owner: 'workspace' });
    await expect(loginClientForGrant({ orgId: ORG, provider: 'google', vendor: 'Google', loginClientId: 'server_google' })).resolves.toEqual(SERVER_GOOGLE);
  });

  it('a login made before workspace apps refreshes on the server\'s app, even after the workspace saves its own', async () => {
    await saveWorkspaceGoogleApp('ws_google');

    await expect(loginClientForGrant({ orgId: ORG, provider: 'google', vendor: 'Google', loginClientId: undefined })).resolves.toEqual(SERVER_GOOGLE);
  });

  it('a login on a replaced app needs a new login; a login with no app left anywhere needs the server fixed', async () => {
    await saveWorkspaceGoogleApp('ws_google_new');

    await expect(refreshLookupFailure('ws_google_old')).resolves.toBe('login_app_changed');
    expect(refusalFix(new TokenRequestError('Google', 'login_app_changed', null))).toBe('log-in-again');

    delete serverApps.google;
    await db.delete(apiTokenSchema);

    await expect(refreshLookupFailure(undefined)).resolves.toBe('not_configured');
  });

  it('a pre-workspace-app login whose server app was removed, in a workspace that now has its own, needs a new login on that app', async () => {
    delete serverApps.google;
    await saveWorkspaceGoogleApp('ws_google');

    await expect(refreshLookupFailure(undefined)).resolves.toBe('login_app_changed');
  });

  it('a login is offered when the server or the workspace has an app, and not when neither does', async () => {
    await expect(loginOffered(ORG, providerStub('google', true))).resolves.toBe(true);
    await expect(loginOffered(ORG, providerStub('google', false))).resolves.toBe(false);

    await saveWorkspaceGoogleApp('ws_google');

    await expect(loginOffered(ORG, providerStub('google', false))).resolves.toBe(true);
    await expect(loginOffered('org_someone_else', providerStub('google', false))).resolves.toBe(false);
  });
});
