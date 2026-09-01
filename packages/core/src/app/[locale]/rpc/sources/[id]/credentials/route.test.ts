/**
 * Reading a stored credential back, which the Edit form does so its token field
 * shows what the source will actually use.
 *
 * This is the only endpoint that hands vault plaintext to a browser, so the
 * gate is the point of these tests: signed in, admin, and a source that belongs
 * to the caller's workspace. The other case worth pinning is a credential that
 * will not decrypt — it must report why rather than answering "none stored",
 * which the form would show as an empty field and the operator would read as
 * "the old token still works".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
  storeCredentialForSource: vi.fn(),
}));
vi.mock('@/services/SourceSyncService', () => ({ getSourceById: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { getSourceById } = await import('@/services/SourceSyncService');
const { GET } = await import('./route');

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
  vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'stored-tok' });
});

describe('GET /rpc/sources/[id]/credentials', () => {
  it('returns the stored credential, looked up by connector', async () => {
    const res = await GET(request, context('1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ credentials: { token: 'stored-tok' } });
    // Credentials are per-connector, not per-source: one Strapi token serves
    // every Strapi source, so the lookup must use the connector slug.
    expect(getCredentialsForSource).toHaveBeenCalledWith('org_1', 'strapi');
  });

  it('falls back to the source slug when the config has no connector key', async () => {
    vi.mocked(getSourceById).mockResolvedValue({ id: 1, slug: 'hubspot', kind: 'plugin', config: {} });

    await GET(request, context('1'));

    expect(getCredentialsForSource).toHaveBeenCalledWith('org_1', 'hubspot');
  });

  it('answers null when nothing is stored', async () => {
    vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);

    const res = await GET(request, context('1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ credentials: null });
  });

  it('refuses a caller with no workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, orgId: null });

    const res = await GET(request, context('1'));

    expect(res.status).toBe(401);
    expect(getCredentialsForSource).not.toHaveBeenCalled();
  });

  it('refuses a member: only someone who can replace the token may read it', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' });

    const res = await GET(request, context('1'));

    expect(res.status).toBe(403);
    expect(getCredentialsForSource).not.toHaveBeenCalled();
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
    expect(getCredentialsForSource).not.toHaveBeenCalled();
  });

  it('reports a credential that will not decrypt instead of saying none is stored', async () => {
    vi.mocked(getCredentialsForSource).mockRejectedValue(
      new Error('The stored credential could not be decrypted with the current vault key.'),
    );

    const res = await GET(request, context('1'));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('could not be decrypted') });
  });
});
