import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential, updateLoginCredentialValues } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { postTokenRequest, TokenRequestError, usableLoginGrant } = await import('./loginGrant');

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

  it('Test connection never refreshes an expired token: it says to run a sync, and the saved login is untouched', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId } = await seedSourceOnLogin(grant);
    const refreshedFrom: string[] = [];

    await expect(usableLoginGrant({
      vendor: 'HubSpot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'never' },
      refresh: async (refreshToken) => {
        refreshedFrom.push(refreshToken);
        return { accessToken: 'a2', refreshToken: 'r2', expiresAt: LATER };
      },
      now: NOW,
    })).rejects.toThrow(/Run Sync now/);

    expect(refreshedFrom).toEqual([]);
    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });

  it('a refused refresh says to log in again with the vendor\'s code, and the saved login is untouched', async () => {
    const grant = { accessToken: 'a1', refreshToken: 'r1', expiresAt: EXPIRED };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);

    await expect(usableLoginGrant({
      vendor: 'HubSpot',
      connectorSlug: 'hubspot',
      grant,
      persistence: { kind: 'persist', orgId, sourceId, warn: () => {} },
      refresh: async () => {
        throw new TokenRequestError('HubSpot', 'invalid_grant', 400);
      },
      now: NOW,
    })).rejects.toThrow('HubSpot would not refresh the login (invalid_grant). Log in with HubSpot again on the Connectors page.');

    expect(await storedValues(orgId, tokenId)).toMatchObject({ refreshToken: 'r1' });
  });
});

describe('the token request every vendor shares', () => {
  it('a refusal reports only the vendor\'s short error code, never its description, which can echo what was sent', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token r-secret-123 is revoked' }), { status: 400 }));

    const failure = await postTokenRequest({ vendor: 'HubSpot', url: 'https://api.hubapi.com/oauth/v1/token', params: { grant_type: 'refresh_token', refresh_token: 'r-secret-123' }, encoding: 'form' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TokenRequestError);
    expect((failure as Error).message).toBe('HubSpot refused the token request (invalid_grant).');
    expect((failure as Error).message).not.toContain('r-secret-123');
  });

  it('a gateway page that is not JSON is reported by its status', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(postTokenRequest({ vendor: 'Zoom', url: 'https://zoom.us/oauth/token', params: {}, encoding: 'form' })).rejects.toThrow('Zoom refused the token request (http_502).');
  });

  it('sends the client as HTTP Basic when the vendor asks for it, with the body in the encoding it asks for', async () => {
    const sent: Array<{ headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push({ headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response(JSON.stringify({ access_token: 'a1' }), { status: 200 });
    });

    const body = await postTokenRequest({ vendor: 'Notion', url: 'https://api.notion.com/v1/oauth/token', params: { grant_type: 'authorization_code', code: 'c1' }, encoding: 'json', basicAuth: { clientId: 'id', clientSecret: 'shh' } });

    expect(body).toEqual({ access_token: 'a1' });
    expect(sent[0]!.headers.authorization).toBe(`Basic ${Buffer.from('id:shh').toString('base64')}`);
    expect(sent[0]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(sent[0]!.body)).toEqual({ grant_type: 'authorization_code', code: 'c1' });
  });
});
