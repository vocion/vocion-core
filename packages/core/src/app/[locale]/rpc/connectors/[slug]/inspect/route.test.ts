/**
 * The endpoint the Sources page uses to look at a third party before trusting
 * it: Strapi's Add-source dialog reads an instance's collections with it, and
 * Apollo's Connect dialog asks what a pasted key opens.
 *
 * It takes a credential and makes the server call an arbitrary host, so the
 * gate is the whole point: an admin of the workspace, and a connector that
 * declares an `inspect` hook. What counts as valid input is the connector's
 * own business — it throws `InspectInputError` and the route answers 400 with
 * the message, which is how "The base URL must start with http:// or https://"
 * reaches whoever pasted a bare hostname.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectInputError } from '@/libs/sources/inspect';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/sources/registry', () => ({ getConnector: vi.fn() }));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(),
  storedCredentialIdForSource: vi.fn(),
}));
vi.mock('@/services/SourceSyncService', () => ({ getSourceById: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { getConnector } = await import('@/libs/sources/registry');
const { getCredentialsForConnector, storedCredentialIdForSource } = await import('@/services/SourceCredentialService');
const { getSourceById } = await import('@/services/SourceSyncService');
const { POST } = await import('./route');

const admin = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  has: () => true,
};

const inspection = {
  reachable: true,
  authorized: true,
  checks: [{ key: 'auth', label: 'API key accepted', ok: true, detail: 'Accepted.' }],
  note: null,
  error: null,
};

const inspectHook = vi.fn();

/**
 * Route context for one connector slug.
 * @param slug - The dynamic `[slug]` segment.
 */
function context(slug: string) {
  return { params: Promise.resolve({ slug, locale: 'en' }) };
}

/**
 * An inspect request carrying this body.
 * @param body - JSON body, or a raw string for malformed JSON.
 */
function inspectRequest(body: unknown): Request {
  return new Request('http://test/rpc/connectors/apollo/inspect', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const goodBody = {
  config: { baseUrl: 'https://cms.example/' },
  credentials: { token: 'tok-123' },
  collections: ['events', 'venues'],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(admin);
  inspectHook.mockResolvedValue(inspection);
  vi.mocked(getConnector).mockReturnValue({ slug: 'apollo', inspect: inspectHook } as never);
});

describe('POST /rpc/connectors/[slug]/inspect', () => {
  it('dispatches to the connector hook and passes its result back verbatim', async () => {
    const res = await POST(inspectRequest(goodBody), context('apollo'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ inspection });
    // Config and credentials as sent; anything else is the connector's own —
    // Strapi's collection list reaches it through `options`.
    expect(inspectHook).toHaveBeenCalledWith({
      config: { baseUrl: 'https://cms.example/' },
      credentials: { token: 'tok-123' },
      options: { collections: ['events', 'venues'] },
    });
  });

  it('hands a connector-shaped payload straight through, whatever its shape', async () => {
    inspectHook.mockResolvedValue({ collections: ['events'], detectedVersion: 5 });

    const res = await POST(inspectRequest(goodBody), context('strapi'));

    await expect(res.json()).resolves.toEqual({ inspection: { collections: ['events'], detectedVersion: 5 } });
  });

  it('treats missing config and credentials as empty rather than as an error', async () => {
    await POST(inspectRequest({}), context('apollo'));

    expect(inspectHook).toHaveBeenCalledWith({ config: {}, credentials: {}, options: {} });
  });

  it('ignores a non-object config or credentials rather than passing it through', async () => {
    await POST(inspectRequest({ config: 12345, credentials: 'nope' }), context('apollo'));

    expect(inspectHook).toHaveBeenCalledWith({ config: {}, credentials: {}, options: {} });
  });

  it('refuses a caller with no workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, orgId: null });

    const res = await POST(inspectRequest(goodBody), context('apollo'));

    expect(res.status).toBe(401);
    expect(inspectHook).not.toHaveBeenCalled();
  });

  it('refuses a member: it spends a credential against an arbitrary host', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' });

    const res = await POST(inspectRequest(goodBody), context('apollo'));

    expect(res.status).toBe(403);
    expect(inspectHook).not.toHaveBeenCalled();
  });

  it('404s a connector that does not exist', async () => {
    vi.mocked(getConnector).mockReturnValue(undefined);

    const res = await POST(inspectRequest(goodBody), context('nonsense'));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'Unknown connector: nonsense' });
  });

  it('501s a connector with no hook, so the client uses its plain form', async () => {
    vi.mocked(getConnector).mockReturnValue({ slug: 'hubspot' } as never);

    const res = await POST(inspectRequest(goodBody), context('hubspot'));

    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ error: 'hubspot does not support inspection' });
    expect(inspectHook).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON', async () => {
    const res = await POST(inspectRequest('{oops'), context('apollo'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid JSON body' });
  });

  it('answers 400 with the connector\'s own words when it refuses the input', async () => {
    inspectHook.mockRejectedValue(new InspectInputError('The base URL must start with http:// or https://'));

    const res = await POST(inspectRequest(goodBody), context('strapi'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'The base URL must start with http:// or https://',
    });
  });

  it('reports an unreachable instance as a bad gateway, not a crash', async () => {
    inspectHook.mockRejectedValue(new Error('getaddrinfo ENOTFOUND cms.example'));

    const res = await POST(inspectRequest(goodBody), context('apollo'));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: 'getaddrinfo ENOTFOUND cms.example' });
  });
});

describe('re-testing a connected source', () => {
  beforeEach(() => {
    vi.mocked(getSourceById).mockResolvedValue({
      id: 7,
      slug: 'apollo',
      kind: 'plugin',
      config: { _connector: 'apollo', baseUrl: 'https://api.apollo.io' },
    });
    vi.mocked(storedCredentialIdForSource).mockResolvedValue('cred_1');
    vi.mocked(getCredentialsForConnector).mockResolvedValue({ token: 'vaulted-key' });
  });

  it('inspects with the vaulted credential, so nothing is re-pasted', async () => {
    const res = await POST(inspectRequest({ sourceId: 7 }), context('apollo'));

    expect(res.status).toBe(200);
    expect(getCredentialsForConnector).toHaveBeenCalledWith({ orgId: 'org_1', connectorSlug: 'apollo', apiTokenId: 'cred_1' });
    expect(inspectHook).toHaveBeenCalledWith({
      config: { _connector: 'apollo', baseUrl: 'https://api.apollo.io' },
      credentials: { token: 'vaulted-key' },
      options: {},
    });
  });

  it('404s a source id this workspace does not own', async () => {
    vi.mocked(getSourceById).mockResolvedValue(null);

    const res = await POST(inspectRequest({ sourceId: 7 }), context('apollo'));

    expect(res.status).toBe(404);
    expect(inspectHook).not.toHaveBeenCalled();
  });

  it('refuses a source belonging to a different connector', async () => {
    vi.mocked(getSourceById).mockResolvedValue({ id: 7, slug: 'hubspot', kind: 'plugin', config: { _connector: 'hubspot' } });

    const res = await POST(inspectRequest({ sourceId: 7 }), context('apollo'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'That source is a hubspot connector, not apollo' });
  });

  it('says so when the source has no stored credential yet', async () => {
    vi.mocked(getCredentialsForConnector).mockResolvedValue(undefined);

    const res = await POST(inspectRequest({ sourceId: 7 }), context('apollo'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('No credential is stored') });
    expect(inspectHook).not.toHaveBeenCalled();
  });

  it('surfaces a revoked credential\'s own message rather than the vendor\'s 401', async () => {
    vi.mocked(getCredentialsForConnector).mockRejectedValue(new Error('The Apollo credential this connector uses was revoked.'));

    const res = await POST(inspectRequest({ sourceId: 7 }), context('apollo'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'The Apollo credential this connector uses was revoked.' });
  });

  it('rejects a source id that is not a number', async () => {
    const res = await POST(inspectRequest({ sourceId: 'seven' }), context('apollo'));

    expect(res.status).toBe(400);
    expect(getSourceById).not.toHaveBeenCalled();
  });
});
