/**
 * The Zoom source on a person's login (Connect with Zoom) versus a pasted
 * Server-to-Server bag: which token each reads with, the refresh a sync runs
 * on an expiring login (saving Zoom's rotated refresh token), and the
 * fallback to the logged-in user when Zoom will not list the account's users.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = { ZOOM_CLIENT_ID: 'zoom-cid', ZOOM_CLIENT_SECRET: 'zoom-secret' };
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { zoomConnector } = await import('./zoom');

const NOW = Date.now();
const GOOD_UNTIL = new Date(NOW + 3_600_000).toISOString();
const EXPIRED = new Date(NOW - 3_600_000).toISOString();
const SOURCE_CONFIG = { pastDays: 7, users: [], apiBaseUrl: 'https://api.zoom.us/v2', authBaseUrl: 'https://zoom.us' };
const ADMIN_USERS = { users: [{ id: 'u1', email: 'ana@acme.com' }] };

type Call = { url: string; headers: Record<string, string> };

/**
 * Stub `fetch`; each call's URL and headers are recorded.
 * @param handler - Maps a URL to a response, or undefined for an unexpected call.
 */
function stubFetch(handler: (url: string) => Response | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    const response = handler(url);
    if (!response) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return response;
  });
  return calls;
}

/**
 * Run a sync to the end and return the progress messages it reported.
 * @param bag - The credential bag the source loaded.
 * @param orgId - The workspace.
 * @param sourceId - The source row.
 */
async function runSync(bag: Record<string, unknown>, orgId = 'org_none', sourceId = 0): Promise<string[]> {
  const messages: string[] = [];
  const iterator = zoomConnector.sync({
    sourceId,
    orgId,
    config: SOURCE_CONFIG,
    credentials: bag,
    onProgress: event => messages.push('message' in event && event.message ? event.message : ''),
  });
  for await (const _doc of iterator) {
    // Documents are not the subject here; the calls made are.
  }
  return messages;
}

let orgCounter = 0;

/**
 * A Zoom source on a stored login, in its own workspace.
 * @param grant - The values the login row holds.
 */
async function seedZoomSourceOnLogin(grant: Record<string, unknown>) {
  orgCounter += 1;
  const orgId = `org_zoom_${orgCounter}`;
  const stored = await storeLoginCredential({ orgId, platform: 'zoom', name: 'Zoom - ana', account: 'ana@acme.com', values: grant, createdBy: 'user_admin' });
  const [source] = await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug: `zoom-${orgCounter}`,
    kind: 'plugin',
    configJson: { _connector: 'zoom' },
    apiTokenId: stored.id,
    apiTokenExclusive: false,
  }).returning({ id: knowledgeSourceSchema.id });
  return { orgId, tokenId: stored.id, sourceId: source!.id };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zoom sync on a login', () => {
  it('reads with the login\'s Bearer access token and never mints a Server-to-Server token', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('/users?')) {
        return Response.json(ADMIN_USERS);
      }
      return Response.json({ meetings: [] });
    });

    await runSync({ accessToken: 'login-at', refreshToken: 'rt', expiresAt: GOOD_UNTIL, email: 'ana@acme.com' });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(call => call.headers.authorization === 'Bearer login-at')).toBe(true);
    expect(calls.some(call => call.url.includes('/oauth/token'))).toBe(false);
  });

  it('refreshes an expiring login during the sync, reads with the new token, and saves the rotated refresh token', async () => {
    const bag = { accessToken: 'old-at', refreshToken: 'rt-1', expiresAt: EXPIRED, email: 'ana@acme.com' };
    const { orgId, tokenId, sourceId } = await seedZoomSourceOnLogin(bag);
    const calls = stubFetch((url) => {
      if (url.includes('/oauth/token')) {
        return Response.json({ access_token: 'new-at', refresh_token: 'rt-2', expires_in: 3600 });
      }
      if (url.includes('/users?')) {
        return Response.json(ADMIN_USERS);
      }
      return Response.json({ meetings: [] });
    });

    await runSync(bag, orgId, sourceId);

    const readCalls = calls.filter(call => !call.url.includes('/oauth/token'));

    expect(readCalls.every(call => call.headers.authorization === 'Bearer new-at')).toBe(true);
    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'zoom', apiTokenId: tokenId })).toMatchObject({ accessToken: 'new-at', refreshToken: 'rt-2', email: 'ana@acme.com' });
  });

  it('a login Zoom will not let list users reads only its own recordings, and says so instead of failing', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('/users?')) {
        return new Response('{"code":4711}', { status: 400 });
      }
      if (url.endsWith('/users/me')) {
        return Response.json({ id: 'me-id', email: 'ana@acme.com' });
      }
      if (url.includes('/users/me-id/recordings')) {
        return Response.json({ meetings: [] });
      }
      return undefined;
    });

    const messages = await runSync({ accessToken: 'login-at', refreshToken: 'rt', expiresAt: GOOD_UNTIL });

    expect(calls.some(call => call.url.includes('/users/me-id/recordings'))).toBe(true);
    expect(messages.some(message => /only the logged-in user/.test(message))).toBe(true);
  });
});

describe('zoom sync on a pasted Server-to-Server bag', () => {
  it('still mints a token with grant_type=account_credentials and reads with it', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('/oauth/token')) {
        return Response.json({ access_token: 's2s-at', expires_in: 3600 });
      }
      if (url.includes('/users?')) {
        return Response.json(ADMIN_USERS);
      }
      return Response.json({ meetings: [] });
    });

    await runSync({ accountId: 'acct-s2s', clientId: 'cid', clientSecret: 'sec' });

    expect(calls[0]!.url).toContain('grant_type=account_credentials&account_id=acct-s2s');
    expect(calls.slice(1).every(call => call.headers.authorization === 'Bearer s2s-at')).toBe(true);
  });

  it('does not fall back to one user when Zoom refuses the user list: a refused S2S app is an error to fix', async () => {
    stubFetch((url) => {
      if (url.includes('/oauth/token')) {
        return Response.json({ access_token: 's2s-at-2', expires_in: 3600 });
      }
      return new Response('scopes:[user:read:list_users:admin]', { status: 400 });
    });

    await expect(runSync({ accountId: 'acct-refused', clientId: 'cid', clientSecret: 'sec' })).rejects.toThrow(/user list failed: 400/);
  });
});
