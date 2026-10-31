import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/services/seo/roadmap', async original => ({ ...await original<typeof import('@/services/seo/roadmap')>(), readSeoRoadmap: vi.fn(), updateSeoRoadmap: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { readSeoRoadmap, updateSeoRoadmap } = await import('@/services/seo/roadmap');
const { WriteApiError } = await import('@/services/writeApi');
const { GET, PATCH } = await import('./route');
const params = { params: Promise.resolve({ id: '42' }) };
const roadmap = { revision: 0, initiatives: [], outcomes: [] };
const patch = (body: unknown, token = false) => new Request('https://vocion.test/api/v1/seo/projects/42/roadmap', { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer fake' } : {}) }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'person', orgId: 'workspace-a', role: 'admin' } as never);
  vi.mocked(authenticateBearer).mockResolvedValue({ orgId: 'workspace-a', tokenId: 'token', principal: {} } as never);
});

describe('roadmap HTTP boundaries', () => {
  it('refuses bearer writes even when a human browser session also exists', async () => {
    expect((await PATCH(patch({ expectedRevision: 0, roadmap }, true), params)).status).toBe(403);
    expect(updateSeoRoadmap).not.toHaveBeenCalled();
  });

  it('rejects malformed plans before service execution', async () => {
    expect((await PATCH(patch({ expectedRevision: -1, roadmap }), params)).status).toBe(400);
    expect(updateSeoRoadmap).not.toHaveBeenCalled();
  });

  it('uses authenticated workspace and actor, never caller-supplied scope', async () => {
    vi.mocked(updateSeoRoadmap).mockResolvedValue({ roadmap } as never);

    expect((await PATCH(patch({ expectedRevision: 0, roadmap, orgId: 'foreign-workspace', userId: 'owner' }), params)).status).toBe(200);
    expect(updateSeoRoadmap).toHaveBeenCalledWith('workspace-a', 42, 'person', 0, roadmap);
  });

  it('propagates ownership and stale revision refusals without pretending the save worked', async () => {
    for (const status of [403, 409]) {
      vi.mocked(updateSeoRoadmap).mockRejectedValueOnce(new WriteApiError(status, 'refused', 'Reload or ask the owner.'));

      expect((await PATCH(patch({ expectedRevision: 0, roadmap }), params)).status).toBe(status);
    }
  });

  it('scopes reads to the authenticated workspace and returns missing project errors', async () => {
    vi.mocked(readSeoRoadmap).mockRejectedValueOnce(new WriteApiError(404, 'not_found', 'Client project not found.'));

    expect((await GET(new Request('https://vocion.test/api/v1/seo/projects/42/roadmap'), params)).status).toBe(404);
    expect(readSeoRoadmap).toHaveBeenCalledWith('workspace-a', 42, 'person');
  });
});
