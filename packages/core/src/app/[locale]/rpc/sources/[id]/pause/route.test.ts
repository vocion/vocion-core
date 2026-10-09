import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/SourceSyncService', () => ({ setSourcePaused: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { setSourcePaused } = await import('@/services/SourceSyncService');
const { POST } = await import('./route');

const call = (id: string, body: unknown) => POST(
  new Request('http://local/rpc/sources/1/pause', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id, locale: 'en' }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ orgId: 'org_1', role: 'admin' } as never);
  vi.mocked(setSourcePaused).mockResolvedValue(true);
});

describe('POST /rpc/sources/[id]/pause', () => {
  it('pauses and resumes the connection in the caller\'s workspace', async () => {
    expect((await call('7', { paused: true })).status).toBe(200);
    expect((await call('7', { paused: false })).status).toBe(200);
    expect(setSourcePaused).toHaveBeenNthCalledWith(1, 'org_1', 7, true);
    expect(setSourcePaused).toHaveBeenNthCalledWith(2, 'org_1', 7, false);
  });

  it('is an admin\'s call', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ orgId: 'org_1', role: 'member' } as never);

    expect((await call('7', { paused: true })).status).toBe(403);
    expect(setSourcePaused).not.toHaveBeenCalled();
  });

  it('refuses a bad id or body, and says when the connection is not in this workspace', async () => {
    expect((await call('7x', { paused: true })).status).toBe(400);
    expect((await call('7', { paused: 'yes' })).status).toBe(400);

    vi.mocked(setSourcePaused).mockResolvedValue(false);

    expect((await call('8', { paused: true })).status).toBe(404);
  });
});
