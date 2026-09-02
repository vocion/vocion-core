/**
 * The endpoint the Add-source dialog uses to look at a Strapi instance before
 * any source row exists.
 *
 * It takes a credential and makes the server call an arbitrary host, so the
 * gate and the input checks are the whole point: an admin of the workspace, a
 * connector that supports inspection, and a URL with a scheme. That last check
 * is the one an operator actually meets — "The base URL must start with
 * http:// or https://" is what a pasted bare hostname earns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/sources/registry', () => ({ getConnector: vi.fn() }));
vi.mock('@/libs/sources/strapi', () => ({ inspectStrapiInstance: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { getConnector } = await import('@/libs/sources/registry');
const { inspectStrapiInstance } = await import('@/libs/sources/strapi');
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
  detectedVersion: 5 as const,
  collections: ['events'],
  enumerationNote: null,
  checks: [],
  error: null,
};

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
  return new Request('http://test/rpc/connectors/strapi/inspect', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const goodBody = {
  config: { baseUrl: 'https://cms.example/' },
  credentials: { token: '  tok-123  ' },
  collections: ['events', '  venues  ', '', 42],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(admin);
  // Any registered connector will do; the route only asks whether it exists.
  vi.mocked(getConnector).mockReturnValue({ slug: 'strapi' } as never);
  vi.mocked(inspectStrapiInstance).mockResolvedValue(inspection);
});

describe('POST /rpc/connectors/[slug]/inspect', () => {
  it('inspects the instance, trimming the inputs and dropping junk collections', async () => {
    const res = await POST(inspectRequest(goodBody), context('strapi'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ inspection });
    expect(inspectStrapiInstance).toHaveBeenCalledWith({
      baseUrl: 'https://cms.example/',
      token: 'tok-123',
      collections: ['events', 'venues'],
    });
  });

  it('treats a missing collections list as none, not as an error', async () => {
    await POST(
      inspectRequest({ config: { baseUrl: 'https://cms.example' }, credentials: { token: 'tok' } }),
      context('strapi'),
    );

    expect(inspectStrapiInstance).toHaveBeenCalledWith(expect.objectContaining({ collections: [] }));
  });

  it('refuses a caller with no workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, orgId: null });

    const res = await POST(inspectRequest(goodBody), context('strapi'));

    expect(res.status).toBe(401);
    expect(inspectStrapiInstance).not.toHaveBeenCalled();
  });

  it('refuses a member: it spends a credential against an arbitrary host', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' });

    const res = await POST(inspectRequest(goodBody), context('strapi'));

    expect(res.status).toBe(403);
    expect(inspectStrapiInstance).not.toHaveBeenCalled();
  });

  it('404s a connector that does not exist', async () => {
    vi.mocked(getConnector).mockReturnValue(undefined);

    const res = await POST(inspectRequest(goodBody), context('nonsense'));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'Unknown connector: nonsense' });
  });

  it('501s a connector that cannot be inspected, so the client uses its plain form', async () => {
    const res = await POST(inspectRequest(goodBody), context('hubspot'));

    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ error: 'hubspot does not support inspection' });
    expect(inspectStrapiInstance).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON', async () => {
    const res = await POST(inspectRequest('{oops'), context('strapi'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid JSON body' });
  });

  it('asks for both halves when the token is missing', async () => {
    const res = await POST(inspectRequest({ config: { baseUrl: 'https://cms.example' } }), context('strapi'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'A base URL and an API token are both required' });
    expect(inspectStrapiInstance).not.toHaveBeenCalled();
  });

  it('asks for both halves when the URL is blank', async () => {
    const res = await POST(
      inspectRequest({ config: { baseUrl: '   ' }, credentials: { token: 'tok' } }),
      context('strapi'),
    );

    expect(res.status).toBe(400);
    expect(inspectStrapiInstance).not.toHaveBeenCalled();
  });

  it('names the scheme when the URL has none — the message the operator sees', async () => {
    const res = await POST(
      inspectRequest({ config: { baseUrl: 'cms.example' }, credentials: { token: 'tok' } }),
      context('strapi'),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'The base URL must start with http:// or https://',
    });
  });

  it('accepts http as well as https', async () => {
    const res = await POST(
      inspectRequest({ config: { baseUrl: 'http://cms.internal' }, credentials: { token: 'tok' } }),
      context('strapi'),
    );

    expect(res.status).toBe(200);
  });

  it('rejects a URL whose scheme is neither', async () => {
    const res = await POST(
      inspectRequest({ config: { baseUrl: 'file:///etc/passwd' }, credentials: { token: 'tok' } }),
      context('strapi'),
    );

    expect(res.status).toBe(400);
    expect(inspectStrapiInstance).not.toHaveBeenCalled();
  });

  it('ignores a non-string URL or token rather than passing it through', async () => {
    const res = await POST(
      inspectRequest({ config: { baseUrl: 12345 }, credentials: { token: { nested: true } } }),
      context('strapi'),
    );

    expect(res.status).toBe(400);
    expect(inspectStrapiInstance).not.toHaveBeenCalled();
  });

  it('reports an unreachable instance as a bad gateway, not a crash', async () => {
    vi.mocked(inspectStrapiInstance).mockRejectedValue(new Error('getaddrinfo ENOTFOUND cms.example'));

    const res = await POST(inspectRequest(goodBody), context('strapi'));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: 'getaddrinfo ENOTFOUND cms.example' });
  });
});
