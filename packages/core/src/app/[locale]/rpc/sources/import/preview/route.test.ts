/**
 * The preview endpoint.
 *
 * Its whole promise is that it writes nothing, so the service is mocked here
 * and the assertions are about the contract the dialog depends on: the body it
 * accepts, the shape it returns, and the status codes it answers with.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/SourceImportService', () => ({ previewSourceImportForOrg: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { previewSourceImportForOrg } = await import('@/services/SourceImportService');
const { POST } = await import('./route');

const signedIn = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  has: () => true,
};

const emptyPreview = {
  rows: [],
  summary: { total: 0, willAdd: 0, malformed: 0, duplicateInFile: 0, alreadyExists: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
  vi.mocked(previewSourceImportForOrg).mockResolvedValue({ preview: emptyPreview, created: [], error: null });
});

/**
 * Post a body to the route.
 * @param body - Anything JSON-encodable, or a raw string for the bad-JSON case.
 */
function post(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost/rpc/sources/import/preview', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

describe('POST /rpc/sources/import/preview', () => {
  it('hands the file to the service and returns its preview', async () => {
    const res = await post({ kind: 'web', csv: 'slug,url\n,https://a.example' });

    expect(res.status).toBe(200);
    expect((await res.json()).preview).toEqual(emptyPreview);
    expect(previewSourceImportForOrg).toHaveBeenCalledWith({
      orgId: 'org_1',
      kind: 'web',
      csvText: 'slug,url\n,https://a.example',
    });
  });

  it('answers a file-level problem with the reason', async () => {
    vi.mocked(previewSourceImportForOrg).mockResolvedValue({
      preview: null,
      created: [],
      error: 'That file is missing the "url" column.',
    });

    const res = await post({ kind: 'web', csv: 'slug\n,' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing the "url" column/);
  });

  it('refuses a body that is not JSON', async () => {
    const res = await post('not json');

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Bad JSON');
  });

  it('refuses a body with no kind', async () => {
    expect((await post({ csv: 'a' })).status).toBe(400);
  });

  it('refuses a body with an empty csv', async () => {
    const res = await post({ kind: 'web', csv: '   ' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Missing csv');
  });

  it('refuses a file over the size limit before reading it', async () => {
    const res = await post({ kind: 'web', csv: 'x'.repeat(1_100_000) });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/larger than the 1 MB limit/);
    expect(previewSourceImportForOrg).not.toHaveBeenCalled();
  });

  it('refuses a caller with no org', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: null } as never);

    expect((await post({ kind: 'web', csv: 'a\nb' })).status).toBe(401);
  });
});
