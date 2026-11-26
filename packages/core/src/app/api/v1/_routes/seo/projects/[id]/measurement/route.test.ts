import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/services/seo/measurement', () => ({ captureSeoBaseline: vi.fn() }));
vi.mock('@/services/seo/readiness', () => ({ readSeoReadiness: vi.fn(), renderSeoMeasurementReport: vi.fn() }));
vi.mock('@/services/DataRoomService', () => ({ getDataRoom: vi.fn() }));
const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { captureSeoBaseline } = await import('@/services/seo/measurement');
const { readSeoReadiness, renderSeoMeasurementReport } = await import('@/services/seo/readiness');
const { getDataRoom } = await import('@/services/DataRoomService');
const { WriteApiError } = await import('@/services/writeApi');
const { GET, POST } = await import('./route');
const ctx = { params: Promise.resolve({ id: '42' }) };
const post = (body: unknown, token = false) => new Request('https://vocion.test/api/v1/seo/projects/42/measurement', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer fake' } : {}) }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'person', orgId: 'workspace-a', role: 'admin' } as never);
  vi.mocked(authenticateBearer).mockResolvedValue({ orgId: 'workspace-a', tokenId: 'measurement-token', principal: {} } as never);
});

it('refuses token measurement mutations without invoking a connector', async () => {
  expect((await POST(post({ expectedRevision: 0 }, true), ctx)).status).toBe(403);
  expect(captureSeoBaseline).not.toHaveBeenCalled();
});

it('requires a valid revision before invoking a connector', async () => {
  expect((await POST(post({ expectedRevision: -1 }), ctx)).status).toBe(400);
  expect(captureSeoBaseline).not.toHaveBeenCalled();
});

it('uses authenticated actor and workspace and exposes a stale measurement refusal', async () => {
  vi.mocked(captureSeoBaseline).mockRejectedValueOnce(new WriteApiError(409, 'revision_conflict', 'Reload first.'));

  expect((await POST(post({ expectedRevision: 1, orgId: 'foreign', userId: 'owner' }), ctx)).status).toBe(409);
  expect(captureSeoBaseline).toHaveBeenCalledWith('workspace-a', 42, 'person', 1);
});

it('does not export a foreign or missing project', async () => {
  vi.mocked(getDataRoom).mockResolvedValue(null);
  vi.mocked(readSeoReadiness).mockResolvedValue(null);

  expect((await GET(new Request('https://vocion.test/api/v1/seo/projects/42/measurement'), ctx)).status).toBe(404);
  expect(getDataRoom).toHaveBeenCalledWith('workspace-a', 42);
  expect(renderSeoMeasurementReport).not.toHaveBeenCalled();
});
