/**
 * `/api/v1` limits ride on `authApi`, which every handler already calls: a
 * cap per address, a lockout on an address presenting bad tokens, and a cap
 * per caller. Each refusal is a 429 in the API's error shape with
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
  it('locks an address out after thirty bad tokens, before it can try a thirty-first', async () => {
    mockBearer.mockResolvedValue(null);
    const from = { 'authorization': 'Bearer vcn_live_bad', 'x-forwarded-for': '198.51.100.4' };
    for (let i = 0; i < RATE_LIMITS.apiAuthFailuresPerIp.limit; i++) {
      const res = await authApi(request(from));

      expect(isErrorResponse(res) && res.status).toBe(401);
    }

    const locked = await authApi(request(from));

    expect(isErrorResponse(locked) && locked.status).toBe(429);
    expect(isErrorResponse(locked) && locked.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(mockBearer).toHaveBeenCalledTimes(RATE_LIMITS.apiAuthFailuresPerIp.limit);
    await expect((locked as Response).json()).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' } });
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
