/**
 * Reading a stored credential back, which the Edit form does so its token field
 * shows what the source will actually use, and connecting a connector to one.
 *
 * The GET is the only endpoint that hands vault plaintext to a browser, so the
 * gate is the point of those tests: signed in, admin, and a source that belongs
 * to the caller's workspace. The other case worth pinning is a credential that
 * will not decrypt — it must report why rather than answering "none stored",
 * which the form would show as an empty field and the operator would read as
 * "the old token still works".
 *
 * The POST has three paths and they must not blur together: picking a
 * credential the workspace already holds, pasting values for an API-key
 * connector (which stores them as a workspace credential, so the next
 * connector can reuse them), and storing an OAuth grant against the install as
 * before. The link is per connector row, so a workspace running two Strapis
 * can point each at its own credential.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/SourceCredentialService', () => ({
  ConnectorCredentialError: class ConnectorCredentialError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
    }
  },
  getCredentialsForConnector: vi.fn(),
  linkSourceToStoredCredential: vi.fn(),
  storeCredentialForSource: vi.fn(),
  storedCredentialIdForSource: vi.fn(),
}));
vi.mock('@/services/ApiTokenService', () => ({
  listPlatformCredentials: vi.fn(),
  rotatePlatformCredential: vi.fn(),
  storePlatformKey: vi.fn(),
}));
vi.mock('@/services/SourceSyncService', () => ({ getSourceById: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { listPlatformCredentials, rotatePlatformCredential, storePlatformKey } = await import('@/services/ApiTokenService');
const {
  getCredentialsForConnector,
  linkSourceToStoredCredential,
  storeCredentialForSource,
  storedCredentialIdForSource,
} = await import('@/services/SourceCredentialService');
const { getSourceById } = await import('@/services/SourceSyncService');
const { GET, POST } = await import('./route');

const admin = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  has: () => true,
};

/**
 * Route context for one source id.
 * @param id - The dynamic `[id]` segment.
 */
function context(id: string) {
  return { params: Promise.resolve({ id, locale: 'en' }) };
}

const request = new Request('http://test/rpc/sources/1/credentials');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(admin);
  vi.mocked(getSourceById).mockResolvedValue({
    id: 1,
    slug: 'kb-strapi',
    kind: 'plugin',
    config: { _connector: 'strapi' },
  });
  vi.mocked(getCredentialsForConnector).mockResolvedValue({ token: 'stored-tok' });
  vi.mocked(storedCredentialIdForSource).mockResolvedValue(null);
  vi.mocked(listPlatformCredentials).mockResolvedValue([]);
  vi.mocked(storePlatformKey).mockResolvedValue({ id: 'cred_new', keyHint: '…aaaa' });
  vi.mocked(rotatePlatformCredential).mockResolvedValue({ status: 'ok', keyHint: '…bbbb' });
  vi.mocked(linkSourceToStoredCredential).mockResolvedValue(undefined);
  vi.mocked(storeCredentialForSource).mockResolvedValue({ installId: 7, credentialId: 11 });
});

/**
 * A POST carrying `body` as JSON.
 * @param body - The request body.
 */
function post(body: unknown): Request {
  return new Request('http://test/rpc/sources/1/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /rpc/sources/[id]/credentials', () => {
  it('returns the credential this connector points at', async () => {
    vi.mocked(storedCredentialIdForSource).mockResolvedValue('cred_a');

    const res = await GET(request, context('1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ credentials: { token: 'stored-tok' } });
    // This connector row's own credential, not the org's Strapi credential in
    // general: a second Strapi connector may name a different one.
    expect(storedCredentialIdForSource).toHaveBeenCalledWith('org_1', 1);
    expect(getCredentialsForConnector).toHaveBeenCalledWith({
      orgId: 'org_1',
      connectorSlug: 'strapi',
      apiTokenId: 'cred_a',
    });
  });

  it('falls back to the source slug when the config has no connector key', async () => {
    vi.mocked(getSourceById).mockResolvedValue({ id: 1, slug: 'hubspot', kind: 'plugin', config: {} });

    await GET(request, context('1'));

    expect(getCredentialsForConnector).toHaveBeenCalledWith(expect.objectContaining({ connectorSlug: 'hubspot' }));
  });

  it('answers null when nothing is stored', async () => {
    vi.mocked(getCredentialsForConnector).mockResolvedValue(undefined);

    const res = await GET(request, context('1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ credentials: null });
  });

  it('refuses a caller with no workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, orgId: null });

    const res = await GET(request, context('1'));

    expect(res.status).toBe(401);
    expect(getCredentialsForConnector).not.toHaveBeenCalled();
  });

  it('refuses a member: only someone who can replace the token may read it', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' });

    const res = await GET(request, context('1'));

    expect(res.status).toBe(403);
    expect(getCredentialsForConnector).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a number', async () => {
    const res = await GET(request, context('abc'));

    expect(res.status).toBe(400);
    expect(getSourceById).not.toHaveBeenCalled();
  });

  it('404s a source outside the caller\'s workspace', async () => {
    vi.mocked(getSourceById).mockResolvedValue(null);

    const res = await GET(request, context('1'));

    expect(res.status).toBe(404);
    expect(getCredentialsForConnector).not.toHaveBeenCalled();
  });

  it('reports a credential that will not decrypt instead of saying none is stored', async () => {
    vi.mocked(getCredentialsForConnector).mockRejectedValue(
      new Error('The stored credential could not be decrypted with the current vault key.'),
    );

    const res = await GET(request, context('1'));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('could not be decrypted') });
  });
});

describe('GET /rpc/sources/[id]/credentials — credentials to pick from', () => {
  it('offers the credentials the workspace already holds for the platform', async () => {
    // The point of the ticket: a Jira or Strapi key typed once under API
    // credentials is offered here rather than asked for again.
    vi.mocked(listPlatformCredentials).mockResolvedValue([
      { id: 'cred_a', name: 'Strapi — prod', keyHint: '…aaaa', createdAt: new Date(0), expiresAt: null },
    ]);

    const body = await (await GET(request, context('1'))).json();

    expect(listPlatformCredentials).toHaveBeenCalledWith('org_1', 'strapi');
    expect(body.available).toHaveLength(1);
    expect(body.platform).toBe('strapi');
  });

  it('says which credential the connector currently points at', async () => {
    vi.mocked(storedCredentialIdForSource).mockResolvedValue('cred_a');

    const body = await (await GET(request, context('1'))).json();

    expect(body.linkedCredentialId).toBe('cred_a');
  });

  it('offers nothing to pick for a connector that uses an OAuth grant', async () => {
    vi.mocked(getSourceById).mockResolvedValue({ id: 1, slug: 'slack', kind: 'plugin', config: {} });

    const body = await (await GET(request, context('1'))).json();

    expect(listPlatformCredentials).not.toHaveBeenCalled();
    expect(body.platform).toBeNull();
    expect(body.available).toEqual([]);
  });

  it('names a broken credential rather than reporting a plain failure', async () => {
    const { ConnectorCredentialError } = await import('@/services/SourceCredentialService');
    vi.mocked(getCredentialsForConnector).mockRejectedValue(
      new ConnectorCredentialError('revoked', 'The Strapi credential this connector uses was revoked.'),
    );

    const res = await GET(request, context('1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      credentials: null,
      credentialBroken: 'revoked',
      error: expect.stringContaining('was revoked'),
    });
  });
});

describe('POST /rpc/sources/[id]/credentials', () => {
  it('points this connector at a credential the workspace already holds', async () => {
    const res = await POST(post({ apiTokenId: 'cred_a' }), context('1'));

    expect(res.status).toBe(200);
    // The connector row, by id — so a second Strapi connector picking another
    // credential does not move this one.
    expect(linkSourceToStoredCredential).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org_1',
      sourceId: 1,
      connectorSlug: 'strapi',
      apiTokenId: 'cred_a',
    }));
    // Nothing was pasted, so nothing may be stored.
    expect(storePlatformKey).not.toHaveBeenCalled();
  });

  it('stores pasted values as a workspace credential, then links this connector', async () => {
    // This is what puts a key pasted during connector setup into the
    // credentials list, where the next connector can reuse it.
    const res = await POST(post({
      credentials: { baseUrl: 'https://cms.example.com', token: 'strapi-token' },
      credentialName: 'Strapi — prod',
    }), context('1'));

    expect(res.status).toBe(200);
    expect(storePlatformKey).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org_1',
      platform: 'strapi',
      name: 'Strapi — prod',
      values: { baseUrl: 'https://cms.example.com', token: 'strapi-token' },
    }));
    expect(linkSourceToStoredCredential).toHaveBeenCalledWith(expect.objectContaining({ apiTokenId: 'cred_new' }));
    expect(storeCredentialForSource).not.toHaveBeenCalled();
  });

  it('names the credential after its platform and connector when nobody supplied a name', async () => {
    await POST(post({ credentials: { token: 'strapi-token' } }), context('1'));

    expect(storePlatformKey).toHaveBeenCalledWith(expect.objectContaining({ name: 'Strapi — kb-strapi' }));
  });

  it('still stores an OAuth grant against the install itself', async () => {
    // A grant is issued to one installation and carries a refresh token, so
    // there is nothing to share and nothing to point at.
    vi.mocked(getSourceById).mockResolvedValue({ id: 1, slug: 'slack', kind: 'plugin', config: {} });

    const res = await POST(post({ credentials: { token: 'xoxb-1' } }), context('1'));

    expect(res.status).toBe(200);
    expect(storeCredentialForSource).toHaveBeenCalledWith(expect.objectContaining({ sourceSlug: 'slack' }));
    expect(storePlatformKey).not.toHaveBeenCalled();
  });

  it('refuses a body with neither a picked credential nor any values', async () => {
    const res = await POST(post({ credentials: {} }), context('1'));

    expect(res.status).toBe(400);
    expect(linkSourceToStoredCredential).not.toHaveBeenCalled();
  });

  it('reports why a picked credential could not be used', async () => {
    const { ConnectorCredentialError } = await import('@/services/SourceCredentialService');
    vi.mocked(linkSourceToStoredCredential).mockRejectedValue(
      new ConnectorCredentialError('missing', 'That credential does not exist, or has been revoked.'),
    );

    const res = await POST(post({ apiTokenId: 'cred_gone' }), context('1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('does not exist') });
  });

  it('hides a failure that is not the caller\'s to fix', async () => {
    // A constraint detail or a KMS error must not travel to a browser.
    vi.mocked(storePlatformKey).mockRejectedValue(new Error('kms: AccessDeniedException for key arn:aws:kms:…'));

    const res = await POST(post({ credentials: { token: 'strapi-token' } }), context('1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Could not save the credential.' });
  });

  it('refuses a member: only an admin may set a credential', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' });

    const res = await POST(post({ apiTokenId: 'cred_a' }), context('1'));

    expect(res.status).toBe(403);
    expect(linkSourceToStoredCredential).not.toHaveBeenCalled();
  });
});

describe('POST /rpc/sources/[id]/credentials — rotation', () => {
  it('rotates the named credential in place, keeping its id', async () => {
    // Every connector pointing at this credential resolves through its id, so
    // storing a replacement row would leave them all on the old key.
    const res = await POST(post({
      apiTokenId: 'cred_a',
      credentials: { baseUrl: 'https://cms.example.com', token: 'rotated' },
    }), context('1'));

    expect(res.status).toBe(200);
    expect(rotatePlatformCredential).toHaveBeenCalledWith({
      orgId: 'org_1',
      tokenId: 'cred_a',
      values: { baseUrl: 'https://cms.example.com', token: 'rotated' },
    });
    expect(storePlatformKey).not.toHaveBeenCalled();
  });

  it('links the connector as well, so a first connection rotates and connects at once', async () => {
    await POST(post({ apiTokenId: 'cred_a', credentials: { token: 'rotated' } }), context('1'));

    expect(linkSourceToStoredCredential).toHaveBeenCalledWith(expect.objectContaining({ apiTokenId: 'cred_a' }));
  });

  it('refuses to rotate a revoked credential back into service', async () => {
    vi.mocked(rotatePlatformCredential).mockResolvedValue({ status: 'revoked' });

    const res = await POST(post({ apiTokenId: 'cred_a', credentials: { token: 'rotated' } }), context('1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('revoked') });
    expect(linkSourceToStoredCredential).not.toHaveBeenCalled();
  });

  it('reports a rotation the platform rejected, in the words the person can act on', async () => {
    const { CredentialValidationError } = await import('@/libs/platforms/registry');
    vi.mocked(rotatePlatformCredential).mockRejectedValue(
      new CredentialValidationError('That does not look like a valid Instance URL — it starts with http:// or https://.'),
    );

    const res = await POST(post({
      apiTokenId: 'cred_a',
      credentials: { baseUrl: 'cms.example.com', token: 'rotated' },
    }), context('1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('Instance URL') });
  });
});
