/**
 * `/api/v1` limits ride on `authApi`, which every handler already calls: a
 * cap per address, a 429 for an address presenting bad tokens (which never
 * refuses a valid one), and a cap per caller. Each refusal is a 429 in the API's error shape with
 * `Retry-After`. All three count in memory, so no database is involved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { RATE_LIMITS, resetMemoryRateLimits } = await import('@/libs/rateLimit');
const { authApi, isErrorResponse } = await import('./_shared');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

function request(headers: Record<string, string>) {
  return new Request('https://app.northwind.example/api/v1/agents', { headers });
}

beforeEach(() => {
  resetMemoryRateLimits();
  mockBearer.mockReset();
  mockSession.mockReset();
});

describe('authApi rate limits', () => {
  it('answers an address past thirty bad tokens with a 429 and Retry-After instead of a 401', async () => {
    mockBearer.mockResolvedValue(null);
    const from = { 'authorization': 'Bearer vcn_live_bad', 'x-forwarded-for': '198.51.100.4' };
    for (let i = 0; i < RATE_LIMITS.apiAuthFailuresPerIp.limit; i++) {
      const res = await authApi(request(from));

      expect(isErrorResponse(res) && res.status).toBe(401);
    }

    const locked = await authApi(request(from));

    expect(isErrorResponse(locked) && locked.status).toBe(429);
    expect(isErrorResponse(locked) && locked.headers.get('Retry-After')).toMatch(/^\d+$/);
    await expect((locked as Response).json()).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('still accepts a valid token from an address that sent thirty bad ones — one tenant cannot lock out another behind a shared egress', async () => {
    const shared = '198.51.100.4';
    mockBearer.mockImplementation(async header => header === 'Bearer vcn_live_good'
      ? { orgId: 'proj-kestrel', tokenId: 7, principal: { kind: 'token', id: '7', role: 'member', scope: { orgId: 'proj-kestrel' } } } as never
      : null);
    for (let i = 0; i < RATE_LIMITS.apiAuthFailuresPerIp.limit + 5; i++) {
      await authApi(request({ 'authorization': 'Bearer vcn_live_revoked', 'x-forwarded-for': shared }));
    }

    const caller = await authApi(request({ 'authorization': 'Bearer vcn_live_good', 'x-forwarded-for': shared }));

    expect(isErrorResponse(caller)).toBe(false);
    expect(caller).toMatchObject({ orgId: 'proj-kestrel', actorId: 'token:7', source: 'token' });
  });

  it('caps one caller per minute, whichever address they call from', async () => {
    mockSession.mockResolvedValue({ userId: 'usr-sam', orgId: 'proj-ops', role: 'member', workspaceRole: 'member' } as never);
    for (let i = 0; i < RATE_LIMITS.apiPerCaller.limit; i++) {
      const caller = await authApi(request({ 'x-forwarded-for': `198.51.100.${i % 200}` }));

      expect(isErrorResponse(caller)).toBe(false);
    }

    const refused = await authApi(request({ 'x-forwarded-for': '203.0.113.9' }));

    expect(isErrorResponse(refused) && refused.status).toBe(429);
  });

  it('lets a caller through when no address is known and they are under their cap', async () => {
    mockSession.mockResolvedValue({ userId: 'usr-sam', orgId: 'proj-ops', role: 'member', workspaceRole: 'member' } as never);

    const caller = await authApi(request({}));

    expect(isErrorResponse(caller)).toBe(false);
  });
});
