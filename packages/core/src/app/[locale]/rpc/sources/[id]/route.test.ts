/**
 * The edit and delete endpoints behind the Sources page's pencil and trash.
 *
 * The handlers own three things worth testing without a database: the auth
 * gate, turning a bad request into a 400 the operator can read rather than a
 * 500, and stopping a sync that is reading the config being replaced — an edit
 * that skipped that would let the old run keep writing documents the new
 * settings no longer ask for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/services/SourceSyncService', () => ({
  updateSourceConfig: vi.fn(),
  deleteSource: vi.fn(),
  supersedeRunningSync: vi.fn(),
}));

const { clerkAuth } = await import('@/libs/Auth');
const { deleteSource, supersedeRunningSync, updateSourceConfig } = await import('@/services/SourceSyncService');
const { DELETE, PATCH } = await import('./route');

const signedIn = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  has: () => true,
};

/**
 * Route context for one source id.
 * @param id - The dynamic `[id]` segment, as a string, so a bad one can be tested.
 */
function context(id: string) {
  return { params: Promise.resolve({ id, locale: 'en' }) };
}

/**
 * A PATCH request carrying this body.
 * @param body - JSON body to send, or a raw string for malformed JSON.
 */
function patchRequest(body: unknown): Request {
  return new Request('http://test/rpc/sources/1', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
  vi.mocked(updateSourceConfig).mockResolvedValue({ id: 1, slug: 'kb' });
  vi.mocked(deleteSource).mockResolvedValue({ documentsDeleted: 3 });
  vi.mocked(supersedeRunningSync).mockResolvedValue(false);
});

describe('PATCH /rpc/sources/[id]', () => {
  it('saves the config and stops a sync reading the old one', async () => {
    vi.mocked(supersedeRunningSync).mockResolvedValue(true);

    const res = await PATCH(patchRequest({ configJson: { baseUrl: 'https://cms.example' } }), context('1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ source: { id: 1, slug: 'kb' }, stoppedRunningSync: true });
    expect(updateSourceConfig).toHaveBeenCalledWith({
      orgId: 'org_1',
      sourceId: 1,
      configJson: { baseUrl: 'https://cms.example' },
    });
    expect(supersedeRunningSync).toHaveBeenCalledWith('org_1', 1, expect.stringContaining('settings changed'));
  });

  it('reports that there was no run to stop', async () => {
    const res = await PATCH(patchRequest({ configJson: { baseUrl: 'https://cms.example' } }), context('1'));

    await expect(res.json()).resolves.toMatchObject({ stoppedRunningSync: false });
  });

  it('refuses a caller with no workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: null });

    const res = await PATCH(patchRequest({ configJson: {} }), context('1'));

    expect(res.status).toBe(401);
    expect(updateSourceConfig).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a number', async () => {
    const res = await PATCH(patchRequest({ configJson: {} }), context('not-a-number'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Bad source id' });
  });

  it('rejects a body that is not JSON', async () => {
    const res = await PATCH(patchRequest('{oops'), context('1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Bad JSON' });
  });

  it('rejects a body with no config', async () => {
    const res = await PATCH(patchRequest({}), context('1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Missing configJson' });
  });

  it('passes a schema rejection back with the field it names', async () => {
    vi.mocked(updateSourceConfig).mockRejectedValue(
      new ZodError([{ code: 'custom', path: ['baseUrl'], message: 'baseUrl must be a URL' }]),
    );

    const res = await PATCH(patchRequest({ configJson: { baseUrl: 'nope' } }), context('1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'baseUrl must be a URL' });
  });

  it('does not stop a sync when the save itself failed', async () => {
    vi.mocked(updateSourceConfig).mockRejectedValue(new Error('No source 1 in this workspace'));

    const res = await PATCH(patchRequest({ configJson: {} }), context('1'));

    expect(res.status).toBe(400);
    expect(supersedeRunningSync).not.toHaveBeenCalled();
  });
});

describe('DELETE /rpc/sources/[id]', () => {
  it('deletes and says how many documents went with it', async () => {
    const res = await DELETE(new Request('http://test', { method: 'DELETE' }), context('7'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ documentsDeleted: 3 });
    expect(deleteSource).toHaveBeenCalledWith('org_1', 7);
  });

  it('refuses a caller with no workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: null });

    const res = await DELETE(new Request('http://test', { method: 'DELETE' }), context('7'));

    expect(res.status).toBe(401);
    expect(deleteSource).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a number', async () => {
    const res = await DELETE(new Request('http://test', { method: 'DELETE' }), context('7x'));

    expect(res.status).toBe(400);
    expect(deleteSource).not.toHaveBeenCalled();
  });

  it('reports a source that is not this workspace\'s as a 400, not a crash', async () => {
    vi.mocked(deleteSource).mockRejectedValue(new Error('No source 7 in this workspace'));

    const res = await DELETE(new Request('http://test', { method: 'DELETE' }), context('7'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'No source 7 in this workspace' });
  });
});
