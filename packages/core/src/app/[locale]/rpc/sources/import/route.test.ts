/**
 * The commit endpoint.
 *
 * Two things are worth pinning down: a partial outcome comes back visible
 * (the rows created AND the rows skipped), and a slug taken between the preview
 * and the write answers 409 rather than a 500 the dialog cannot explain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/SourceImportService', () => ({ commitSourceImportForOrg: vi.fn() }));
// Stubbed rather than imported: the real module opens a database connection at
// import time, which a route test has no business needing. The route only uses
// the class for an `instanceof` check, so the stub has to be the same class the
// route sees — which is why it is declared here rather than imported.
vi.mock('@/services/SourceSyncService', () => ({
  SourceSlugTakenError: class SourceSlugTakenError extends Error {
    constructor(public readonly slug: string) {
      super(`A source with the name "${slug}" already exists.`);
      this.name = 'SourceSlugTakenError';
    }
  },
}));

const { clerkAuth } = await import('@/libs/Auth');
const { commitSourceImportForOrg } = await import('@/services/SourceImportService');
const { SourceSlugTakenError } = await import('@/services/SourceSyncService');
const { POST } = await import('./route');

const signedIn = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  has: () => true,
};

const partialPreview = {
  rows: [
    { line: 2, slug: 'web-a', identity: 'https://a.example', config: {}, verdict: 'ok' as const, problem: null },
    { line: 3, slug: null, identity: null, config: null, verdict: 'malformed' as const, problem: '"url" is required' },
  ],
  summary: { total: 2, willAdd: 1, malformed: 1, duplicateInFile: 0, alreadyExists: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
  vi.mocked(commitSourceImportForOrg).mockResolvedValue({
    preview: partialPreview,
    created: [{ id: 7, slug: 'web-a' }],
    error: null,
  });
});

/**
 * Post a body to the route.
 * @param body - Anything JSON-encodable.
 */
function post(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost/rpc/sources/import', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

describe('POST /rpc/sources/import', () => {
  it('returns what it created alongside what it skipped', async () => {
    const res = await post({ kind: 'web', csv: 'slug,url\n,https://a.example\n,' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.created).toEqual([{ id: 7, slug: 'web-a' }]);
    expect(body.preview.summary).toMatchObject({ willAdd: 1, malformed: 1 });
  });

  it('answers a file-level problem with the reason', async () => {
    vi.mocked(commitSourceImportForOrg).mockResolvedValue({
      preview: null,
      created: [],
      error: 'That file has no header row.',
    });

    const res = await post({ kind: 'web', csv: 'x' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no header row/);
  });

  it('answers 409 when a slug was taken between the preview and the write', async () => {
    vi.mocked(commitSourceImportForOrg).mockRejectedValue(new SourceSlugTakenError('web-a'));

    const res = await post({ kind: 'web', csv: 'slug,url\n,https://a.example' });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/"web-a" already exists/);
  });

  it('answers 400 with the message when the write fails some other way', async () => {
    vi.mocked(commitSourceImportForOrg).mockRejectedValue(new Error('connection lost'));

    const res = await post({ kind: 'web', csv: 'slug,url\n,https://a.example' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('connection lost');
  });

  it('refuses a body with no kind', async () => {
    expect((await post({ csv: 'a' })).status).toBe(400);
    expect(commitSourceImportForOrg).not.toHaveBeenCalled();
  });

  it('refuses a caller with no org', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: null } as never);

    expect((await post({ kind: 'web', csv: 'a\nb' })).status).toBe(401);
  });
});
