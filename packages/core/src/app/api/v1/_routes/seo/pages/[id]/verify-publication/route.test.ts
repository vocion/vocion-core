import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/services/seo/publicationVerification', () => ({ verifySeoPublication: vi.fn() }));
const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { verifySeoPublication } = await import('@/services/seo/publicationVerification');
const { WriteApiError } = await import('@/services/writeApi');
const { POST } = await import('./route');
const params = { params: Promise.resolve({ id: '20' }) };
const request = (token = false) => new Request('https://vocion.test/api/v1/seo/pages/20/verify-publication', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer fake' } : {}) }, body: JSON.stringify({ orgId: 'foreign', userId: 'owner', url: 'http://127.0.0.1/private' }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'person', orgId: 'workspace-a', role: 'admin' } as never);
  vi.mocked(authenticateBearer).mockResolvedValue({ orgId: 'workspace-a', tokenId: 'token', principal: {} } as never);
});

it('ignores supplied URL/scope/actor and uses authenticated session plus path ID only', async () => {
  vi.mocked(verifySeoPublication).mockResolvedValue({ status: 'unverified', checkedAt: '2026-10-30', url: 'https://northwind.example/page', evidence: 'Access was not established' });
  const response = await POST(request(), params);

  expect(response.status).toBe(200);
  expect(verifySeoPublication).toHaveBeenCalledWith('workspace-a', 20, 'person');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

it('rejects bearer writes even when a browser session is available', async () => {
  expect((await POST(request(true), params)).status).toBe(403);
  expect(verifySeoPublication).not.toHaveBeenCalled();
});

it('rejects invalid IDs before any service fetch', async () => {
  expect((await POST(request(), { params: Promise.resolve({ id: '-2' }) })).status).toBe(400);
  expect(verifySeoPublication).not.toHaveBeenCalled();
});

it.each([403, 404, 409, 422])('propagates refusal %i without reporting a successful verification', async (status) => {
  vi.mocked(verifySeoPublication).mockRejectedValue(new WriteApiError(status, 'refused', 'Check could not be saved.'));

  expect((await POST(request(), params)).status).toBe(status);
});
