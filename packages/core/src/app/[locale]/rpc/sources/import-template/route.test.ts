/**
 * The template download.
 *
 * The template itself is generated from the connector's descriptor, so the
 * assertions here are the ones a browser depends on: a CSV content type, a
 * download filename, and a refusal for a connector that takes no import.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const signedIn = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  has: () => true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
});

/**
 * Call the route with a query string.
 * @param query - Query string, without the leading question mark.
 */
function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/rpc/sources/import-template?${query}`));
}

describe('GET /rpc/sources/import-template', () => {
  it('serves the connector\'s template as a CSV download', async () => {
    const res = await get('kind=web');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="web-sources-template.csv"');
    expect((await res.text()).split('\n')[0]).toBe('slug,url,crawl,max_depth,max_pages');
  });

  it('never caches, so a changed column cannot be served stale', async () => {
    expect((await get('kind=web')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses a connector that does not accept an import', async () => {
    const res = await get('kind=strapi');

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be imported from a file/);
  });

  it('refuses an unknown connector', async () => {
    const res = await get('kind=nope');

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown source connector/);
  });

  it('refuses a request with no kind', async () => {
    expect((await get('')).status).toBe(400);
  });

  it('refuses a caller with no org', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: null } as never);

    expect((await get('kind=web')).status).toBe(401);
  });
});
