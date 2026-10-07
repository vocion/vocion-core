/**
 * Starting a source's first sync once its credential is stored (#1080). The
 * rules someone could get wrong: only an admin starts it, it reads the
 * connector from the row (a source's slug is not always its connector), and a
 * source of another workspace is not found.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/connect/newSourceSync', () => ({ startSourceSyncing: vi.fn() }));
vi.mock('@/services/SourceSyncService', () => ({ getSourceById: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { startSourceSyncing } = await import('@/services/connect/newSourceSync');
const { getSourceById } = await import('@/services/SourceSyncService');
const { POST } = await import('./route');

const signedIn = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  workspaceRole: 'admin' as const,
  has: () => true,
};

/**
 * The route's arguments for one source id.
 * @param id - The id in the URL.
 */
function callFor(id: string): [Request, { params: Promise<{ id: string; locale: string }> }] {
  return [new Request(`http://localhost/rpc/sources/${id}/start-syncing`, { method: 'POST' }), { params: Promise.resolve({ id, locale: 'en' }) }];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
});

describe('POST /rpc/sources/:id/start-syncing', () => {
  it('starts the source syncing as the connector its row names, and says whether it started', async () => {
    vi.mocked(getSourceById).mockResolvedValue({ id: 21, slug: 'strapi-cms-example', kind: 'plugin', config: { _connector: 'strapi', collections: ['articles'] } });
    vi.mocked(startSourceSyncing).mockResolvedValue('started');

    const body = await (await POST(...callFor('21'))).json();

    expect(body).toEqual({ firstSync: 'started' });
    expect(startSourceSyncing).toHaveBeenCalledWith({ orgId: 'org_1', sourceId: 21, sourceSlug: 'strapi-cms-example', connectorSlug: 'strapi' });
  });

  it('refuses a member and starts nothing', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, role: 'member', workspaceRole: 'member' } as never);

    const response = await POST(...callFor('21'));

    expect(response.status).toBe(403);
    expect(startSourceSyncing).not.toHaveBeenCalled();
  });

  it('answers 404 for a source this workspace does not have, and starts nothing', async () => {
    vi.mocked(getSourceById).mockResolvedValue(null);

    const response = await POST(...callFor('99'));

    expect(response.status).toBe(404);
    expect(startSourceSyncing).not.toHaveBeenCalled();
  });
});
